export type ObservationSourceChannel =
  | 'ANDROID_NOTIF'
  | 'ANDROID_SMS'
  | 'GMAIL'
  | 'MANUAL_CSV';

export interface ParsedBankObservation {
  matched: boolean;
  amountPaise: number;
  amountFormatted: string;
  utr: string;
  senderInfo: string;
  bankOrAppName: string;
  rawPayload: string;
  confidence: 'HIGH' | 'MEDIUM';
}

export interface BankParserTestCase {
  id: string;
  institution: string;
  channel: ObservationSourceChannel;
  sampleText: string;
  expectedAmountPaise: number;
  expectedUtr: string;
  expectedSender: string;
}

export interface BankParserTestResult extends BankParserTestCase {
  passed: boolean;
  actualAmountPaise: number | null;
  actualUtr: string | null;
  actualSender: string | null;
}

/**
 * Converts a rupee string like "499", "499.00", "1,299.50", "1,25,000.00"
 * into exact integer paise without IEEE-754 floating point drift.
 */
export function parseRupeesToPaise(rawAmount: string): number {
  const cleaned = rawAmount.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return 0;
  }
  const [rupeesPart, paisePart = ''] = cleaned.split('.');
  const rupees = parseInt(rupeesPart, 10);
  const normalizedPaiseStr = (paisePart + '00').slice(0, 2);
  const paise = parseInt(normalizedPaiseStr, 10);
  return rupees * 100 + paise;
}

export function formatPaiseToInr(amountPaise: number): string {
  const rupees = Math.floor(amountPaise / 100);
  const paise = Math.abs(amountPaise % 100);
  return `₹${rupees.toLocaleString('en-IN')}.${paise.toString().padStart(2, '0')}`;
}

/**
 * Indian Bank SMS & UPI Push Notification Regex Normalizer
 * Extracts exact integer paise, 12-digit NPCI UTR, sender identifier, and institution name.
 */
