import 'dotenv/config';
import express, { Request, Response } from 'express';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  parseIndianBankAlert,
  parseBankStatementCsv,
  runBankParserUnitTests,
  formatPaiseToInr,
  ObservationSourceChannel,
} from './src/lib/bank-parser.ts';
import {
  Merchant,
  CheckoutSession,
  BankObservation,
  WebhookDeliveryLog,
  PaymentLink,
  RefundRecord,
  UserProfile,
  CustomerSummary,
} from './src/lib/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Initialize Production SQLite Database in WAL mode
const dbPath = path.resolve(__dirname, 'youpi-pg-prod.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// 2. Auto-Migrate Production Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    vpa TEXT NOT NULL,
    PayeeName TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    webhook_secret TEXT NOT NULL,
    observer_secret TEXT NOT NULL,
    api_key_id TEXT NOT NULL,
    api_key_secret TEXT NOT NULL,
    theme_color TEXT NOT NULL DEFAULT '#10B981',
    logo_url TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    support_email TEXT NOT NULL DEFAULT '',
    queue_mode TEXT NOT NULL DEFAULT 'VPA_AND_AMOUNT',
    last_heartbeat_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL DEFAULT '',
    payer_vpa TEXT,
    payment_link_id TEXT,
    refund_status TEXT NOT NULL DEFAULT 'NONE',
    refunded_paise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN (
      'OTP_PENDING',
      'QUEUED',
      'ACTIVE',
      'PROCESSING',
      'OBSERVED_SUCCESS',
      'RECONCILED',
      'EXPIRED',
      'CANCELLED'
    )),
    queue_position INTEGER NOT NULL DEFAULT 0,
    active_expires_at INTEGER,
    processing_expires_at INTEGER,
    utr TEXT,
    callback_url TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_slot
    ON checkout_sessions(merchant_id, amount_paise, status, queue_position);

  CREATE TABLE IF NOT EXISTS payment_links (
    id TEXT PRIMARY KEY,
    short_code TEXT NOT NULL UNIQUE,
    merchant_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    paid_session_id TEXT,
    utr TEXT,
    views_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    reason TEXT NOT NULL,
    customer_vpa TEXT NOT NULL,
    refund_upi_uri TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PROCESSED',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bank_observations (
    id TEXT PRIMARY KEY,
    fingerprint_hash TEXT NOT NULL UNIQUE,
    raw_payload TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    utr TEXT NOT NULL,
    sender_info TEXT NOT NULL,
    source_channel TEXT NOT NULL CHECK(source_channel IN (
      'ANDROID_NOTIF',
      'ANDROID_SMS',
      'GMAIL',
      'MANUAL_CSV'
    )),
    matched_session_id TEXT,
    observed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    signature TEXT NOT NULL,
    payload TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    delivered_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Founder & Admin',
    job_title TEXT NOT NULL DEFAULT 'Principal Merchant Owner',
    avatar_url TEXT NOT NULL DEFAULT '',
    business_category TEXT NOT NULL DEFAULT 'Software & Digital Services',
    pan_number TEXT NOT NULL DEFAULT '',
    two_factor_enabled INTEGER NOT NULL DEFAULT 1,
    merchant_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const DEFAULT_MERCHANT_ID = 'merch_youpi_primary';
const DEFAULT_USER_ID = 'usr_aniket_founder';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = (storedHash || '').split(':');
  if (!salt || !key) return false;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derivedBuf.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, keyBuf);
}

