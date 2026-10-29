import { runBankParserUnitTests, parseIndianBankAlert } from './bank-parser.ts';

const summary = runBankParserUnitTests();

if (!summary.allPassed) {
  console.error('Bank Parser Unit Tests Failed:', summary.results.filter((r) => !r.passed));
  process.exit(1);
}

// Also verify that outgoing debit alerts are strictly ignored
const debitSample =
  'Rs. 499.00 debited from a/c XX1234 on 28-10-26 to VPA swiggy@yesbank. UPI Ref No 630111223344';
const debitResult = parseIndianBankAlert(debitSample);
if (debitResult !== null) {
  console.error('Expected debit SMS to be rejected, but got:', debitResult);
  process.exit(1);
}

console.log(`All ${summary.total} Indian Bank & UPI Regex unit tests passed.`);