export function parseIndianBankAlert(rawText: string): ParsedBankObservation | null {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const normalized = rawText.replace(/\s+/g, ' ').trim();

  // Reject debit/sent notifications to prevent outgoing transfers from matching incoming checkouts
  const isOutgoingOnly =
    /\b(debited|sent\s+to|paid\s+to|withdrawn|declined|failed|request\s+from)\b/i.test(normalized) &&
    !/\b(credited|received|deposited|cr\b|credit\b)/i.test(normalized);

  if (isOutgoingOnly) {
    return null;
  }

  // Extract 12-digit NPCI UTR / RRN / UPI Ref No
  const utrPatterns: RegExp[] = [
    /(?:UPI\s*Ref(?:\s*No\.?|\s*ID)?|UTR(?:\s*No\.?)?|Ref(?:\s*No\.?|\s*ID)?|RRN|Txn\s*ID|reference\s*no\.?)\s*[:\-–]?\s*(\d{12})\b/i,
    /\bUPI(?:\s*[:\/\-]\s*|\s+)(\d{12})\b/i,
    /\((\d{12})\)/,
    /\b(\d{12})\b/,
  ];

  let extractedUtr: string | null = null;
  for (const pattern of utrPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      extractedUtr = match[1];
      break;
    }
  }

  if (!extractedUtr) {
    return null;
  }

  // Extract credited INR amount
  const amountPatterns: RegExp[] = [
    /(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)\s*(?:is\s+|has\s+been\s+)?(?:credited|received|deposited|cr\b)/i,
    /(?:credited|received|deposited|cr\.?)\s*(?:by|with|for|of)?\s*(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i,
    /(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.\d{1,2})?)/i,
  ];

  let amountPaise = 0;
  for (const pattern of amountPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const parsed = parseRupeesToPaise(match[1]);
      if (parsed > 0) {
        amountPaise = parsed;
        break;
      }
    }
  }

  if (amountPaise <= 0) {
    return null;
  }

  // Detect Bank or UPI App Institution
  let bankOrAppName = 'NPCI UPI Rails';
  if (/HDFC/i.test(normalized)) bankOrAppName = 'HDFC Bank';
  else if (/ICICI/i.test(normalized)) bankOrAppName = 'ICICI Bank';
  else if (/SBI|State Bank/i.test(normalized)) bankOrAppName = 'State Bank of India';
  else if (/Axis/i.test(normalized)) bankOrAppName = 'Axis Bank';
  else if (/Kotak/i.test(normalized)) bankOrAppName = 'Kotak Mahindra Bank';
  else if (/Google\s*Pay|GPay/i.test(normalized)) bankOrAppName = 'Google Pay Business';
  else if (/PhonePe/i.test(normalized)) bankOrAppName = 'PhonePe Business';
  else if (/Paytm/i.test(normalized)) bankOrAppName = 'Paytm Business';
  else if (/BHIM/i.test(normalized)) bankOrAppName = 'BHIM UPI';

  // Extract Sender VPA or Sender Name
  let senderInfo = 'Verified UPI Payer';
  const vpaMatch = normalized.match(/from\s+(?:VPA\s+)?([a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+)/i);
  const upiSlashMatch = normalized.match(/UPI\/(?:CR\/)?\d{12}\/([A-Za-z0-9\s.\-_]+?)(?:\/|$|\s+Ref)/i);
  const nameFromMatch = normalized.match(
    /(?:received\s+from|from|by)\s+([A-Z][A-Za-z0-9\s.\-@]{2,32}?)(?:\s+via\s+UPI|\s+on\s+|\s*\(|\s*\.|\s+Ref|\s+UTR|$)/i
  );

  if (vpaMatch && vpaMatch[1]) {
    senderInfo = vpaMatch[1].replace(/[.,;]$/, '').trim();
  } else if (upiSlashMatch && upiSlashMatch[1]) {
    senderInfo = upiSlashMatch[1].trim();
  } else if (nameFromMatch && nameFromMatch[1]) {
    const candidate = nameFromMatch[1].trim();
    if (!/^UPI\s*Ref/i.test(candidate) && !/^\d+$/.test(candidate)) {
      senderInfo = candidate;
    }
  }

  return {
    matched: true,
    amountPaise,
    amountFormatted: formatPaiseToInr(amountPaise),
    utr: extractedUtr,
    senderInfo,
    bankOrAppName,
    rawPayload: rawText,
    confidence:
      /\b(credited|received|UPI)\b/i.test(normalized) ? 'HIGH' : 'MEDIUM',
  };
}

export const OFFICIAL_BANK_PARSER_TEST_CASES: BankParserTestCase[] = [
  {
    id: 'hdfc-sms-1',
    institution: 'HDFC Bank',
    channel: 'ANDROID_SMS',
    sampleText:
      'Rs. 499.00 credited to a/c XX1234 on 28-10-26 by UPI Ref No 630112345678 (from rahul.sharma@okicici). Avl Bal: Rs. 48,920.00 - HDFC Bank',
    expectedAmountPaise: 49900,
    expectedUtr: '630112345678',
    expectedSender: 'rahul.sharma@okicici',
  },
  {
    id: 'sbi-sms-2',
    institution: 'State Bank of India',
    channel: 'ANDROID_SMS',
    sampleText:
      'Dear UPI user A/C X9821 credited by Rs.1,299.00 on date 28Oct26 trf to Merc Ref No 630198765432 -SBI',
    expectedAmountPaise: 129900,
    expectedUtr: '630198765432',
    expectedSender: 'Verified UPI Payer',
  },
  {
    id: 'icici-sms-3',
    institution: 'ICICI Bank',
    channel: 'ANDROID_SMS',
    sampleText:
      'Acct XX4410 is credited with INR 2,499.50 on 28-Oct-26 from ANANYA VERMA. UPI:630155443322-ICICI Bank.',
    expectedAmountPaise: 249950,
    expectedUtr: '630155443322',
    expectedSender: 'ANANYA VERMA',
  },
  {
    id: 'axis-sms-4',
    institution: 'Axis Bank',
    channel: 'ANDROID_SMS',
    sampleText:
      'INR 799.00 credited to A/c no. XX8812 on 28-10-2026 14:22:10 IST. Info: UPI/CR/630177889900/KARTHIK R/okaxis - Axis Bank',
    expectedAmountPaise: 79900,
    expectedUtr: '630177889900',
    expectedSender: 'KARTHIK R',
  },
  {
    id: 'kotak-sms-5',
    institution: 'Kotak Mahindra Bank',
    channel: 'ANDROID_SMS',
    sampleText:
      'Received Rs.999.00 in your Kotak Bank AC X1122 from priya.nair@ybl on 28-10-26. UPI Ref: 630166554433.',
    expectedAmountPaise: 99900,
    expectedUtr: '630166554433',
    expectedSender: 'priya.nair@ybl',
  },
  {
    id: 'gpay-notif-6',
    institution: 'Google Pay Business',
    channel: 'ANDROID_NOTIF',
    sampleText:
      '₹499.00 received from RAHUL K via UPI. Ref: 630112345678 • Google Pay for Business',
    expectedAmountPaise: 49900,
    expectedUtr: '630112345678',
    expectedSender: 'RAHUL K',
  },
  {
    id: 'phonepe-notif-7',
    institution: 'PhonePe Business',
    channel: 'ANDROID_NOTIF',
    sampleText:
      'PhonePe Business: Money Received! ₹1,499.00 credited from VIKRAM PATEL. UTR: 630122334455',
    expectedAmountPaise: 149900,
    expectedUtr: '630122334455',
    expectedSender: 'VIKRAM PATEL',
  },
  {
    id: 'paytm-notif-8',
    institution: 'Paytm Business',
    channel: 'ANDROID_NOTIF',
    sampleText:
      'Paytm for Business: Received Rs. 299.00 from NEHA GUPTA. UPI Ref No: 630199887766',
    expectedAmountPaise: 29900,
    expectedUtr: '630199887766',
    expectedSender: 'NEHA GUPTA',
  },
];

export function runBankParserUnitTests(): {
  allPassed: boolean;
  total: number;
  passedCount: number;
  results: BankParserTestResult[];
} {
  const results: BankParserTestResult[] = OFFICIAL_BANK_PARSER_TEST_CASES.map((tc) => {
    const parsed = parseIndianBankAlert(tc.sampleText);
    const passed =
      parsed !== null &&
      parsed.amountPaise === tc.expectedAmountPaise &&
      parsed.utr === tc.expectedUtr;

    return {
      ...tc,
      passed,
      actualAmountPaise: parsed ? parsed.amountPaise : null,
      actualUtr: parsed ? parsed.utr : null,
      actualSender: parsed ? parsed.senderInfo : null,
    };
  });

  const passedCount = results.filter((r) => r.passed).length;
  return {
    allPassed: passedCount === results.length,
    total: results.length,
    passedCount,
    results,
  };
}

/**
 * Parses a raw Bank Statement CSV content into normalized rows with amountPaise and 12-digit UTR.
 */
export interface ParsedCsvRow {
  rowNumber: number;
  rawLine: string;
  amountPaise: number;
  utr: string;
  narration: string;
}

export function parseBankStatementCsv(csvText: string): ParsedCsvRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const parsedRows: ParsedCsvRow[] = [];

  lines.forEach((line, idx) => {
    // Skip header lines
    if (idx === 0 && /date|narration|description|utr|amount|credit/i.test(line) && !/\b\d{12}\b/.test(line)) {
      return;
    }

    const utrMatch = line.match(/\b(\d{12})\b/);
    if (!utrMatch) return;
    const utr = utrMatch[1];

    // Remove the 12-digit UTR and dates from the line before extracting amount
    const withoutUtr = line
      .replace(utr, ' ')
      .replace(/\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g, ' ')
      .replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, ' ');

    const cols = withoutUtr.split(',').map((c) => c.replace(/["'₹RsINR\s]/gi, '').trim());
    let amountPaise = 0;

    for (let i = cols.length - 1; i >= 0; i--) {
      const candidate = cols[i];
      if (/^\d+(\.\d{1,2})?$/.test(candidate)) {
        const val = parseRupeesToPaise(candidate);
        if (val > 0 && val < 1000000000) {
          amountPaise = val;
          break;
        }
      }
    }

    if (amountPaise > 0) {
      parsedRows.push({
        rowNumber: idx + 1,
        rawLine: line,
        amountPaise,
        utr,
        narration: line,
      });
    }
  });

  return parsedRows;
}