function ensureMerchantInitialized() {
  const existing = db
    .prepare('SELECT id FROM merchants WHERE id = ?')
    .get(DEFAULT_MERCHANT_ID) as { id: string } | undefined;

  if (!existing) {
    const webhookSecret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
    const observerSecret = `obs_sec_${crypto.randomBytes(16).toString('hex')}`;
    const apiKeyId = `openpay_live_${crypto.randomBytes(8).toString('hex')}`;
    const apiKeySecret = `sk_live_${crypto.randomBytes(16).toString('hex')}`;

    db.prepare(
      `INSERT INTO merchants (
        id, name, vpa, PayeeName, webhook_url, webhook_secret, observer_secret,
        api_key_id, api_key_secret, theme_color, logo_url, gstin, support_email, queue_mode, last_heartbeat_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      DEFAULT_MERCHANT_ID,
      'OpenPay — By Aniket',
      'aniket@okaxis',
      'Aniket Choudhary',
      '',
      webhookSecret,
      observerSecret,
      apiKeyId,
      apiKeySecret,
      '#2563EB',
      '',
      '',
      'aniketchoudhary9507@gmail.com',
      'VPA_AND_AMOUNT'
    );
  }

  const existingUser = db
    .prepare('SELECT id FROM users WHERE id = ? OR email = ?')
    .get(DEFAULT_USER_ID, 'aniketchoudhary9507@gmail.com') as { id: string } | undefined;

  if (!existingUser) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO users (
        id, full_name, email, phone, password_hash, role, job_title, avatar_url,
        business_category, pan_number, two_factor_enabled, merchant_id, created_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      DEFAULT_USER_ID,
      'Aniket Choudhary',
      'aniketchoudhary9507@gmail.com',
      '+91 98765 43210',
      hashPassword('OpenPay@2026'),
      'Founder & Owner',
      'Founder & Principal Systems Architect',
      '',
      'Fintech & SaaS Infrastructure',
      'ABCDE1234F',
      DEFAULT_MERCHANT_ID,
      now,
      now
    );
  }
}

ensureMerchantInitialized();

export function computeObservationFingerprint(
  receivingVpa: string,
  amountPaise: number,
  utr: string,
  timestampMs: number
): string {
  const timeBucket = Math.floor(timestampMs / (1000 * 60 * 60 * 24));
  const raw = `${receivingVpa.toLowerCase().trim()}:${amountPaise}:${utr.trim()}:${timeBucket}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function computePaymentSignature(
  orderId: string,
  sessionId: string,
  apiKeySecret: string
): string {
  return crypto
    .createHmac('sha256', apiKeySecret)
    .update(`${orderId}|${sessionId}`)
    .digest('hex');
}

// 3. QR SVG Cache & UPI Deep-Link Builder
const qrSvgCache = new Map<string, string>();

async function getVectorQrSvg(upiUri: string): Promise<string> {
  const cached = qrSvgCache.get(upiUri);
  if (cached) return cached;
  const svg = await QRCode.toString(upiUri, {
    type: 'svg',
    margin: 1,
    width: 240,
    color: {
      dark: '#0B0F17',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  });
  qrSvgCache.set(upiUri, svg);
  return svg;
}

function buildUpiIntents(merchant: Merchant, session: CheckoutSession) {
  const amountRupeesFixed = (session.amount_paise / 100).toFixed(2);
  const pa = encodeURIComponent(merchant.vpa);
  const pn = encodeURIComponent(merchant.PayeeName || merchant.name);
  const tn = encodeURIComponent(`${session.order_id}`);
  const tr = encodeURIComponent(session.order_id);
  const query = `pa=${pa}&pn=${pn}&am=${amountRupeesFixed}&cu=INR&tn=${tn}&tr=${tr}`;

  return {
    generic: `upi://pay?${query}`,
    gpay: `tez://upi/pay?${query}`,
    phonepe: `phonepe://pay?${query}`,
    paytm: `paytmmp://pay?${query}`,
    bhim: `bhim://upi/pay?${query}`,
    cred: `credpay://upi/pay?${query}`,
  };
}

function getPrimaryMerchant(): Merchant {
  return db
    .prepare('SELECT * FROM merchants WHERE id = ?')
    .get(DEFAULT_MERCHANT_ID) as Merchant;
}

async function hydrateSessionForClient(session: CheckoutSession): Promise<CheckoutSession> {
  const merchant = getPrimaryMerchant();
  const upi_intents = buildUpiIntents(merchant, session);
  const qr_svg = await getVectorQrSvg(upi_intents.generic);
  const payment_signature =
    session.status === 'OBSERVED_SUCCESS' || session.status === 'RECONCILED'
      ? computePaymentSignature(
          session.order_id,
          session.id,
          merchant.api_key_secret
        )
      : undefined;

  return {
    ...session,
    merchant: {
      name: merchant.name,
      vpa: merchant.vpa,
      PayeeName: merchant.PayeeName,
      theme_color: merchant.theme_color,
      logo_url: merchant.logo_url,
      gstin: merchant.gstin,
      support_email: merchant.support_email,
    },
    upi_intents,
    qr_svg,
    payment_signature,
    server_now: Date.now(),
  };
}

// 4. Server-Sent Events (SSE) Subscribers
const sessionSubscribers = new Map<string, Set<Response>>();
const adminSubscribers = new Set<Response>();

function sendSseEvent(res: Response, eventName: string, data: unknown) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function broadcastSessionUpdate(sessionId: string) {
  const row = db
    .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
    .get(sessionId) as CheckoutSession | undefined;
  if (!row) return;
  const hydrated = await hydrateSessionForClient(row);
  const subs = sessionSubscribers.get(sessionId);
  if (subs && subs.size > 0) {
    for (const res of subs) {
      sendSseEvent(res, 'session_update', hydrated);
    }
  }
}

async function getAdminSnapshot() {
  const merchant = getPrimaryMerchant();
  const user = db
    .prepare(
      `SELECT id, full_name, email, phone, role, job_title, avatar_url,
              business_category, pan_number, two_factor_enabled, merchant_id,
              created_at, last_login_at
       FROM users
       WHERE merchant_id = ?
       ORDER BY last_login_at DESC
       LIMIT 1`
    )
    .get(merchant.id) as UserProfile | undefined;

  const sessions = db
    .prepare('SELECT * FROM checkout_sessions ORDER BY created_at DESC LIMIT 100')
    .all() as CheckoutSession[];
  const paymentLinks = db
    .prepare('SELECT * FROM payment_links ORDER BY created_at DESC LIMIT 50')
    .all() as PaymentLink[];
  const refunds = db
    .prepare('SELECT * FROM refunds ORDER BY created_at DESC LIMIT 50')
    .all() as RefundRecord[];
  const observations = db
    .prepare('SELECT * FROM bank_observations ORDER BY observed_at DESC LIMIT 50')
    .all() as BankObservation[];
  const webhooks = db
    .prepare('SELECT * FROM webhook_deliveries ORDER BY delivered_at DESC LIMIT 40')
    .all() as WebhookDeliveryLog[];

  const hydratedSessions = await Promise.all(
    sessions.map((s) => hydrateSessionForClient(s))
  );

  const verifiedSessions = sessions.filter(
    (s) => s.status === 'OBSERVED_SUCCESS' || s.status === 'RECONCILED'
  );
  const totalVolumePaise = verifiedSessions.reduce((acc, s) => acc + s.amount_paise, 0);
  const refundedVolumePaise = refunds.reduce((acc, r) => acc + r.amount_paise, 0);
  const netVolumePaise = Math.max(0, totalVolumePaise - refundedVolumePaise);
  const reconciledCount = sessions.filter((s) => s.status === 'RECONCILED').length;
  const activeSlotCount = sessions.filter(
    (s) => s.status === 'ACTIVE' || s.status === 'PROCESSING'
  ).length;
  const queuedCount = sessions.filter((s) => s.status === 'QUEUED').length;
  const activePaymentLinksCount = paymentLinks.filter((pl) => pl.status === 'ACTIVE').length;
  const conversionRatePercent =
    sessions.length > 0
      ? Math.round((verifiedSessions.length / sessions.length) * 100)
      : 100;

  // Aggregate unique Customer Directory from checkout sessions
  const customerMap = new Map<string, CustomerSummary>();
  for (const s of sessions) {
    const isPaid = s.status === 'OBSERVED_SUCCESS' || s.status === 'RECONCILED';
    const rawKey = (
      s.customer_phone ||
      s.customer_email ||
      s.payer_vpa ||
      s.customer_name ||
      ''
    )
      .trim()
      .toLowerCase();
    if (!rawKey) continue;

    const existing = customerMap.get(rawKey);
    if (!existing) {
      customerMap.set(rawKey, {
        key: rawKey,
        name: s.customer_name || 'Customer',
        phone: s.customer_phone || '',
        email: s.customer_email || '',
        vpa: s.payer_vpa || '',
        totalSpentPaise: isPaid ? s.amount_paise : 0,
        paymentsCount: isPaid ? 1 : 0,
        lastPaymentAt: s.created_at,
      });
    } else {
      if (isPaid) {
        existing.totalSpentPaise += s.amount_paise;
        existing.paymentsCount += 1;
      }
      if (!existing.name && s.customer_name) existing.name = s.customer_name;
      if (!existing.phone && s.customer_phone) existing.phone = s.customer_phone;
      if (!existing.email && s.customer_email) existing.email = s.customer_email;
      if (!existing.vpa && s.payer_vpa) existing.vpa = s.payer_vpa;
      if (s.created_at > existing.lastPaymentAt) {
        existing.lastPaymentAt = s.created_at;
      }
    }
  }

  const customers = Array.from(customerMap.values()).sort(
    (a, b) => b.totalSpentPaise - a.totalSpentPaise || b.lastPaymentAt - a.lastPaymentAt
  );

  const now = Date.now();
  const observerConnected =
    merchant.last_heartbeat_at !== null && now - merchant.last_heartbeat_at < 120_000;

  return {
    user,
    merchant,
    sessions: hydratedSessions,
    paymentLinks,
    refunds,
    observations,
    webhooks,
    customers,
    metrics: {
      totalVolumePaise,
      netVolumePaise,
      refundedVolumePaise,
      verifiedCount: verifiedSessions.length,
      reconciledCount,
      activeSlotCount,
      queuedCount,
      activePaymentLinksCount,
      observerConnected,
      conversionRatePercent,
    },
    serverNow: now,
  };
}

async function broadcastAdminUpdate() {
  if (adminSubscribers.size === 0) return;
  const snapshot = await getAdminSnapshot();
  for (const res of adminSubscribers) {
    sendSseEvent(res, 'admin_snapshot', snapshot);
  }
}

// 5. Core Atomic Queue Promotion Engine
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PROCESSING_WINDOW_MS = 30 * 1000; // 30 seconds

function promoteNextInQueueSync(merchantId: string, amountPaise: number): string[] {
  const merchant = db
    .prepare('SELECT * FROM merchants WHERE id = ?')
    .get(merchantId) as Merchant;

  const isGlobalLock = merchant.queue_mode === 'GLOBAL_VPA';
  const now = Date.now();
  const touchedSessionIds: string[] = [];

  const activeHolder = isGlobalLock
    ? (db
        .prepare(
          `SELECT id FROM checkout_sessions
           WHERE merchant_id = ? AND status IN ('ACTIVE', 'PROCESSING')
           LIMIT 1`
        )
        .get(merchantId) as { id: string } | undefined)
    : (db
        .prepare(
          `SELECT id FROM checkout_sessions
           WHERE merchant_id = ? AND amount_paise = ? AND status IN ('ACTIVE', 'PROCESSING')
           LIMIT 1`
        )
        .get(merchantId, amountPaise) as { id: string } | undefined);

  if (activeHolder) {
    return touchedSessionIds;
  }

  const queuedList = isGlobalLock
    ? (db
        .prepare(
          `SELECT id FROM checkout_sessions
           WHERE merchant_id = ? AND status = 'QUEUED'
           ORDER BY created_at ASC`
        )
        .all(merchantId) as { id: string }[])
    : (db
        .prepare(
          `SELECT id FROM checkout_sessions
           WHERE merchant_id = ? AND amount_paise = ? AND status = 'QUEUED'
           ORDER BY created_at ASC`
        )
        .all(merchantId, amountPaise) as { id: string }[]);

  if (queuedList.length === 0) {
    return touchedSessionIds;
  }

  const [nextUp, ...restQueued] = queuedList;

  db.prepare(
    `UPDATE checkout_sessions
     SET status = 'ACTIVE',
         queue_position = 0,
         active_expires_at = ?
     WHERE id = ?`
  ).run(now + ACTIVE_WINDOW_MS, nextUp.id);
  touchedSessionIds.push(nextUp.id);

  const updatePos = db.prepare(
    `UPDATE checkout_sessions SET queue_position = ? WHERE id = ?`
  );
  restQueued.forEach((q, idx) => {
    updatePos.run(idx + 1, q.id);
    touchedSessionIds.push(q.id);
  });

  return touchedSessionIds;
}

async function dispatchMerchantWebhook(
  session: CheckoutSession,
  sourceChannel: string,
  eventType = 'payment.captured'
) {
  const merchant = getPrimaryMerchant();
  const now = Date.now();
  const paymentSignature = computePaymentSignature(
    session.order_id,
    session.id,
    merchant.api_key_secret
  );
  const payloadObj = {
    event: eventType,
    sessionId: session.id,
    orderId: session.order_id,
    amountPaise: session.amount_paise,
    amountFormatted: formatPaiseToInr(session.amount_paise),
    utr: session.utr,
    payerVpa: session.payer_vpa || null,
    paymentSignature,
    customer: {
      name: session.customer_name,
      phone: session.customer_phone,
      email: session.customer_email || '',
    },
    sourceChannel,
    verifiedAt: now,
  };
  const payloadStr = JSON.stringify(payloadObj);
  const signature = crypto
    .createHmac('sha256', merchant.webhook_secret)
    .update(payloadStr)
    .digest('hex');

  if (session.payment_link_id) {
    db.prepare(
      `UPDATE payment_links
       SET status = 'PAID', paid_session_id = ?, utr = ?
       WHERE id = ?`
    ).run(session.id, session.utr, session.payment_link_id);
  }

  const targetUrl = merchant.webhook_url.trim();
  if (!targetUrl) {
    return;
  }

  let statusCode = 200;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Youpi-Signature': signature,
        'X-Youpi-Event': eventType,
      },
      body: payloadStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    statusCode = response.status;
  } catch {
    statusCode = 502;
  }

  const deliveryId = `wh_${crypto.randomUUID().slice(0, 12)}`;
  db.prepare(
    `INSERT INTO webhook_deliveries (
      id, session_id, order_id, target_url, signature, payload, status_code, delivered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    deliveryId,
    session.id,
    session.order_id,
    targetUrl,
    signature,
    payloadStr,
    statusCode,
    now
  );
}

function createCheckoutSessionInternal(params: {
  orderId?: string;
  amountPaise: number;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  callbackUrl?: string;
  paymentLinkId?: string | null;
}): CheckoutSession {
  const merchant = getPrimaryMerchant();
  const sessionId = `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const normalizedOrderId =
    typeof params.orderId === 'string' && params.orderId.trim()
      ? params.orderId.trim()
      : `order_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const customerName = params.customerName?.trim() || '';
  const customerPhone = params.customerPhone?.trim() || '';
  const customerEmail = params.customerEmail?.trim() || '';
  const callbackUrl = params.callbackUrl || '';
  const paymentLinkId = params.paymentLinkId || null;

  const createTx = db.transaction(() => {
    const now = Date.now();
    const isGlobalLock = merchant.queue_mode === 'GLOBAL_VPA';

    const activeHolder = isGlobalLock
      ? (db
          .prepare(
            `SELECT id FROM checkout_sessions
             WHERE merchant_id = ? AND status IN ('ACTIVE', 'PROCESSING')
             LIMIT 1`
          )
          .get(merchant.id) as { id: string } | undefined)
      : (db
          .prepare(
            `SELECT id FROM checkout_sessions
             WHERE merchant_id = ? AND amount_paise = ? AND status IN ('ACTIVE', 'PROCESSING')
             LIMIT 1`
          )
          .get(merchant.id, params.amountPaise) as { id: string } | undefined);

    if (!activeHolder) {
      db.prepare(
        `INSERT INTO checkout_sessions (
          id, merchant_id, order_id, amount_paise, customer_phone, customer_name, customer_email,
          payment_link_id, status, queue_position, active_expires_at, processing_expires_at, utr, callback_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, NULL, NULL, ?, ?)`
      ).run(
        sessionId,
        merchant.id,
        normalizedOrderId,
        params.amountPaise,
        customerPhone,
        customerName,
        customerEmail,
        paymentLinkId,
        now + ACTIVE_WINDOW_MS,
        callbackUrl,
        now
      );
    } else {
      const countRow = isGlobalLock
        ? (db
            .prepare(
              `SELECT COUNT(*) as cnt FROM checkout_sessions
               WHERE merchant_id = ? AND status = 'QUEUED'`
            )
            .get(merchant.id) as { cnt: number })
        : (db
            .prepare(
              `SELECT COUNT(*) as cnt FROM checkout_sessions
               WHERE merchant_id = ? AND amount_paise = ? AND status = 'QUEUED'`
            )
            .get(merchant.id, params.amountPaise) as { cnt: number });

      const queuePos = (countRow?.cnt || 0) + 1;
      db.prepare(
        `INSERT INTO checkout_sessions (
          id, merchant_id, order_id, amount_paise, customer_phone, customer_name, customer_email,
          payment_link_id, status, queue_position, active_expires_at, processing_expires_at, utr, callback_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, NULL, NULL, NULL, ?, ?)`
      ).run(
        sessionId,
        merchant.id,
        normalizedOrderId,
        params.amountPaise,
        customerPhone,
        customerName,
        customerEmail,
        paymentLinkId,
        queuePos,
        callbackUrl,
        now
      );
    }

    return db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession;
  });

  return createTx();
}

// 6. Background Expiration Ticker (1-second resolution)
setInterval(() => {
  const now = Date.now();
  const expiredActive = db
    .prepare(
      `SELECT id, merchant_id, amount_paise FROM checkout_sessions
       WHERE status = 'ACTIVE' AND active_expires_at IS NOT NULL AND active_expires_at <= ?`
    )
    .all(now) as { id: string; merchant_id: string; amount_paise: number }[];

  const expiredProcessing = db
    .prepare(
      `SELECT id, merchant_id, amount_paise FROM checkout_sessions
       WHERE status = 'PROCESSING' AND processing_expires_at IS NOT NULL AND processing_expires_at <= ?`
    )
    .all(now) as { id: string; merchant_id: string; amount_paise: number }[];

  const allExpired = [...expiredActive, ...expiredProcessing];
  if (allExpired.length === 0) return;

  const affectedSessionIds = new Set<string>();

  const expireTx = db.transaction(() => {
    for (const item of allExpired) {
      db.prepare(
        `UPDATE checkout_sessions
         SET status = 'EXPIRED', queue_position = 0
         WHERE id = ?`
      ).run(item.id);
      affectedSessionIds.add(item.id);

      const promoted = promoteNextInQueueSync(item.merchant_id, item.amount_paise);
      promoted.forEach((id) => affectedSessionIds.add(id));
    }
  });

  expireTx();

  for (const sid of affectedSessionIds) {
    broadcastSessionUpdate(sid);
  }
  broadcastAdminUpdate();
}, 1000);

// 7. Express App & Routes
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(
    express.json({
      limit: '2mb',
      verify: (req: Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  app.use('/sdk.js', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    next();
  });
  app.use(express.static(path.resolve(__dirname, 'public')));

  // --- API: Create Checkout Session ---
  app.post('/api/checkout/sessions', async (req: Request, res: Response) => {
    try {
      const {
        orderId,
        amountPaise,
        customerName,
        customerPhone,
        customerEmail,
        callbackUrl,
        paymentLinkId,
      } = req.body || {};

      const parsedAmountPaise = Number(amountPaise);
      if (!Number.isInteger(parsedAmountPaise) || parsedAmountPaise < 100) {
        res.status(400).json({ error: 'amountPaise must be an integer >= 100 (₹1.00).' });
        return;
      }

      const created = createCheckoutSessionInternal({
        orderId,
        amountPaise: parsedAmountPaise,
        customerName,
        customerPhone,
        customerEmail,
        callbackUrl,
        paymentLinkId,
      });

      const hydrated = await hydrateSessionForClient(created);
      broadcastAdminUpdate();
      res.status(201).json({ session: hydrated });
    } catch (err) {
      console.error('Error creating checkout session:', err);
      res.status(500).json({ error: 'Internal server error creating session' });
    }
  });

  // --- API: v1 Orders API (POST /api/v1/orders) ---
  app.post('/api/v1/orders', async (req: Request, res: Response) => {
    try {
      const {
        amount,
        currency = 'INR',
        receipt,
        notes = {},
      } = req.body || {};

      const parsedAmount = Number(amount);
      if (!Number.isInteger(parsedAmount) || parsedAmount < 100) {
        res.status(400).json({
          error: {
            code: 'BAD_REQUEST_ERROR',
            description: 'The amount must be an integer in paise >= 100.',
          },
        });
        return;
      }

      const orderId = `order_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
      const session = createCheckoutSessionInternal({
        orderId,
        amountPaise: parsedAmount,
        customerName: notes.customer_name || '',
        customerPhone: notes.customer_phone || '',
        customerEmail: notes.customer_email || '',
      });

      broadcastAdminUpdate();

      res.status(200).json({
        id: orderId,
        entity: 'order',
        amount: parsedAmount,
        amount_paid: 0,
        amount_due: parsedAmount,
        currency,
        receipt: receipt || session.order_id,
        status: session.status === 'ACTIVE' ? 'created' : 'queued',
        queue_position: session.queue_position,
        checkout_session_id: session.id,
        checkout_url: `/checkout/${session.id}`,
        created_at: Math.floor(session.created_at / 1000),
      });
    } catch {
      res.status(500).json({ error: 'Failed to create order' });
    }
  });

  // --- API: Signature Verification (POST /api/v1/payments/verify) ---
  app.post('/api/v1/payments/verify', (req: Request, res: Response) => {
    const {
      youpi_order_id,
      youpi_payment_id,
      youpi_signature,
    } = req.body || {};

    if (!youpi_order_id || !youpi_payment_id || !youpi_signature) {
      res.status(400).json({
        verified: false,
        error: 'Missing youpi_order_id, youpi_payment_id, or youpi_signature',
      });
      return;
    }

    const merchant = getPrimaryMerchant();
    const expectedSig = computePaymentSignature(
      youpi_order_id,
      youpi_payment_id,
      merchant.api_key_secret
    );

    const verified = expectedSig === youpi_signature;
    res.status(verified ? 200 : 400).json({
      verified,
      orderId: youpi_order_id,
      paymentId: youpi_payment_id,
    });
  });

  // --- API: Get Single Checkout Session ---
  app.get('/api/checkout/sessions/:id', async (req: Request, res: Response) => {
    const row = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(req.params.id) as CheckoutSession | undefined;
    if (!row) {
      res.status(404).json({ error: 'Checkout session not found' });
      return;
    }
    const hydrated = await hydrateSessionForClient(row);
    res.json({ session: hydrated });
  });

  // --- API: Update Customer Contact Info ---
  app.patch('/api/checkout/sessions/:id/contact', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { customerName, customerPhone, customerEmail } = req.body || {};
    const row = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession | undefined;

    if (!row) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    db.prepare(
      `UPDATE checkout_sessions
       SET customer_name = COALESCE(NULLIF(?, ''), customer_name),
           customer_phone = COALESCE(NULLIF(?, ''), customer_phone),
           customer_email = COALESCE(NULLIF(?, ''), customer_email)
       WHERE id = ?`
    ).run(
      customerName?.trim() || '',
      customerPhone?.trim() || '',
      customerEmail?.trim() || '',
      sessionId
    );

    await broadcastSessionUpdate(sessionId);
    await broadcastAdminUpdate();

    const updated = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession;
    res.json({ session: await hydrateSessionForClient(updated) });
  });

  // --- API: Initiate UPI ID / VPA Collect Request ---
  app.post('/api/checkout/sessions/:id/collect-request', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { payerVpa } = req.body || {};

    if (
      !payerVpa ||
      typeof payerVpa !== 'string' ||
      !/^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/.test(payerVpa.trim())
    ) {
      res.status(400).json({
        error: 'Enter a valid UPI ID / VPA (e.g. name@okicici, mobile@ybl, user@paytm).',
      });
      return;
    }

    const row = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession | undefined;

    if (!row) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE checkout_sessions
       SET status = 'PROCESSING',
           payer_vpa = ?,
           processing_expires_at = ?
       WHERE id = ? AND status IN ('ACTIVE', 'PROCESSING')`
    ).run(payerVpa.trim().toLowerCase(), now + PROCESSING_WINDOW_MS, sessionId);

    await broadcastSessionUpdate(sessionId);
    await broadcastAdminUpdate();

    const updated = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession;
    res.json({
      session: await hydrateSessionForClient(updated),
      collectInitiated: true,
    });
  });

  // --- API: Customer Clicks "I Have Paid — Verify Now" or Submits 12-Digit UTR ---
  app.post('/api/checkout/sessions/:id/verify', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { manualUtr } = req.body || {};

    const row = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession | undefined;

    if (!row) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (row.status === 'OBSERVED_SUCCESS' || row.status === 'RECONCILED') {
      const hydrated = await hydrateSessionForClient(row);
      res.json({ session: hydrated, matchedImmediately: true });
      return;
    }

    const cleanedUtr =
      typeof manualUtr === 'string' ? manualUtr.replace(/\D/g, '').trim() : '';

    if (cleanedUtr && cleanedUtr.length !== 12) {
      res.status(400).json({ error: 'UTR / UPI Reference number must be exactly 12 digits.' });
      return;
    }

    const affectedIds = new Set<string>([sessionId]);
    let matchedImmediately = false;
    let webhookToDispatch: { session: CheckoutSession; channel: string } | null = null;

    const verifyTx = db.transaction(() => {
      const now = Date.now();

      const unmatchedObs = cleanedUtr
        ? (db
            .prepare(
              `SELECT * FROM bank_observations
               WHERE matched_session_id IS NULL
                 AND amount_paise = ?
                 AND utr = ?
               ORDER BY observed_at DESC LIMIT 1`
            )
            .get(row.amount_paise, cleanedUtr) as BankObservation | undefined)
        : (db
            .prepare(
              `SELECT * FROM bank_observations
               WHERE matched_session_id IS NULL
                 AND amount_paise = ?
                 AND observed_at >= ?
               ORDER BY observed_at DESC LIMIT 1`
            )
            .get(row.amount_paise, row.created_at - 60_000) as BankObservation | undefined);

      if (unmatchedObs) {
        db.prepare(
          `UPDATE checkout_sessions
           SET status = 'OBSERVED_SUCCESS',
               utr = ?,
               queue_position = 0,
               processing_expires_at = NULL
           WHERE id = ?`
        ).run(unmatchedObs.utr, sessionId);

        db.prepare(
          `UPDATE bank_observations SET matched_session_id = ? WHERE id = ?`
        ).run(sessionId, unmatchedObs.id);

        const updatedSession = db
          .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
          .get(sessionId) as CheckoutSession;
        webhookToDispatch = {
          session: updatedSession,
          channel: unmatchedObs.source_channel,
        };

        const promoted = promoteNextInQueueSync(row.merchant_id, row.amount_paise);
        promoted.forEach((id) => affectedIds.add(id));
        matchedImmediately = true;
      } else {
        const nextProcessingExpiry =
          row.status === 'PROCESSING' && row.processing_expires_at && row.processing_expires_at > now
            ? row.processing_expires_at
            : now + PROCESSING_WINDOW_MS;

        db.prepare(
          `UPDATE checkout_sessions
           SET status = 'PROCESSING',
               processing_expires_at = ?,
               utr = COALESCE(NULLIF(?, ''), utr)
           WHERE id = ?`
        ).run(nextProcessingExpiry, cleanedUtr, sessionId);
      }
    });

    verifyTx();

    if (webhookToDispatch) {
      await dispatchMerchantWebhook(
        (webhookToDispatch as { session: CheckoutSession; channel: string }).session,
        (webhookToDispatch as { session: CheckoutSession; channel: string }).channel
      );
    }

    for (const id of affectedIds) {
      await broadcastSessionUpdate(id);
    }
    await broadcastAdminUpdate();

    const updated = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession;
    const hydrated = await hydrateSessionForClient(updated);
    res.json({ session: hydrated, matchedImmediately });
  });

  // --- API: Cancel Checkout Session (Releases Slot & Promotes Queue) ---
  app.post('/api/checkout/sessions/:id/cancel', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const row = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession | undefined;
    if (!row) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const affectedIds = new Set<string>([sessionId]);
    const cancelTx = db.transaction(() => {
      db.prepare(
        `UPDATE checkout_sessions
         SET status = 'CANCELLED', queue_position = 0
         WHERE id = ? AND status NOT IN ('OBSERVED_SUCCESS', 'RECONCILED')`
      ).run(sessionId);

      const promoted = promoteNextInQueueSync(row.merchant_id, row.amount_paise);
      promoted.forEach((id) => affectedIds.add(id));
    });

    cancelTx();

    for (const id of affectedIds) {
      await broadcastSessionUpdate(id);
    }
    await broadcastAdminUpdate();

    const updated = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession;
    res.json({ session: await hydrateSessionForClient(updated) });
  });

  // --- API: SSE Stream for Customer Checkout Session ---
  app.get('/api/checkout/sessions/:id/stream', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const row = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession | undefined;

    if (!row) {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let set = sessionSubscribers.get(sessionId);
    if (!set) {
      set = new Set();
      sessionSubscribers.set(sessionId, set);
    }
    set.add(res);

    const hydrated = await hydrateSessionForClient(row);
    sendSseEvent(res, 'session_update', hydrated);

    req.on('close', () => {
      set?.delete(res);
      if (set && set.size === 0) {
        sessionSubscribers.delete(sessionId);
      }
    });
  });

  // --- API: Payment Links ---
  app.get('/api/payment-links/:shortCode', (req: Request, res: Response) => {
    const code = req.params.shortCode;
    const link = db
      .prepare('SELECT * FROM payment_links WHERE short_code = ? OR id = ?')
      .get(code, code) as PaymentLink | undefined;

    if (!link) {
      res.status(404).json({ error: 'Payment Link not found' });
      return;
    }

    db.prepare('UPDATE payment_links SET views_count = views_count + 1 WHERE id = ?').run(link.id);
    const merchant = getPrimaryMerchant();
    res.json({
      paymentLink: { ...link, views_count: link.views_count + 1 },
      merchant: {
        name: merchant.name,
        vpa: merchant.vpa,
        PayeeName: merchant.PayeeName,
        theme_color: merchant.theme_color,
        gstin: merchant.gstin,
        support_email: merchant.support_email,
      },
    });
  });

  app.post('/api/payment-links/:shortCode/initiate', async (req: Request, res: Response) => {
    const code = req.params.shortCode;
    const link = db
      .prepare('SELECT * FROM payment_links WHERE short_code = ? OR id = ?')
      .get(code, code) as PaymentLink | undefined;

    if (!link) {
      res.status(404).json({ error: 'Payment Link not found' });
      return;
    }

    if (link.status === 'PAID' && link.paid_session_id) {
      const existingPaid = db
        .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
        .get(link.paid_session_id) as CheckoutSession | undefined;
      if (existingPaid) {
        res.status(200).json({ session: await hydrateSessionForClient(existingPaid) });
        return;
      }
    }

    const { customerName, customerPhone, customerEmail } = req.body || {};
    const session = createCheckoutSessionInternal({
      orderId: `PL-${link.short_code.toUpperCase()}`,
      amountPaise: link.amount_paise,
      customerName: customerName || link.customer_name,
      customerPhone: customerPhone || link.customer_phone,
      customerEmail: customerEmail || link.customer_email,
      paymentLinkId: link.id,
    });

    await broadcastAdminUpdate();
    res.status(201).json({ session: await hydrateSessionForClient(session) });
  });

  app.post('/api/admin/payment-links', async (req: Request, res: Response) => {
    const {
      title,
      description = '',
      amountPaise,
      customerName = '',
      customerPhone = '',
      customerEmail = '',
    } = req.body || {};

    const parsedAmount = Number(amountPaise);
    if (!title || !Number.isInteger(parsedAmount) || parsedAmount < 100) {
      res.status(400).json({ error: 'Title and valid amount (>= ₹1.00) are required.' });
      return;
    }

    const id = `plink_${crypto.randomUUID().slice(0, 10)}`;
    const shortCode = `pl_${crypto.randomBytes(4).toString('hex')}`;
    const merchant = getPrimaryMerchant();

    db.prepare(
      `INSERT INTO payment_links (
        id, short_code, merchant_id, title, description, amount_paise,
        customer_name, customer_phone, customer_email, status, views_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?)`
    ).run(
      id,
      shortCode,
      merchant.id,
      title.trim(),
      description.trim(),
      parsedAmount,
      customerName.trim(),
      customerPhone.trim(),
      customerEmail.trim(),
      Date.now()
    );

    await broadcastAdminUpdate();
    const created = db
      .prepare('SELECT * FROM payment_links WHERE id = ?')
      .get(id) as PaymentLink;
    res.status(201).json({ paymentLink: created });
  });

  // --- API: Refunds Engine ---
  app.post('/api/admin/sessions/:id/refund', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { amountPaise, reason = 'Customer refund', customerVpa } = req.body || {};

    const session = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession | undefined;

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const refundAmount = Number(amountPaise) || session.amount_paise - (session.refunded_paise || 0);
    const maxRefundable = session.amount_paise - (session.refunded_paise || 0);

    if (refundAmount <= 0 || refundAmount > maxRefundable) {
      res.status(400).json({
        error: `Refund amount must be between ₹1.00 and ${formatPaiseToInr(maxRefundable)}.`,
      });
      return;
    }

    const targetVpa = (customerVpa || session.payer_vpa || '').trim();
    if (!targetVpa || !targetVpa.includes('@')) {
      res.status(400).json({
        error: 'A valid recipient UPI VPA (e.g. customer@bank) is required to issue a UPI refund.',
      });
      return;
    }

    const refundRupees = (refundAmount / 100).toFixed(2);
    const refundUpiUri = `upi://pay?pa=${encodeURIComponent(targetVpa)}&pn=${encodeURIComponent(
      session.customer_name || 'Customer'
    )}&am=${refundRupees}&cu=INR&tn=${encodeURIComponent(`Refund ${session.order_id}`)}`;

    const refundId = `rfnd_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const newRefundedTotal = (session.refunded_paise || 0) + refundAmount;
    const nextRefundStatus = newRefundedTotal >= session.amount_paise ? 'FULL' : 'PARTIAL';

    let updatedSession: CheckoutSession | undefined;

    const refundTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO refunds (
          id, session_id, order_id, amount_paise, reason, customer_vpa, refund_upi_uri, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSED', ?)`
      ).run(
        refundId,
        session.id,
        session.order_id,
        refundAmount,
        reason,
        targetVpa,
        refundUpiUri,
        Date.now()
      );

      db.prepare(
        `UPDATE checkout_sessions
         SET refund_status = ?, refunded_paise = ?
         WHERE id = ?`
      ).run(nextRefundStatus, newRefundedTotal, session.id);

      updatedSession = db
        .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
        .get(session.id) as CheckoutSession;
    });

    refundTx();

    if (updatedSession) {
      await dispatchMerchantWebhook(updatedSession, 'MANUAL_CSV', 'refund.processed');
    }

    await broadcastSessionUpdate(session.id);
    await broadcastAdminUpdate();

    const createdRefund = db
      .prepare('SELECT * FROM refunds WHERE id = ?')
      .get(refundId) as RefundRecord;
    res.status(201).json({ refund: createdRefund });
  });

  // --- API: Replay Outbound Webhook for Any Session ---
  app.post('/api/admin/sessions/:id/replay-webhook', async (req: Request, res: Response) => {
    const session = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(req.params.id) as CheckoutSession | undefined;

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await dispatchMerchantWebhook(session, 'ANDROID_SMS', 'payment.captured');
    await broadcastAdminUpdate();
    res.json({ ok: true });
  });

  // --- API: Manual UTR Verification by Merchant Admin ---
  app.post('/api/admin/sessions/:id/confirm-utr', async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const { utr } = req.body || {};
    const cleanedUtr = typeof utr === 'string' ? utr.replace(/\D/g, '').trim() : '';

    if (cleanedUtr.length !== 12) {
      res.status(400).json({ error: 'A valid 12-digit numeric NPCI UTR is required.' });
      return;
    }

    const row = db
      .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
      .get(sessionId) as CheckoutSession | undefined;

    if (!row) {
      res.status(404).json({ error: 'Checkout session not found' });
      return;
    }

    const merchant = getPrimaryMerchant();
    const now = Date.now();
    const fp = computeObservationFingerprint(merchant.vpa, row.amount_paise, cleanedUtr, now);
    const affectedIds = new Set<string>([sessionId]);
    let updatedSession: CheckoutSession | undefined;

    const confirmTx = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO bank_observations (
          id, fingerprint_hash, raw_payload, amount_paise, utr, sender_info,
          source_channel, matched_session_id, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'MANUAL_CSV', ?, ?)`
      ).run(
        `obs_${crypto.randomUUID().slice(0, 12)}`,
        fp,
        `Merchant verified UTR ${cleanedUtr} for ${row.order_id}`,
        row.amount_paise,
        cleanedUtr,
        row.payer_vpa || row.customer_name || 'Verified Customer',
        sessionId,
        now
      );

      db.prepare(
        `UPDATE checkout_sessions
         SET status = 'OBSERVED_SUCCESS',
             utr = ?,
             queue_position = 0,
             active_expires_at = NULL,
             processing_expires_at = NULL
         WHERE id = ?`
      ).run(cleanedUtr, sessionId);

      updatedSession = db
        .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
        .get(sessionId) as CheckoutSession;

      const promoted = promoteNextInQueueSync(merchant.id, row.amount_paise);
      promoted.forEach((id) => affectedIds.add(id));
    });

    confirmTx();

    if (updatedSession) {
      await dispatchMerchantWebhook(updatedSession, 'MANUAL_CSV', 'payment.captured');
    }

    for (const sid of affectedIds) {
      await broadcastSessionUpdate(sid);
    }
    await broadcastAdminUpdate();

    res.json({
      session: updatedSession ? await hydrateSessionForClient(updatedSession) : null,
    });
  });

  // --- API: Multi-Channel Banking Observer Ingest (/api/observer/ingest) ---
  app.post(
    '/api/observer/ingest',
    async (req: Request & { rawBody?: string }, res: Response) => {
      try {
        const merchant = getPrimaryMerchant();
        const signatureHeader = (req.header('X-Observer-Signature') || '').trim();
        const rawBody = req.rawBody || JSON.stringify(req.body);

        const expectedSignature = crypto
          .createHmac('sha256', merchant.observer_secret)
          .update(rawBody)
          .digest('hex');

        const sigBuf = Buffer.from(signatureHeader, 'utf8');
        const expBuf = Buffer.from(expectedSignature, 'utf8');
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          res.status(401).json({
            error: 'Invalid X-Observer-Signature. HMAC-SHA256 verification failed.',
          });
          return;
        }

        const {
          rawPayload = '',
          sourceChannel = 'ANDROID_SMS',
          observedAt = Date.now(),
        } = req.body || {};

        db.prepare('UPDATE merchants SET last_heartbeat_at = ? WHERE id = ?').run(
          Date.now(),
          merchant.id
        );

        const parsed = parseIndianBankAlert(rawPayload);
        if (!parsed) {
          res.status(422).json({
            error:
              'Unrecognized alert format or outgoing debit ignored. Requires incoming credit amount and 12-digit UTR.',
          });
          return;
        }

        const validChannels: ObservationSourceChannel[] = [
          'ANDROID_NOTIF',
          'ANDROID_SMS',
          'GMAIL',
          'MANUAL_CSV',
        ];
        const normalizedChannel: ObservationSourceChannel = validChannels.includes(sourceChannel)
          ? sourceChannel
          : 'ANDROID_SMS';

        const fingerprintHash = computeObservationFingerprint(
          merchant.vpa,
          parsed.amountPaise,
          parsed.utr,
          Number(observedAt) || Date.now()
        );

        const existingObs = db
          .prepare('SELECT * FROM bank_observations WHERE fingerprint_hash = ?')
          .get(fingerprintHash) as BankObservation | undefined;

        if (existingObs) {
          res.status(200).json({
            status: 'DUPLICATE_IGNORED',
            message: 'Idempotent replay: observation fingerprint already processed.',
            observation: existingObs,
            parsed,
          });
          return;
        }

        const affectedSessionIds = new Set<string>();
        let matchedSession: CheckoutSession | undefined;
        let savedObservation: BankObservation | undefined;

        const ingestTx = db.transaction(() => {
          matchedSession = db
            .prepare(
              `SELECT * FROM checkout_sessions
               WHERE merchant_id = ?
                 AND amount_paise = ?
                 AND status IN ('PROCESSING', 'ACTIVE')
               ORDER BY
                 CASE WHEN utr = ? THEN 0
                      WHEN status = 'PROCESSING' THEN 1
                      ELSE 2
                 END,
                 created_at ASC
               LIMIT 1`
            )
            .get(merchant.id, parsed.amountPaise, parsed.utr) as
            | CheckoutSession
            | undefined;

          const obsId = `obs_${crypto.randomUUID().slice(0, 12)}`;
          const now = Date.now();

          db.prepare(
            `INSERT INTO bank_observations (
              id, fingerprint_hash, raw_payload, amount_paise, utr, sender_info,
              source_channel, matched_session_id, observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            obsId,
            fingerprintHash,
            rawPayload,
            parsed.amountPaise,
            parsed.utr,
            parsed.senderInfo,
            normalizedChannel,
            matchedSession ? matchedSession.id : null,
            now
          );

          savedObservation = db
            .prepare('SELECT * FROM bank_observations WHERE id = ?')
            .get(obsId) as BankObservation;

          if (matchedSession) {
            db.prepare(
              `UPDATE checkout_sessions
               SET status = 'OBSERVED_SUCCESS',
                   utr = ?,
                   payer_vpa = COALESCE(payer_vpa, ?),
                   queue_position = 0,
                   active_expires_at = NULL,
                   processing_expires_at = NULL
               WHERE id = ?`
            ).run(
              parsed.utr,
              parsed.senderInfo.includes('@') ? parsed.senderInfo : null,
              matchedSession.id
            );

            affectedSessionIds.add(matchedSession.id);

            const updatedSession = db
              .prepare('SELECT * FROM checkout_sessions WHERE id = ?')
              .get(matchedSession.id) as CheckoutSession;
            matchedSession = updatedSession;

            const promoted = promoteNextInQueueSync(
              merchant.id,
              parsed.amountPaise
            );
            promoted.forEach((id) => affectedSessionIds.add(id));
          }
        });

        ingestTx();

        if (matchedSession) {
          await dispatchMerchantWebhook(matchedSession, normalizedChannel);
        }

        for (const sid of affectedSessionIds) {
          await broadcastSessionUpdate(sid);
        }
        await broadcastAdminUpdate();

        res.status(200).json({
          status: matchedSession ? 'MATCHED_AND_VERIFIED' : 'RECORDED_UNMATCHED',
          observation: savedObservation,
          matchedSession: matchedSession
            ? await hydrateSessionForClient(matchedSession)
            : null,
          parsed,
        });
      } catch (err) {
        console.error('Error in /api/observer/ingest:', err);
        res.status(500).json({ error: 'Internal server error processing bank observation' });
      }
    }
  );

  // --- API: Admin Snapshot & SSE Stream ---
  app.get('/api/admin/snapshot', async (_req: Request, res: Response) => {
    const snapshot = await getAdminSnapshot();
    res.json(snapshot);
  });

  app.get('/api/admin/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    adminSubscribers.add(res);
    const snapshot = await getAdminSnapshot();
    sendSseEvent(res, 'admin_snapshot', snapshot);

    req.on('close', () => {
      adminSubscribers.delete(res);
    });
  });

  // --- API: Admin Update Merchant & White-Label Settings ---
  app.put('/api/admin/merchant', async (req: Request, res: Response) => {
    const {
      name,
      vpa,
      PayeeName,
      webhook_url,
      theme_color,
      logo_url,
      gstin,
      support_email,
      queue_mode,
      rotateSecrets,
    } = req.body || {};

    const current = getPrimaryMerchant();
    const nextWebhookSecret = rotateSecrets
      ? `whsec_${crypto.randomBytes(16).toString('hex')}`
      : current.webhook_secret;
    const nextObserverSecret = rotateSecrets
      ? `obs_sec_${crypto.randomBytes(16).toString('hex')}`
      : current.observer_secret;
    const nextApiKeyId = rotateSecrets
      ? `youpi_live_${crypto.randomBytes(8).toString('hex')}`
      : current.api_key_id;
    const nextApiKeySecret = rotateSecrets
      ? `sk_live_${crypto.randomBytes(16).toString('hex')}`
      : current.api_key_secret;

    db.prepare(
      `UPDATE merchants
       SET name = ?,
           vpa = ?,
           PayeeName = ?,
           webhook_url = ?,
           webhook_secret = ?,
           observer_secret = ?,
           api_key_id = ?,
           api_key_secret = ?,
           theme_color = ?,
           logo_url = ?,
           gstin = ?,
           support_email = ?,
           queue_mode = ?
       WHERE id = ?`
    ).run(
      name ?? current.name,
      vpa ?? current.vpa,
      PayeeName ?? current.PayeeName,
      webhook_url ?? current.webhook_url,
      nextWebhookSecret,
      nextObserverSecret,
      nextApiKeyId,
      nextApiKeySecret,
      theme_color ?? current.theme_color,
      logo_url ?? current.logo_url,
      gstin ?? current.gstin,
      support_email ?? current.support_email,
      queue_mode === 'GLOBAL_VPA' ? 'GLOBAL_VPA' : 'VPA_AND_AMOUNT',
      current.id
    );

    qrSvgCache.clear();
    await broadcastAdminUpdate();
    res.json({ merchant: getPrimaryMerchant() });
  });

  // --- API: Admin Pairing QR Code ---
  app.get('/api/admin/pairing-qr', async (req: Request, res: Response) => {
    const merchant = getPrimaryMerchant();
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers.host || 'localhost:3000';
    const ingestEndpoint = `${protocol}://${host}/api/observer/ingest`;

    const pairingPayload = JSON.stringify({
      merchantId: merchant.id,
      merchantName: merchant.name,
      vpa: merchant.vpa,
      endpoint: ingestEndpoint,
      observerSecret: merchant.observer_secret,
    });

    const qrSvg = await getVectorQrSvg(pairingPayload);
    res.json({
      endpoint: ingestEndpoint,
      observerSecret: merchant.observer_secret,
      pairingPayload: JSON.parse(pairingPayload),
      qrSvg,
    });
  });

  // --- API: Bank Statement CSV Reconciliation ---
  app.post('/api/admin/reconcile-csv', async (req: Request, res: Response) => {
    const { csvText = '' } = req.body || {};
    if (!csvText || typeof csvText !== 'string') {
      res.status(400).json({ error: 'csvText is required' });
      return;
    }

    const parsedRows = parseBankStatementCsv(csvText);
    const merchant = getPrimaryMerchant();
    const reconciledSessions: { orderId: string; utr: string; amountPaise: number }[] = [];
    const unmatchedRows: { rowNumber: number; utr: string; amountPaise: number }[] = [];
    const affectedSessionIds = new Set<string>();

    const reconcileTx = db.transaction(() => {
      for (const row of parsedRows) {
        const session = db
          .prepare(
            `SELECT * FROM checkout_sessions
             WHERE merchant_id = ?
               AND amount_paise = ?
               AND (
                 (status IN ('OBSERVED_SUCCESS', 'RECONCILED') AND utr = ?)
                 OR (status IN ('ACTIVE', 'PROCESSING', 'EXPIRED') AND (utr = ? OR utr IS NULL))
               )
             ORDER BY
               CASE WHEN utr = ? THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 1`
          )
          .get(
            merchant.id,
            row.amountPaise,
            row.utr,
            row.utr,
            row.utr
          ) as CheckoutSession | undefined;

        if (session) {
          db.prepare(
            `UPDATE checkout_sessions
             SET status = 'RECONCILED',
                 utr = ?,
                 queue_position = 0
             WHERE id = ?`
          ).run(row.utr, session.id);

          const fp = computeObservationFingerprint(
            merchant.vpa,
            row.amountPaise,
            row.utr,
            Date.now()
          );
          db.prepare(
            `INSERT OR IGNORE INTO bank_observations (
              id, fingerprint_hash, raw_payload, amount_paise, utr, sender_info,
              source_channel, matched_session_id, observed_at
            ) VALUES (?, ?, ?, ?, ?, 'Bank CSV Statement', 'MANUAL_CSV', ?, ?)`
          ).run(
            `obs_csv_${crypto.randomUUID().slice(0, 8)}`,
            fp,
            row.rawLine,
            row.amountPaise,
            row.utr,
            session.id,
            Date.now()
          );

          reconciledSessions.push({
            orderId: session.order_id,
            utr: row.utr,
            amountPaise: row.amountPaise,
          });
          affectedSessionIds.add(session.id);
        } else {
          unmatchedRows.push({
            rowNumber: row.rowNumber,
            utr: row.utr,
            amountPaise: row.amountPaise,
          });
        }
      }
    });

    reconcileTx();

    for (const sid of affectedSessionIds) {
      await broadcastSessionUpdate(sid);
    }
    await broadcastAdminUpdate();

    res.json({
      totalParsedRows: parsedRows.length,
      reconciledCount: reconciledSessions.length,
      reconciledSessions,
      unmatchedRows,
    });
  });

  // --- API: Run Bank Regex Parser Unit Tests ---
  app.get('/api/admin/parser-tests', (_req: Request, res: Response) => {
    res.json(runBankParserUnitTests());
  });

  // ============================================================================
  // 8. Merchant Account Authentication (Login / Signup) & Profile API
  // ============================================================================
  function extractAuthToken(req: Request): string {
    const headerToken = (req.header('X-OpenPay-Token') || '').trim();
    if (headerToken) return headerToken;
    const rawCookie = req.headers.cookie || '';
    for (const part of rawCookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k === 'openpay_auth_token') return decodeURIComponent(v);
      }
    }
    return '';
  }

  function createSessionForUser(req: Request, res: Response, user: UserProfile): string {
    const token = `op_sess_${crypto.randomBytes(24).toString('hex')}`;
    const now = Date.now();
    const expiresAt = now + 1000 * 60 * 60 * 24 * 14; // 14 days
    const userAgent = (req.header('user-agent') || 'Browser Session').slice(0, 180);
    const ipAddress =
      ((req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1')
        .split(',')[0]
        .trim();

    db.prepare(
      `INSERT INTO user_sessions (
        token, user_id, merchant_id, user_agent, ip_address, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(token, user.id, user.merchant_id, userAgent, ipAddress, now, expiresAt);

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);

    res.setHeader(
      'Set-Cookie',
      `openpay_auth_token=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=1209600`
    );
    return token;
  }

  function getAuthenticatedUserFromReq(req: Request): {
    user: UserProfile;
    token: string;
  } | null {
    const token = extractAuthToken(req);
    if (!token) return null;

    const sessRow = db
      .prepare('SELECT * FROM user_sessions WHERE token = ? AND expires_at > ?')
      .get(token, Date.now()) as
      | { token: string; user_id: string; merchant_id: string }
      | undefined;

    if (!sessRow) return null;

    const user = db
      .prepare(
        `SELECT id, full_name, email, phone, role, job_title, avatar_url,
                business_category, pan_number, two_factor_enabled, merchant_id,
                created_at, last_login_at
         FROM users WHERE id = ?`
      )
      .get(sessRow.user_id) as UserProfile | undefined;

    if (!user) return null;
    return { user, token };
  }

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const auth = getAuthenticatedUserFromReq(req);
    if (!auth) {
      res.json({ authenticated: false, user: null, sessions: [] });
      return;
    }

    const rawSessions = db
      .prepare(
        `SELECT token, user_agent, ip_address, created_at, expires_at
         FROM user_sessions
         WHERE user_id = ? AND expires_at > ?
         ORDER BY created_at DESC LIMIT 10`
      )
      .all(auth.user.id, Date.now()) as {
      token: string;
      user_agent: string;
      ip_address: string;
      created_at: number;
      expires_at: number;
    }[];

    const sessions = rawSessions.map((s) => ({
      token_prefix: `${s.token.slice(0, 12)}...`,
      user_agent: s.user_agent,
      ip_address: s.ip_address,
      created_at: s.created_at,
      expires_at: s.expires_at,
      is_current: s.token === auth.token,
    }));

    res.json({
      authenticated: true,
      user: auth.user,
      merchant: getPrimaryMerchant(),
      sessions,
    });
  });

  app.post('/api/auth/signup', async (req: Request, res: Response) => {
    const {
      fullName = '',
      email = '',
      phone = '',
      password = '',
      businessName = '',
      vpa = '',
      businessCategory = 'Software & Digital Services',
    } = req.body || {};

    const cleanName = String(fullName).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone).trim();
    const cleanPassword = String(password);

    if (!cleanName || !cleanEmail.includes('@') || cleanPassword.length < 6) {
      res.status(400).json({
        error: 'Full name, valid email address, and password (min 6 characters) are required.',
      });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE lower(email) = ?')
      .get(cleanEmail) as { id: string } | undefined;

    if (existing) {
      res.status(409).json({
        error: 'An account with this email already exists. Please sign in instead.',
      });
      return;
    }

    const userId = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = Date.now();

    db.prepare(
      `INSERT INTO users (
        id, full_name, email, phone, password_hash, role, job_title, avatar_url,
        business_category, pan_number, two_factor_enabled, merchant_id, created_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, 'Merchant Owner', 'Founder & Managing Director', '', ?, '', 1, ?, ?, ?)`
    ).run(
      userId,
      cleanName,
      cleanEmail,
      cleanPhone,
      hashPassword(cleanPassword),
      String(businessCategory).trim() || 'Software & Digital Services',
      DEFAULT_MERCHANT_ID,
      now,
      now
    );

    if (businessName.trim() || vpa.trim()) {
      const currentMerchant = getPrimaryMerchant();
      db.prepare(
        `UPDATE merchants
         SET name = ?,
             PayeeName = ?,
             vpa = ?,
             support_email = ?
         WHERE id = ?`
      ).run(
        businessName.trim() || currentMerchant.name,
        cleanName || currentMerchant.PayeeName,
        vpa.trim() || currentMerchant.vpa,
        cleanEmail,
        DEFAULT_MERCHANT_ID
      );
      qrSvgCache.clear();
    }

    const user = db
      .prepare(
        `SELECT id, full_name, email, phone, role, job_title, avatar_url,
                business_category, pan_number, two_factor_enabled, merchant_id,
                created_at, last_login_at
         FROM users WHERE id = ?`
      )
      .get(userId) as UserProfile;

    const token = createSessionForUser(req, res, user);
    await broadcastAdminUpdate();

    res.status(201).json({
      authenticated: true,
      token,
      user,
      merchant: getPrimaryMerchant(),
    });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const { email = '', password = '' } = req.body || {};
    const cleanEmail = String(email).trim().toLowerCase();

    const row = db
      .prepare('SELECT * FROM users WHERE lower(email) = ?')
      .get(cleanEmail) as (UserProfile & { password_hash: string }) | undefined;

    if (!row || !verifyPassword(String(password), row.password_hash)) {
      res.status(401).json({
        error: 'Invalid email or password. Please check your credentials and try again.',
      });
      return;
    }

    const { password_hash: _ph, ...user } = row;
    const token = createSessionForUser(req, res, user);
    await broadcastAdminUpdate();

    res.json({
      authenticated: true,
      token,
      user,
      merchant: getPrimaryMerchant(),
    });
  });

  app.post('/api/auth/founder-quick-login', async (req: Request, res: Response) => {
    const user = db
      .prepare(
        `SELECT id, full_name, email, phone, role, job_title, avatar_url,
                business_category, pan_number, two_factor_enabled, merchant_id,
                created_at, last_login_at
         FROM users WHERE id = ? OR email = 'aniketchoudhary9507@gmail.com' LIMIT 1`
      )
      .get(DEFAULT_USER_ID) as UserProfile | undefined;

    if (!user) {
      res.status(404).json({ error: 'Founder profile not found.' });
      return;
    }

    const token = createSessionForUser(req, res, user);
    await broadcastAdminUpdate();

    res.json({
      authenticated: true,
      token,
      user,
      merchant: getPrimaryMerchant(),
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = extractAuthToken(req);
    if (token) {
      db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    }
    res.setHeader(
      'Set-Cookie',
      'openpay_auth_token=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0'
    );
    res.json({ ok: true });
  });

  app.post('/api/auth/revoke-other-sessions', (req: Request, res: Response) => {
    const auth = getAuthenticatedUserFromReq(req);
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND token != ?').run(
      auth.user.id,
      auth.token
    );
    res.json({ ok: true });
  });

  app.put('/api/auth/profile', async (req: Request, res: Response) => {
    const auth = getAuthenticatedUserFromReq(req);
    const targetUserId = auth?.user.id || DEFAULT_USER_ID;

    const {
      full_name,
      email,
      phone,
      job_title,
      avatar_url,
      business_category,
      pan_number,
      two_factor_enabled,
      merchant_name,
      merchant_vpa,
      merchant_gstin,
    } = req.body || {};

    const current = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(targetUserId) as UserProfile | undefined;

    if (!current) {
      res.status(404).json({ error: 'User profile not found.' });
      return;
    }

    db.prepare(
      `UPDATE users
       SET full_name = ?,
           email = ?,
           phone = ?,
           job_title = ?,
           avatar_url = ?,
           business_category = ?,
           pan_number = ?,
           two_factor_enabled = ?
       WHERE id = ?`
    ).run(
      full_name?.trim() || current.full_name,
      email?.trim().toLowerCase() || current.email,
      phone?.trim() ?? current.phone,
      job_title?.trim() ?? current.job_title,
      avatar_url?.trim() ?? current.avatar_url,
      business_category?.trim() ?? current.business_category,
      pan_number?.trim().toUpperCase() ?? current.pan_number,
      two_factor_enabled !== undefined ? (two_factor_enabled ? 1 : 0) : current.two_factor_enabled,
      targetUserId
    );

    if (merchant_name !== undefined || merchant_vpa !== undefined || merchant_gstin !== undefined) {
      const m = getPrimaryMerchant();
      db.prepare(
        `UPDATE merchants
         SET name = ?,
             vpa = ?,
             gstin = ?,
             support_email = ?
         WHERE id = ?`
      ).run(
        merchant_name?.trim() || m.name,
        merchant_vpa?.trim() || m.vpa,
        merchant_gstin?.trim().toUpperCase() ?? m.gstin,
        email?.trim().toLowerCase() || m.support_email,
        m.id
      );
      qrSvgCache.clear();
    }

    const updatedUser = db
      .prepare(
        `SELECT id, full_name, email, phone, role, job_title, avatar_url,
                business_category, pan_number, two_factor_enabled, merchant_id,
                created_at, last_login_at
         FROM users WHERE id = ?`
      )
      .get(targetUserId) as UserProfile;

    await broadcastAdminUpdate();
    res.json({ user: updatedUser, merchant: getPrimaryMerchant() });
  });

  app.post('/api/auth/change-password', (req: Request, res: Response) => {
    const auth = getAuthenticatedUserFromReq(req);
    const targetUserId = auth?.user.id || DEFAULT_USER_ID;
    const { currentPassword = '', newPassword = '' } = req.body || {};

    if (String(newPassword).length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters.' });
      return;
    }

    const row = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(targetUserId) as { password_hash: string } | undefined;

    if (!row || !verifyPassword(String(currentPassword), row.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      hashPassword(String(newPassword)),
      targetUserId
    );

    res.json({ ok: true, message: 'Password updated successfully.' });
  });

  // ============================================================================
  // 9. GitHub OAuth Login & 1-Click Repository Publisher
  // ============================================================================
  interface GitHubAuthSession {
    accessToken: string;
    login: string;
    name: string;
    avatarUrl: string;
    htmlUrl: string;
    connectedAt: number;
  }

  let activeGitHubSession: GitHubAuthSession | null = null;
  const githubSessionsByCookie = new Map<string, GitHubAuthSession>();

  function parseCookieHeader(cookieHeader?: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!cookieHeader) return out;
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
      }
    }
    return out;
  }

  function getGitHubSessionFromReq(req: Request): GitHubAuthSession | null {
    const cookies = parseCookieHeader(req.headers.cookie);
    const sid = cookies['youpi_gh_session'];
    if (sid && githubSessionsByCookie.has(sid)) {
      return githubSessionsByCookie.get(sid) || null;
    }
    return activeGitHubSession;
  }

  function getAppOrigin(req: Request): string {
    if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
      return process.env.APP_URL.replace(/\/+$/, '');
    }
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = req.headers.host || 'localhost:3000';
    return `${proto}://${host}`;
  }

  // --- API: GitHub Auth Status ---
  app.get('/api/github/status', (req: Request, res: Response) => {
    const session = getGitHubSessionFromReq(req);
    const clientIdConfigured = Boolean(
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_ID.trim()
    );
    const clientSecretConfigured = Boolean(
      process.env.GITHUB_CLIENT_SECRET && process.env.GITHUB_CLIENT_SECRET.trim()
    );

    res.json({
      oauthConfigured: clientIdConfigured && clientSecretConfigured,
      clientIdConfigured,
      authenticated: Boolean(session),
      callbackUrl: `${getAppOrigin(req)}/auth/callback`,
      user: session
        ? {
            login: session.login,
            name: session.name,
            avatarUrl: session.avatarUrl,
            htmlUrl: session.htmlUrl,
          }
        : null,
    });
  });

  // --- API: Construct GitHub OAuth Authorization URL for Popup Flow ---
  app.get('/api/github/auth/url', (req: Request, res: Response) => {
    const clientId = (process.env.GITHUB_CLIENT_ID || '').trim();
    if (!clientId) {
      res.status(400).json({
        error:
          'GITHUB_CLIENT_ID is not set in environment variables. Configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in AI Studio Secrets, then click Sign in with GitHub.',
      });
      return;
    }

    // Omit redirect_uri so GitHub uses the exact callback URL registered in the OAuth App settings
    // without ever failing with "The redirect_uri is not associated with this application".
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'repo read:user',
    });

    res.json({
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      redirectUri: `${getAppOrigin(req)}/auth/callback`,
    });
  });

  // --- Shared GitHub OAuth Code Exchange Handler (works for /auth/callback, /callback, or /?code=...) ---
  async function handleGitHubOAuthCodeCallback(req: Request, res: Response) {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const clientId = (process.env.GITHUB_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GITHUB_CLIENT_SECRET || '').trim();

    if (!code || !clientId || !clientSecret) {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; padding: 24px;">
            <h3>GitHub OAuth Incomplete</h3>
            <p>Missing authorization code or GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET environment variables.</p>
          </body>
        </html>
      `);
      return;
    }

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenData.access_token) {
        res.status(400).send(`
          <html>
            <body style="font-family: sans-serif; padding: 24px;">
              <h3>GitHub Login Failed</h3>
              <p>${tokenData.error_description || tokenData.error || 'Could not exchange code for token.'}</p>
            </body>
          </html>
        `);
        return;
      }

      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'YouPI-PG-Gateway',
        },
      });
      const userProfile = (await userRes.json()) as {
        login: string;
        name?: string;
        avatar_url?: string;
        html_url?: string;
      };

      const sessionObj: GitHubAuthSession = {
        accessToken: tokenData.access_token,
        login: userProfile.login,
        name: userProfile.name || userProfile.login,
        avatarUrl: userProfile.avatar_url || '',
        htmlUrl: userProfile.html_url || `https://github.com/${userProfile.login}`,
        connectedAt: Date.now(),
      };

      const sessionId = crypto.randomUUID();
      githubSessionsByCookie.set(sessionId, sessionObj);
      activeGitHubSession = sessionObj;

      res.setHeader(
        'Set-Cookie',
        `youpi_gh_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=86400`
      );

      res.send(`
        <html>
          <body style="font-family: sans-serif; padding: 24px; text-align: center;">
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <h3>GitHub Connected (@${userProfile.login})</h3>
            <p>Authentication successful! This window will close automatically.</p>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('GitHub OAuth Callback Error:', err);
      res.status(500).send('Internal error completing GitHub OAuth flow.');
    }
  }

  // --- OAuth Popup Callback Handler (/auth/callback, /callback, and /?code=...) ---
  app.get(
    ['/auth/callback', '/auth/callback/', '/callback', '/callback/'],
    handleGitHubOAuthCodeCallback
  );

  app.use((req: Request, res: Response, next) => {
    if (
      req.method === 'GET' &&
      (req.path === '/' || req.path === '') &&
      typeof req.query.code === 'string' &&
      req.query.code.length > 5
    ) {
      handleGitHubOAuthCodeCallback(req, res);
      return;
    }
    next();
  });

  // --- API: Logout of GitHub ---
  app.post('/api/github/logout', (req: Request, res: Response) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const sid = cookies['youpi_gh_session'];
    if (sid) {
      githubSessionsByCookie.delete(sid);
    }
    activeGitHubSession = null;
    res.setHeader(
      'Set-Cookie',
      'youpi_gh_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0'
    );
    res.json({ ok: true });
  });

  // --- API: Create Repository & Push All Code + Integration Docs to User's GitHub ---
  app.post('/api/github/create-repo', async (req: Request, res: Response) => {
    const session = getGitHubSessionFromReq(req);
    if (!session) {
      res.status(401).json({
        error: 'Please sign in with your GitHub account first.',
      });
      return;
    }

    const {
      repoName = 'youpi-pg',
      description = 'Self-Hosted Zero-Fee UPI Payment Gateway & Universal Checkout Suite (0% MDR, Atomic FIFO Queue, Signed Bank Webhooks)',
      isPrivate = false,
    } = req.body || {};

    const cleanRepoName = String(repoName)
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '-');

    if (!cleanRepoName) {
      res.status(400).json({ error: 'A valid repository name is required.' });
      return;
    }

    const ghHeaders = {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'YouPI-PG-Gateway',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    try {
      // 1. Create the repository (or fetch it if it already exists under the user's account)
      let repoData: {
        name: string;
        full_name: string;
        html_url: string;
        default_branch: string;
        owner: { login: string };
      } | null = null;

      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({
          name: cleanRepoName,
          description: String(description).trim(),
          private: Boolean(isPrivate),
          auto_init: true,
        }),
      });

      if (createRes.ok) {
        repoData = await createRes.json();
      } else if (createRes.status === 422) {
        // Repo might already exist in the user's account; fetch it so we can push the latest files
        const existingRes = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(session.login)}/${encodeURIComponent(cleanRepoName)}`,
          { headers: ghHeaders }
        );
        if (existingRes.ok) {
          repoData = await existingRes.json();
        } else {
          const errBody = await createRes.json().catch(() => ({}));
          res.status(422).json({
            error:
              (errBody as { message?: string }).message ||
              `Repository "${cleanRepoName}" could not be created.`,
          });
          return;
        }
      } else {
        const errBody = await createRes.json().catch(() => ({}));
        res.status(createRes.status).json({
          error:
            (errBody as { message?: string }).message ||
            'Failed to create GitHub repository.',
        });
        return;
      }

      if (!repoData) {
        res.status(500).json({ error: 'Unexpected empty repository response from GitHub.' });
        return;
      }

      const owner = repoData.owner.login;
      const repo = repoData.name;
      const branch = repoData.default_branch || 'main';

      // 2. Collect all project files from the workspace
      const filesToPublish = [
        'README.md',
        '.env.example',
        '.gitignore',
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'index.html',
        'metadata.json',
        'server.ts',
        'public/sdk.js',
        'android-observer/YoupiObserverApp.kt',
        'src/main.tsx',
        'src/App.tsx',
        'src/index.css',
        'src/lib/types.ts',
        'src/lib/bank-parser.ts',
        'src/lib/bank-parser.test.ts',
        'src/components/AdminDashboard.tsx',
        'src/components/CustomerCheckoutModal.tsx',
        'src/components/PaymentLinkView.tsx',
        'src/components/AuthView.tsx',
        'src/components/ProfileView.tsx',
      ];

      const treeItems: {
        path: string;
        mode: '100644';
        type: 'blob';
        content: string;
      }[] = [];

      for (const relPath of filesToPublish) {
        const absPath = path.resolve(__dirname, relPath);
        if (fs.existsSync(absPath)) {
          const content = fs.readFileSync(absPath, 'utf8');
          treeItems.push({
            path: relPath,
            mode: '100644',
            type: 'blob',
            content,
          });
        }
      }

      // 3. Get the latest commit SHA on the default branch
      const refRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
        { headers: ghHeaders }
      );

      if (!refRes.ok) {
        // Fallback: if repository had no initial commit yet, push files via Contents API sequentially
        for (const item of treeItems) {
          await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${item.path}`,
            {
              method: 'PUT',
              headers: ghHeaders,
              body: JSON.stringify({
                message: `Add ${item.path}`,
                content: Buffer.from(item.content, 'utf8').toString('base64'),
                branch,
              }),
            }
          );
        }

        res.status(201).json({
          repoUrl: repoData.html_url,
          fullName: repoData.full_name,
          branch,
          filesCommittedCount: treeItems.length,
        });
        return;
      }

      const refData = (await refRes.json()) as { object: { sha: string } };
      const latestCommitSha = refData.object.sha;

      // 4. Create a new Git Tree with all project files
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees`,
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            base_tree: latestCommitSha,
            tree: treeItems,
          }),
        }
      );

      if (!treeRes.ok) {
        const errText = await treeRes.text();
        res.status(500).json({ error: `Failed to create Git tree: ${errText}` });
        return;
      }

      const treeData = (await treeRes.json()) as { sha: string };

      // 5. Create the Commit
      const commitRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/commits`,
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            message:
              'feat: publish complete YouPI-PG Zero-Fee UPI Payment Gateway & Universal Integration Suite',
            tree: treeData.sha,
            parents: [latestCommitSha],
          }),
        }
      );

      if (!commitRes.ok) {
        const errText = await commitRes.text();
        res.status(500).json({ error: `Failed to create Git commit: ${errText}` });
        return;
      }

      const commitData = (await commitRes.json()) as { sha: string };

      // 6. Update branch reference to point to new commit
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
        {
          method: 'PATCH',
          headers: ghHeaders,
          body: JSON.stringify({
            sha: commitData.sha,
            force: true,
          }),
        }
      );

      res.status(201).json({
        repoUrl: repoData.html_url,
        fullName: repoData.full_name,
        branch,
        filesCommittedCount: treeItems.length,
        commitSha: commitData.sha,
      });
    } catch (err) {
      console.error('Error creating/pushing GitHub repo:', err);
      res.status(500).json({
        error: 'Internal server error while publishing repository to GitHub.',
      });
    }
  });

  // --- Vite Middleware / Production Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`YouPI-PG Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
