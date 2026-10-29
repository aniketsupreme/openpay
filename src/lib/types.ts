export type CheckoutSessionStatus =
  | 'OTP_PENDING'
  | 'QUEUED'
  | 'ACTIVE'
  | 'PROCESSING'
  | 'OBSERVED_SUCCESS'
  | 'RECONCILED'
  | 'EXPIRED'
  | 'CANCELLED';

export type SourceChannel =
  | 'ANDROID_NOTIF'
  | 'ANDROID_SMS'
  | 'GMAIL'
  | 'MANUAL_CSV';

export interface Merchant {
  id: string;
  name: string;
  vpa: string;
  PayeeName: string;
  webhook_url: string;
  webhook_secret: string;
  observer_secret: string;
  api_key_id: string;
  api_key_secret: string;
  theme_color: string;
  logo_url: string;
  gstin: string;
  support_email: string;
  queue_mode: 'VPA_AND_AMOUNT' | 'GLOBAL_VPA';
  last_heartbeat_at: number | null;
}

export interface CheckoutSession {
  id: string;
  merchant_id: string;
  order_id: string;
  amount_paise: number;
  customer_phone: string;
  customer_name: string;
  customer_email?: string;
  payer_vpa?: string | null;
  payment_link_id?: string | null;
  refund_status?: 'NONE' | 'PARTIAL' | 'FULL';
  refunded_paise?: number;
  status: CheckoutSessionStatus;
  queue_position: number;
  active_expires_at: number | null;
  processing_expires_at: number | null;
  utr: string | null;
  callback_url: string | null;
  created_at: number;
  updated_at?: number;
  // Computed / hydrated fields for checkout view
  merchant?: {
    name: string;
    vpa: string;
    PayeeName: string;
    theme_color: string;
    logo_url: string;
    gstin?: string;
    support_email?: string;
  };
  upi_intents?: {
    generic: string;
    gpay: string;
    phonepe: string;
    paytm: string;
    bhim: string;
    cred: string;
  };
  qr_svg?: string;
  payment_signature?: string;
  server_now?: number;
}

export interface PaymentLink {
  id: string;
  short_code: string;
  merchant_id: string;
  title: string;
  description: string;
  amount_paise: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  status: 'ACTIVE' | 'PAID' | 'CANCELLED';
  paid_session_id: string | null;
  utr: string | null;
  views_count: number;
  created_at: number;
}

export interface RefundRecord {
  id: string;
  session_id: string;
  order_id: string;
  amount_paise: number;
  reason: string;
  customer_vpa: string;
  refund_upi_uri: string;
  status: 'PROCESSED' | 'INITIATED';
  created_at: number;
}

export interface BankObservation {
  id: string;
  fingerprint_hash: string;
  raw_payload: string;
  amount_paise: number;
  utr: string;
  sender_info: string;
  source_channel: SourceChannel;
  matched_session_id: string | null;
  observed_at: number;
}

export interface WebhookDeliveryLog {
  id: string;
  session_id: string;
  order_id: string;
  target_url: string;
  signature: string;
  payload: string;
  status_code: number;
  delivered_at: number;
}

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  job_title: string;
  avatar_url: string;
  business_category: string;
  pan_number: string;
  two_factor_enabled: number;
  merchant_id: string;
  created_at: number;
  last_login_at: number;
}

export interface UserSessionRecord {
  token_prefix: string;
  user_agent: string;
  ip_address: string;
  created_at: number;
  expires_at: number;
  is_current: boolean;
}

export interface CustomerSummary {
  key: string;
  name: string;
  phone: string;
  email: string;
  vpa: string;
  totalSpentPaise: number;
  paymentsCount: number;
  lastPaymentAt: number;
}

export interface AdminDashboardSnapshot {
  user?: UserProfile;
  merchant: Merchant;
  sessions: CheckoutSession[];
  paymentLinks: PaymentLink[];
  refunds: RefundRecord[];
  observations: BankObservation[];
  webhooks: WebhookDeliveryLog[];
  customers?: CustomerSummary[];
  metrics: {
    totalVolumePaise: number;
    netVolumePaise: number;
    refundedVolumePaise: number;
    verifiedCount: number;
    reconciledCount: number;
    activeSlotCount: number;
    queuedCount: number;
    activePaymentLinksCount: number;
    observerConnected: boolean;
    conversionRatePercent?: number;
  };
  serverNow: number;
}

