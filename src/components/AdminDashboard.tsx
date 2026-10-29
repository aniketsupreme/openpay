import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  Upload,
  Search,
  ExternalLink,
  Plus,
  Download,
  Share2,
  Code2,
  RefreshCw,
} from 'lucide-react';
import { AdminDashboardSnapshot, CheckoutSession, UserProfile } from '../lib/types';
import { formatPaiseToInr, parseRupeesToPaise } from '../lib/bank-parser';
import { ProfileView } from './ProfileView';

export type AdminTabType =
  | 'transactions'
  | 'links'
  | 'buttons'
  | 'reconcile'
  | 'settings'
  | 'profile';

interface AdminDashboardProps {
  snapshot: AdminDashboardSnapshot | null;
  activeSubTab: AdminTabType;
  currentUser: UserProfile | null;
  authToken: string;
  onSubTabChange: (tab: AdminTabType) => void;
  onOpenCheckoutModal: (sessionId: string) => void;
  onRefresh: () => void;
  onProfileUpdated: (user: UserProfile) => void;
  onSignOut: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  snapshot,
  activeSubTab,
  currentUser,
  authToken,
  onSubTabChange,
  onOpenCheckoutModal,
  onRefresh,
  onProfileUpdated,
  onSignOut,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Create Order State
  const [newOrderId, setNewOrderId] = useState('');
  const [newOrderRupees, setNewOrderRupees] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Manual UTR Verification State
  const [verifyingSessionId, setVerifyingSessionId] = useState<string | null>(null);
  const [adminUtrInput, setAdminUtrInput] = useState('');
  const [adminUtrError, setAdminUtrError] = useState<string | null>(null);

  // Refund State
  const [refundingSession, setRefundingSession] = useState<CheckoutSession | null>(null);
  const [refundVpa, setRefundVpa] = useState('');
  const [refundReason, setRefundReason] = useState('Customer requested refund');
  const [refundError, setRefundError] = useState<string | null>(null);

  // Payment Link State
  const [linkTitle, setLinkTitle] = useState('');
  const [linkDesc, setLinkDesc] = useState('');
  const [linkRupees, setLinkRupees] = useState('');
  const [linkCustomerName, setLinkCustomerName] = useState('');
  const [linkCustomerPhone, setLinkCustomerPhone] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);

  // Payment Button Builder State
  const [btnLabel, setBtnLabel] = useState('Pay Now');
  const [btnAmount, setBtnAmount] = useState('499');
  const [btnColor, setBtnColor] = useState('#2563EB');

  // CSV Reconciliation State
  const [csvText, setCsvText] = useState<string>('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<{
    totalParsedRows: number;
    reconciledCount: number;
    reconciledSessions: { orderId: string; utr: string; amountPaise: number }[];
    unmatchedRows: { rowNumber: number; utr: string; amountPaise: number }[];
  } | null>(null);

  // Pairing QR State
  const [pairingData, setPairingData] = useState<{
    endpoint: string;
    observerSecret: string;
    qrSvg: string;
  } | null>(null);

  // Settings State
  const [formName, setFormName] = useState('');
  const [formVpa, setFormVpa] = useState('');
  const [formPayeeName, setFormPayeeName] = useState('');
  const [formGstin, setFormGstin] = useState('');
  const [formSupportEmail, setFormSupportEmail] = useState('');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');
  const [formThemeColor, setFormThemeColor] = useState('#2563EB');
  const [formQueueMode, setFormQueueMode] = useState<'VPA_AND_AMOUNT' | 'GLOBAL_VPA'>(
    'VPA_AND_AMOUNT'
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);

  // GitHub OAuth & Repo Publisher State
  const [githubStatus, setGithubStatus] = useState<{
    oauthConfigured: boolean;
    clientIdConfigured: boolean;
    authenticated: boolean;
    callbackUrl: string;
    user: {
      login: string;
      name: string;
      avatarUrl: string;
      htmlUrl: string;
    } | null;
  } | null>(null);
  const [ghRepoName, setGhRepoName] = useState('openpay');
  const [ghRepoDesc, setGhRepoDesc] = useState(
    'OpenPay - By Aniket: Self-Hosted Zero-Fee UPI Payment Gateway & Universal Checkout Suite (0% MDR, Atomic FIFO Queue, Signed Bank Webhooks)'
  );
  const [ghIsPrivate, setGhIsPrivate] = useState(false);
  const [publishingRepo, setPublishingRepo] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [publishedRepoResult, setPublishedRepoResult] = useState<{
    repoUrl: string;
    fullName: string;
    filesCommittedCount: number;
    branch: string;
  } | null>(null);

  const fetchGithubStatus = async () => {
    try {
      const res = await fetch('/api/github/status');
      if (res.ok) {
        const data = await res.json();
        setGithubStatus(data);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchGithubStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setGhError(null);
        fetchGithubStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGitHubSignIn = async () => {
    setGhError(null);
    try {
      const res = await fetch('/api/github/auth/url');
      const data = await res.json();
      if (!res.ok || !data.url) {
        setGhError(
          data.error ||
            'Configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in AI Studio Secrets first.'
        );
        return;
      }
      const authWindow = window.open(
        data.url,
        'oauth_popup',
        'width=600,height=700'
      );
      if (!authWindow) {
        setGhError('Popup blocked by browser. Please allow popups for this site and try again.');
      }
    } catch {
      setGhError('Failed to start GitHub OAuth login.');
    }
  };

  const handleGitHubLogout = async () => {
    await fetch('/api/github/logout', { method: 'POST' });
    setPublishedRepoResult(null);
    fetchGithubStatus();
  };

  const handleCreateGitHubRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    setGhError(null);
    setPublishedRepoResult(null);
    try {
      setPublishingRepo(true);
      const res = await fetch('/api/github/create-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoName: ghRepoName,
          description: ghRepoDesc,
          isPrivate: ghIsPrivate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGhError(data.error || 'Failed to create GitHub repository.');
      } else {
        setPublishedRepoResult(data);
      }
    } catch {
      setGhError('Network error while publishing repository to GitHub.');
    } finally {
      setPublishingRepo(false);
    }
  };

  useEffect(() => {
    if (snapshot?.merchant) {
      setFormName(snapshot.merchant.name);
      setFormVpa(snapshot.merchant.vpa);
      setFormPayeeName(snapshot.merchant.PayeeName);
      setFormGstin(snapshot.merchant.gstin || '');
      setFormSupportEmail(snapshot.merchant.support_email || '');
      setFormWebhookUrl(snapshot.merchant.webhook_url);
      setFormThemeColor(
        snapshot.merchant.theme_color === '#10B981'
          ? '#2563EB'
          : snapshot.merchant.theme_color
      );
      setFormQueueMode(snapshot.merchant.queue_mode || 'VPA_AND_AMOUNT');
    }
  }, [snapshot?.merchant?.id]);

  useEffect(() => {
    if (activeSubTab === 'settings') {
      fetch('/api/admin/pairing-qr')
        .then((r) => r.json())
        .then((d) => setPairingData(d))
        .catch(() => {});
    }
  }, [activeSubTab, snapshot?.merchant?.observer_secret]);

  const handleCopy = (val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    const amountPaise = parseRupeesToPaise(newOrderRupees);
    if (amountPaise < 100) {
      setOrderError('Enter an amount of at least ₹1.00');
      return;
    }

    try {
      setCreatingOrder(true);
      const res = await fetch('/api/checkout/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: newOrderId.trim() || undefined,
          amountPaise,
          customerName: newCustomerName.trim(),
          customerPhone: newCustomerPhone.trim(),
          customerEmail: newCustomerEmail.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOrderError(data.error || 'Failed to create order');
      } else if (data.session) {
        setNewOrderId('');
        setNewOrderRupees('');
        setNewCustomerName('');
        setNewCustomerPhone('');
        setNewCustomerEmail('');
        onRefresh();
        onOpenCheckoutModal(data.session.id);
      }
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleConfirmUtrByAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingSessionId) return;
    setAdminUtrError(null);

    const res = await fetch(
      `/api/admin/sessions/${encodeURIComponent(verifyingSessionId)}/confirm-utr`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utr: adminUtrInput }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      setAdminUtrError(data.error || 'Failed to confirm UTR');
    } else {
      setVerifyingSessionId(null);
      setAdminUtrInput('');
      onRefresh();
    }
  };

  const handleIssueRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundingSession) return;
    setRefundError(null);

    const res = await fetch(
      `/api/admin/sessions/${encodeURIComponent(refundingSession.id)}/refund`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountPaise: refundingSession.amount_paise,
          customerVpa: refundVpa,
          reason: refundReason,
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      setRefundError(data.error || 'Failed to issue refund');
    } else {
      setRefundingSession(null);
      setRefundVpa('');
      onRefresh();
    }
  };

  const handleReplayWebhook = async (sessionId: string) => {
    await fetch(`/api/admin/sessions/${encodeURIComponent(sessionId)}/replay-webhook`, {
      method: 'POST',
    });
    onRefresh();
  };

  const handleExportTransactionsCsv = () => {
    if (!snapshot) return;
    const header = [
      'Order ID',
      'Session ID',
      'Customer Name',
      'Customer Phone',
      'Customer Email',
      'Amount (INR)',
      'Status',
      '12-Digit UTR',
      'Payer VPA',
      'Refund Status',
      'Created At',
    ].join(',');

    const rows = snapshot.sessions.map((s) =>
      [
        `"${s.order_id}"`,
        `"${s.id}"`,
        `"${(s.customer_name || '').replace(/"/g, '""')}"`,
        `"${s.customer_phone || ''}"`,
        `"${s.customer_email || ''}"`,
        (s.amount_paise / 100).toFixed(2),
        s.status,
        s.utr || '',
        s.payer_vpa || '',
        s.refund_status || 'NONE',
        new Date(s.created_at).toISOString(),
      ].join(',')
    );

    const blob = new Blob([[header, ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openpay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTaxInvoice = (s: CheckoutSession) => {
    if (!snapshot) return;
    const m = snapshot.merchant;
    const invoiceLines = [
      '============================================================',
      `                 ${m.name.toUpperCase()} — TAX INVOICE / RECEIPT`,
      '============================================================',
      `Merchant Brand    : ${m.name}`,
      `Beneficiary VPA   : ${m.vpa}`,
      `GSTIN             : ${m.gstin || 'Unregistered / Exempt'}`,
      `Support Email     : ${m.support_email || 'aniketchoudhary9507@gmail.com'}`,
      '------------------------------------------------------------',
      `Invoice / Order   : ${s.order_id}`,
      `Payment ID        : ${s.id}`,
      `12-Digit Bank UTR : ${s.utr || 'Pending'}`,
      `Customer Name     : ${s.customer_name || 'Customer'}`,
      `Customer Phone    : ${s.customer_phone || '—'}`,
      `Customer Email    : ${s.customer_email || '—'}`,
      `Customer VPA      : ${s.payer_vpa || '—'}`,
      '------------------------------------------------------------',
      `Total Paid (INR)  : ${formatPaiseToInr(s.amount_paise)}`,
      `Platform Fee      : ₹0.00 (0% Direct-to-Bank UPI)`,
      `Payment Status    : ${s.status}`,
      `Issued At         : ${new Date(s.created_at).toLocaleString()}`,
      '============================================================',
      '        Generated by OpenPay — By Aniket Payment Suite      ',
      '============================================================',
    ].join('\n');

    const blob = new Blob([invoiceLines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OpenPay-Invoice-${s.order_id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreatePaymentLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountPaise = parseRupeesToPaise(linkRupees);
    if (!linkTitle.trim() || amountPaise < 100) return;

    try {
      setCreatingLink(true);
      const res = await fetch('/api/admin/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: linkTitle,
          description: linkDesc,
          amountPaise,
          customerName: linkCustomerName,
          customerPhone: linkCustomerPhone,
        }),
      });
      if (res.ok) {
        setLinkTitle('');
        setLinkDesc('');
        setLinkRupees('');
        setLinkCustomerName('');
        setLinkCustomerPhone('');
        onRefresh();
      }
    } finally {
      setCreatingLink(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        setCsvText(ev.target.result);
      }
    };
    reader.readAsText(file);
  };

  const handleRunReconciliation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) return;
    try {
      setReconciling(true);
      const res = await fetch('/api/admin/reconcile-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (res.ok) {
        setReconcileReport(data);
        onRefresh();
      }
    } finally {
      setReconciling(false);
    }
  };

  const handleSaveMerchantSettings = async (e: React.FormEvent, rotateSecrets = false) => {
    e.preventDefault();
    try {
      setSavingSettings(true);
      setSettingsSavedMsg(null);
      const res = await fetch('/api/admin/merchant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          vpa: formVpa,
          PayeeName: formPayeeName,
          gstin: formGstin,
          support_email: formSupportEmail,
          webhook_url: formWebhookUrl,
          theme_color: formThemeColor,
          queue_mode: formQueueMode,
          rotateSecrets,
        }),
      });
      if (res.ok) {
        setSettingsSavedMsg(
          rotateSecrets ? 'API & Webhook secrets rotated and saved.' : 'Merchant settings saved.'
        );
        onRefresh();
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCancelSession = async (sessionId: string) => {
    await fetch(`/api/checkout/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      method: 'POST',
    });
    onRefresh();
  };

  if (!snapshot) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="h-64 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  const activeSlots = snapshot.sessions.filter(
    (s) => s.status === 'ACTIVE' || s.status === 'PROCESSING'
  );
  const queuedSessions = snapshot.sessions.filter((s) => s.status === 'QUEUED');

  const filteredSessions = snapshot.sessions.filter((s) => {
    const matchesStatus = statusFilter === 'ALL' || s.status === statusFilter;
    const matchesQuery =
      !searchQuery.trim() ||
      s.order_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.utr && s.utr.includes(searchQuery.trim()));
    return matchesStatus && matchesQuery;
  });

  const baseUrl = window.location.origin;

  const htmlButtonSnippet = `<!-- 1. Add OpenPay Script once in your HTML <head> or before </body> -->
<script src="${baseUrl}/sdk.js" defer></script>

<!-- 2. Place Payment Button anywhere on your page -->
<button
  data-youpi-pay
  data-amount="${btnAmount || '499'}"
  data-order-id="ORD-${Math.floor(1000 + Math.random() * 9000)}"
  style="background:${btnColor};color:#ffffff;padding:12px 24px;border-radius:8px;border:none;font-weight:600;cursor:pointer;">
  ${btnLabel || 'Pay Now'} · ₹${btnAmount || '499'}
</button>`;

  const jsProgrammaticSnippet = `<script src="${baseUrl}/sdk.js"></script>
<script>
  function startPayment() {
    window.YoupiPG.open({
      amount: 499.00,
      orderId: 'ORD_' + Date.now(),
      customer: {
        name: 'Customer Name',
        phone: '+91 9876543210',
        email: 'customer@domain.com'
      },
      onSuccess: function (response) {
        // response = { sessionId, orderId, amountPaise, utr, signature }
        console.log('Payment Verified! 12-Digit UTR:', response.utr);
      }
    });
  }
</script>`;

  const backendOrderSnippet = `// Step 1: Create an Order from your Backend (Node.js / Python / PHP)
const response = await fetch('${baseUrl}/api/v1/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: 49900, // ₹499.00 in integer paise
    currency: 'INR',
    receipt: 'rcpt_101',
    notes: { customer_name: 'Aarav', customer_phone: '+919876543210' }
  })
});
const order = await response.json();
// Redirect customer to order.checkout_url or pass order.checkout_session_id to YoupiPG.open({ sessionId })

// Step 2: Verify Payment Signature on your Backend
const verifyRes = await fetch('${baseUrl}/api/v1/payments/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    youpi_order_id: response.orderId,
    youpi_payment_id: response.sessionId,
    youpi_signature: response.signature
  })
});`;

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-8 space-y-8">
      {/* Prominent GitHub OAuth Login & 1-Click Repository Publisher Banner */}
      {activeSubTab !== 'settings' && (
        <div className="p-5 rounded-xl bg-white border border-blue-200 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-display font-bold text-slate-900">
                GitHub OAuth Connected — Publish Complete OpenPay Repository
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {githubStatus?.authenticated && githubStatus.user
                ? `Signed in as @${githubStatus.user.login}. Click "Create Repo & Push All" to create your repository and push all 20 files + integration docs.`
                : 'Click "Sign in with GitHub" on the right to authorize your account and automatically create the repository in your GitHub.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0 text-xs">
            {!githubStatus?.authenticated ? (
              <button
                type="button"
                onClick={handleGitHubSignIn}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-display font-semibold flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <span>Sign in with GitHub</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            ) : (
              <form onSubmit={handleCreateGitHubRepo} className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium">
                  @{githubStatus.user?.login}
                </span>
                <input
                  type="text"
                  required
                  value={ghRepoName}
                  onChange={(e) => setGhRepoName(e.target.value)}
                  placeholder="openpay"
                  className="w-36 px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
                <button
                  type="submit"
                  disabled={publishingRepo}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-display font-semibold cursor-pointer shadow-xs"
                >
                  {publishingRepo ? 'Pushing 20 Files...' : 'Create Repo & Push All'}
                </button>
              </form>
            )}
          </div>

          {ghError && (
            <div className="w-full p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {ghError}
            </div>
          )}

          {publishedRepoResult && (
            <div className="w-full p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-xs">
              <div className="font-semibold text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>
                  Created {publishedRepoResult.fullName} ({publishedRepoResult.filesCommittedCount}{' '}
                  files pushed)!
                </span>
              </div>
              <a
                href={publishedRepoResult.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1"
              >
                <span>Open Repo</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* KPI Metric Strip — Crisp Razorpay White Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
          <div className="text-xs font-medium text-slate-500">Net Collected Volume</div>
          <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
            {formatPaiseToInr(snapshot.metrics.netVolumePaise)}
          </div>
          <div className="text-xs text-slate-500 font-mono truncate">
            VPA: {snapshot.merchant.vpa}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
          <div className="text-xs font-medium text-slate-500">Live Queue & Slots</div>
          <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
            {snapshot.metrics.activeSlotCount}{' '}
            <span className="text-sm font-normal text-blue-600">Active</span> ·{' '}
            {snapshot.metrics.queuedCount}{' '}
            <span className="text-sm font-normal text-amber-600">Queued</span>
          </div>
          <div className="text-xs text-slate-500">
            {snapshot.merchant.queue_mode === 'GLOBAL_VPA'
              ? 'Global VPA Lock'
              : 'Per [VPA + Exact Amount] Lock'}
          </div>
        </div>

        <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
          <div className="text-xs font-medium text-slate-500">Verified & Reconciled</div>
          <div className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
            {snapshot.metrics.verifiedCount}{' '}
            <span className="text-sm font-normal text-slate-500">Captured</span> ·{' '}
            {snapshot.metrics.reconciledCount}{' '}
            <span className="text-sm font-normal text-emerald-600">Settled</span>
          </div>
          <div className="text-xs text-emerald-600 font-medium">0% Platform MDR Fee</div>
        </div>

        <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
          <div className="text-xs font-medium text-slate-500">Android Bank Observer</div>
          <div className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2
              className={`w-4 h-4 shrink-0 ${
                snapshot.metrics.observerConnected ? 'text-emerald-600' : 'text-slate-400'
              }`}
            />
            <span>
              {snapshot.metrics.observerConnected ? 'Connected' : 'Ready for Webhook'}
            </span>
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {snapshot.observations.length} signed bank alerts
          </div>
        </div>
      </div>

      {/* TAB 1: TRANSACTIONS, ORDERS & LIVE QUEUE */}
      {activeSubTab === 'transactions' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Create Order Card */}
            <form
              onSubmit={handleCreateOrder}
              className="lg:col-span-5 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between space-y-4"
            >
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-display font-bold text-slate-900">
                    Create Order / Checkout Session
                  </h2>
                  <p className="text-xs text-slate-500">
                    Generate a live UPI QR & Intent checkout session for a customer.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="block text-slate-700 font-medium">Amount (INR) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={newOrderRupees}
                      onChange={(e) => setNewOrderRupees(e.target.value)}
                      placeholder="499.00"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600 tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-slate-700 font-medium">Order / Receipt ID</label>
                    <input
                      type="text"
                      value={newOrderId}
                      onChange={(e) => setNewOrderId(e.target.value)}
                      placeholder="Auto-generated"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-slate-700 font-medium">Customer Name</label>
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder="Customer Name"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-slate-700 font-medium">Customer Phone</label>
                    <input
                      type="tel"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                {orderError && <p className="text-xs text-rose-600">{orderError}</p>}
              </div>

              <button
                type="submit"
                disabled={creatingOrder}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-display font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>{creatingOrder ? 'Creating Order...' : 'Create & Launch Checkout'}</span>
              </button>
            </form>

            {/* Live UPI Slots & FIFO Queue */}
            <div className="lg:col-span-7 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-display font-bold text-slate-900">
                      Live UPI Payment Slots & Waiting Queue
                    </h2>
                    <p className="text-xs text-slate-500">
                      Real-time queue state for receiving VPA{' '}
                      <span className="font-mono text-slate-800">{snapshot.merchant.vpa}</span>
                    </p>
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-600 tabular-nums">
                    {activeSlots.length} Active · {queuedSessions.length} Queued
                  </span>
                </div>

                {activeSlots.length === 0 && queuedSessions.length === 0 ? (
                  <div className="py-10 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-center">
                    <p className="text-xs text-slate-500">
                      All UPI payment slots are currently open. Create an order on the left or share
                      a Payment Link to accept payments.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-slate-50/40 max-h-56 overflow-y-auto">
                    {[...activeSlots, ...queuedSessions].map((slot) => (
                      <div
                        key={slot.id}
                        className="p-3.5 flex items-center justify-between gap-4 text-xs bg-white hover:bg-slate-50"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="font-mono text-slate-900 flex items-center gap-2">
                            <span className="font-bold text-blue-600 tabular-nums">
                              {formatPaiseToInr(slot.amount_paise)}
                            </span>
                            <span className="text-slate-300">·</span>
                            <span className="font-semibold">{slot.order_id}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-amber-600 font-semibold">
                              {slot.status}
                              {slot.status === 'QUEUED' ? ` (#${slot.queue_position})` : ''}
                            </span>
                          </div>
                          <div className="text-slate-500 truncate">
                            {slot.customer_name || 'Customer'}
                            {slot.payer_vpa ? ` (${slot.payer_vpa})` : ''}
                            {slot.utr ? ` · Customer UTR: ${slot.utr}` : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => onOpenCheckoutModal(slot.id)}
                            className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium cursor-pointer"
                          >
                            Checkout
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setVerifyingSessionId(slot.id);
                              setAdminUtrInput(slot.utr || '');
                            }}
                            className="px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-medium cursor-pointer"
                          >
                            Verify UTR
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelSession(slot.id)}
                            className="px-2.5 py-1 rounded-md border border-slate-200 hover:border-rose-300 text-slate-500 hover:text-rose-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {verifyingSessionId && (
                <form
                  onSubmit={handleConfirmUtrByAdmin}
                  className="p-3 rounded-xl bg-slate-50 border border-blue-200 flex flex-wrap items-center gap-2 text-xs"
                >
                  <span className="text-slate-700 font-medium">Enter 12-Digit Bank UTR:</span>
                  <input
                    type="text"
                    maxLength={12}
                    value={adminUtrInput}
                    onChange={(e) => setAdminUtrInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 630112345678"
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer"
                  >
                    Confirm Payment
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerifyingSessionId(null)}
                    className="px-2 py-1.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  {adminUtrError && (
                    <span className="text-rose-600 w-full">{adminUtrError}</span>
                  )}
                </form>
              )}
            </div>
          </div>

          {/* Refund Form Modal if triggered */}
          {refundingSession && (
            <form
              onSubmit={handleIssueRefund}
              className="p-5 rounded-xl bg-white border border-amber-300 shadow-md space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-display font-bold text-slate-900">
                  Issue Direct UPI Refund for Order {refundingSession.order_id} (
                  {formatPaiseToInr(refundingSession.amount_paise)})
                </h3>
                <button
                  type="button"
                  onClick={() => setRefundingSession(null)}
                  className="text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={refundVpa}
                  onChange={(e) => setRefundVpa(e.target.value)}
                  placeholder="Customer UPI VPA (e.g. customer@okicici)"
                  className="px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900"
                />
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Refund reason"
                  className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900"
                />
              </div>
              {refundError && <p className="text-rose-600">{refundError}</p>}
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
              >
                Process Refund
              </button>
            </form>
          )}

          {/* Transactions Table */}
          <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-display font-bold text-slate-900">
                  Transactions & Orders
                </h2>
                {snapshot.sessions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportTransactionsCsv}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Order ID, Customer, UTR..."
                    className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
                  {['ALL', 'ACTIVE', 'QUEUED', 'OBSERVED_SUCCESS', 'RECONCILED'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        statusFilter === st
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st === 'OBSERVED_SUCCESS' ? 'CAPTURED' : st}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                No transactions recorded yet. Create an order above or share a Payment Link.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="py-3 px-4 font-medium">Order ID</th>
                      <th className="py-3 px-4 font-medium">Payment ID</th>
                      <th className="py-3 px-4 font-medium">Customer</th>
                      <th className="py-3 px-4 font-medium text-right">Amount</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-4 font-medium">12-Digit UTR</th>
                      <th className="py-3 px-4 font-medium text-right">Created</th>
                      <th className="py-3 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {filteredSessions.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/80 text-slate-700">
                        <td className="py-3 px-4 font-semibold text-slate-900">{s.order_id}</td>
                        <td className="py-3 px-4 text-slate-500">{s.id}</td>
                        <td className="py-3 px-4 font-sans">
                          <span className="text-slate-900 font-medium">
                            {s.customer_name || '—'}
                          </span>
                          {s.customer_phone ? (
                            <span className="text-slate-500"> · {s.customer_phone}</span>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          {formatPaiseToInr(s.amount_paise)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={
                              s.status === 'OBSERVED_SUCCESS' || s.status === 'RECONCILED'
                                ? 'text-emerald-600 font-semibold'
                                : s.status === 'ACTIVE' || s.status === 'PROCESSING'
                                ? 'text-blue-600 font-semibold'
                                : 'text-slate-500'
                            }
                          >
                            {s.status === 'OBSERVED_SUCCESS' ? 'CAPTURED' : s.status}
                            {s.refund_status && s.refund_status !== 'NONE'
                              ? ` · REFUNDED`
                              : ''}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-800">{s.utr || '—'}</td>
                        <td className="py-3 px-4 text-right text-slate-500">
                          {new Date(s.created_at).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-4 text-right font-sans space-x-3">
                          <button
                            type="button"
                            onClick={() => onOpenCheckoutModal(s.id)}
                            className="text-blue-600 hover:underline font-medium cursor-pointer"
                          >
                            View
                          </button>
                          {(s.status === 'OBSERVED_SUCCESS' || s.status === 'RECONCILED') && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDownloadTaxInvoice(s)}
                                className="text-emerald-700 hover:underline font-medium cursor-pointer"
                                title="Download Tax Invoice"
                              >
                                Invoice
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReplayWebhook(s.id)}
                                className="text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
                                title="Send webhook again"
                              >
                                Webhook
                              </button>
                              {s.refund_status !== 'FULL' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRefundingSession(s);
                                    setRefundVpa(s.payer_vpa || '');
                                  }}
                                  className="text-amber-600 hover:underline font-medium cursor-pointer"
                                >
                                  Refund
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Customer Directory & Spend Analytics */}
          <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-display font-bold text-slate-900">
                  Customer Directory & Spend Analytics
                </h2>
                <p className="text-xs text-slate-500">
                  Automatically indexed customers from your UPI orders, sorted by lifetime volume.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-600 tabular-nums">
                {(snapshot.customers || []).length} Unique Customers
              </span>
            </div>

            {!snapshot.customers || snapshot.customers.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                Customers will appear here automatically as orders are created with customer contact
                details.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="py-3 px-4 font-medium">Customer Name</th>
                      <th className="py-3 px-4 font-medium">Phone / Email</th>
                      <th className="py-3 px-4 font-medium">Payer UPI VPA</th>
                      <th className="py-3 px-4 font-medium text-right">Verified Payments</th>
                      <th className="py-3 px-4 font-medium text-right">Lifetime Volume</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {snapshot.customers.map((c) => (
                      <tr key={c.key} className="hover:bg-slate-50/80 text-slate-700">
                        <td className="py-3 px-4 font-sans font-semibold text-slate-900">
                          {c.name}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {c.phone || c.email || '—'}
                        </td>
                        <td className="py-3 px-4 text-blue-600">{c.vpa || '—'}</td>
                        <td className="py-3 px-4 text-right font-semibold text-slate-900">
                          {c.paymentsCount}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-700">
                          {formatPaiseToInr(c.totalSpentPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SHAREABLE PAYMENT LINKS */}
      {activeSubTab === 'links' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreatePaymentLink}
            className="lg:col-span-5 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4 text-xs"
          >
            <div>
              <h2 className="text-base font-display font-bold text-slate-900">
                Create Shareable Payment Link
              </h2>
              <p className="text-xs text-slate-500">
                Create a hosted payment link to share on WhatsApp, Email, or SMS.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Payment Purpose / Title *</label>
              <input
                type="text"
                required
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="e.g. Website Development Invoice #104"
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Amount (INR) *</label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={linkRupees}
                onChange={(e) => setLinkRupees(e.target.value)}
                placeholder="1499.00"
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600 tabular-nums"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-slate-700 font-medium">Customer Name</label>
                <input
                  type="text"
                  value={linkCustomerName}
                  onChange={(e) => setLinkCustomerName(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-slate-700 font-medium">Customer Phone</label>
                <input
                  type="tel"
                  value={linkCustomerPhone}
                  onChange={(e) => setLinkCustomerPhone(e.target.value)}
                  placeholder="+91"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Description / Notes</label>
              <textarea
                rows={2}
                value={linkDesc}
                onChange={(e) => setLinkDesc(e.target.value)}
                placeholder="Notes visible on the customer invoice page"
                className="w-full p-3 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={creatingLink}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-display font-semibold text-xs transition-colors cursor-pointer shadow-xs"
            >
              {creatingLink ? 'Creating Link...' : 'Create Payment Link'}
            </button>
          </form>

          <div className="lg:col-span-7 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
            <h2 className="text-base font-display font-bold text-slate-900">
              Payment Links Directory
            </h2>

            {snapshot.paymentLinks.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
                No payment links created yet. Fill out the form on the left to generate your first
                link.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {snapshot.paymentLinks.map((pl) => {
                  const fullUrl = `${baseUrl}/pay/${pl.short_code}`;
                  const waText = encodeURIComponent(
                    `Hello, please complete your payment of ${formatPaiseToInr(
                      pl.amount_paise
                    )} for "${pl.title}" via UPI: ${fullUrl}`
                  );
                  return (
                    <div
                      key={pl.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-white hover:bg-slate-50"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{pl.title}</span>
                          <span className="text-slate-300">·</span>
                          <span className="font-mono font-bold text-blue-600 tabular-nums">
                            {formatPaiseToInr(pl.amount_paise)}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span
                            className={`font-mono font-semibold ${
                              pl.status === 'PAID' ? 'text-emerald-600' : 'text-slate-600'
                            }`}
                          >
                            {pl.status}
                          </span>
                        </div>
                        <div className="font-mono text-slate-500">{fullUrl}</div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCopy(fullUrl, pl.id)}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium cursor-pointer"
                        >
                          {copiedKey === pl.id ? 'Copied' : 'Copy URL'}
                        </button>
                        <a
                          href={`https://wa.me/?text=${waText}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-medium flex items-center gap-1"
                        >
                          <Share2 className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </a>
                        <a
                          href={`/pay/${pl.short_code}`}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: WEBSITE PAYMENT BUTTON BUILDER */}
      {activeSubTab === 'buttons' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4 text-xs">
            <div>
              <h2 className="text-base font-display font-bold text-slate-900">
                Payment Button Builder
              </h2>
              <p className="text-xs text-slate-500">
                Configure a 1-click UPI checkout button for any HTML, WordPress, Webflow, or Shopify
                site.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Button Text</label>
              <input
                type="text"
                value={btnLabel}
                onChange={(e) => setBtnLabel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Amount (INR)</label>
              <input
                type="number"
                min="1"
                value={btnAmount}
                onChange={(e) => setBtnAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Button Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={btnColor}
                  onChange={(e) => setBtnColor(e.target.value)}
                  className="w-10 h-9 rounded border border-slate-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={btnColor}
                  onChange={(e) => setBtnColor(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <div className="text-slate-500 font-medium">Live Interactive Preview (Click to Test):</div>
              <button
                type="button"
                data-youpi-pay="true"
                data-amount={btnAmount || '499'}
                style={{ backgroundColor: btnColor }}
                className="px-6 py-3 rounded-lg text-white font-display font-semibold text-sm shadow-sm hover:opacity-95 transition-opacity cursor-pointer"
              >
                {btnLabel || 'Pay Now'} · ₹{btnAmount || '499'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-display font-bold text-slate-900">
                  Embed Code for Your Website
                </h3>
                <p className="text-xs text-slate-500">
                  Paste this snippet into any webpage—clicking the button opens the UPI Checkout
                  modal overlay.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(htmlButtonSnippet, 'btn_code')}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
              >
                {copiedKey === 'btn_code' ? 'Copied HTML' : 'Copy Embed Code'}
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
              <code>{htmlButtonSnippet}</code>
            </pre>
          </div>
        </div>
      )}

      {/* TAB 4: BANK STATEMENT CSV RECONCILIATION & WEBHOOK LOGS */}
      {activeSubTab === 'reconcile' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
              <div>
                <h2 className="text-base font-display font-bold text-slate-900">
                  Bank Statement CSV Reconciliation
                </h2>
                <p className="text-xs text-slate-500">
                  Upload your HDFC, ICICI, SBI, or Axis bank statement CSV to match transactions by
                  exact [Amount + 12-digit UTR] and mark them RECONCILED.
                </p>
              </div>

              <form onSubmit={handleRunReconciliation} className="space-y-4">
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <span className="text-slate-600">
                    Select a CSV bank statement file or paste statement rows below:
                  </span>
                  <label className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-medium cursor-pointer shrink-0 flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose CSV</span>
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <textarea
                  rows={7}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder="Date,Narration,UTR,Credit&#10;2026-10-28,UPI/CR/630112345678,630112345678,499.00"
                  className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />

                <button
                  type="submit"
                  disabled={reconciling || !csvText.trim()}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-display font-semibold text-xs transition-colors cursor-pointer"
                >
                  {reconciling ? 'Reconciling...' : 'Reconcile Bank Statement'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-5 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
              <h3 className="text-base font-display font-bold text-slate-900">
                Reconciliation Summary
              </h3>

              {!reconcileReport ? (
                <div className="py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 text-center text-xs text-slate-500">
                  Upload a bank statement CSV to view matched and unmatched UTR records.
                </div>
              ) : (
                <div className="space-y-4 text-xs font-mono tabular-nums">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-slate-500 font-sans">Rows Parsed</div>
                      <div className="text-xl font-bold text-slate-900 mt-0.5">
                        {reconcileReport.totalParsedRows}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                      <div className="text-emerald-700 font-sans">Reconciled</div>
                      <div className="text-xl font-bold text-emerald-700 mt-0.5">
                        {reconcileReport.reconciledCount}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bank Observations & Webhook Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-3">
              <h3 className="text-sm font-display font-bold text-slate-900">
                Incoming Bank Observations (SHA-256 Deduplicated)
              </h3>
              {snapshot.observations.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-xl">
                  No bank observations ingested yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl max-h-64 overflow-y-auto">
                  {snapshot.observations.map((obs) => (
                    <div key={obs.id} className="p-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between font-mono">
                        <span className="font-bold text-emerald-700">
                          {formatPaiseToInr(obs.amount_paise)} · UTR {obs.utr}
                        </span>
                        <span className="text-slate-500">{obs.source_channel}</span>
                      </div>
                      <p className="text-[11px] font-mono text-slate-600 truncate">
                        {obs.raw_payload}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-3">
              <h3 className="text-sm font-display font-bold text-slate-900">
                Outbound Webhook Deliveries
              </h3>
              {snapshot.webhooks.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-xl">
                  Configure your Outbound Webhook URL in Settings to log webhook deliveries.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl max-h-64 overflow-y-auto">
                  {snapshot.webhooks.map((wh) => (
                    <div key={wh.id} className="p-3 space-y-1 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          {wh.order_id} · HTTP {wh.status_code}
                        </span>
                        <span className="text-slate-500">
                          {new Date(wh.delivered_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{wh.target_url}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: INTEGRATION HUB, GITHUB PUBLISHER, API KEYS, PAIRING QR & SETTINGS */}
      {activeSubTab === 'settings' && (
        <div className="space-y-8">
          {/* GitHub OAuth Login & 1-Click Repository Publisher */}
          <div className="p-6 rounded-xl bg-white border border-blue-200 shadow-2xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-blue-600" />
                  <h2 className="text-base font-display font-bold text-slate-900">
                    Publish Complete Gateway & Integration Suite to Your GitHub Account
                  </h2>
                </div>
                <p className="text-xs text-slate-500">
                  Sign in with GitHub via OAuth to automatically create a new repository in your
                  account and push all 20 source files, the Drop-In SDK (<code className="font-mono">/public/sdk.js</code>),
                  the Android Companion Observer (<code className="font-mono">YoupiObserverApp.kt</code>), and the universal{' '}
                  <code className="font-mono">README.md</code> integration docs.
                </p>
              </div>

              <div className="shrink-0 flex items-center gap-3">
                {githubStatus?.authenticated && githubStatus.user ? (
                  <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl text-xs">
                    {githubStatus.user.avatarUrl && (
                      <img
                        src={githubStatus.user.avatarUrl}
                        alt={githubStatus.user.login}
                        className="w-6 h-6 rounded-full"
                      />
                    )}
                    <div>
                      <div className="font-semibold text-slate-900">
                        @{githubStatus.user.login}
                      </div>
                      <div className="text-[11px] text-emerald-600 font-medium">
                        GitHub Connected
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleGitHubLogout}
                      className="ml-2 text-slate-500 hover:text-rose-600 underline cursor-pointer"
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleGitHubSignIn}
                    className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-display font-semibold text-xs flex items-center gap-2 cursor-pointer shadow-xs"
                  >
                    <span>Sign in with GitHub</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {!githubStatus?.oauthConfigured && !githubStatus?.authenticated && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="font-semibold text-slate-900">
                  One-Time GitHub OAuth Setup (Required for Popup Login):
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-600">
                  <li>
                    Open{' '}
                    <a
                      href="https://github.com/settings/developers"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      GitHub Developer Settings → OAuth Apps → New OAuth App
                    </a>
                    .
                  </li>
                  <li>
                    Set the <strong>Authorization callback URL</strong> to:{' '}
                    <code className="px-2 py-0.5 rounded bg-white border border-slate-200 font-mono text-slate-900 select-all">
                      {githubStatus?.callbackUrl || `${baseUrl}/auth/callback`}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          githubStatus?.callbackUrl || `${baseUrl}/auth/callback`,
                          'gh_cb'
                        )
                      }
                      className="ml-2 text-blue-600 hover:underline font-medium cursor-pointer"
                    >
                      {copiedKey === 'gh_cb' ? 'Copied!' : 'Copy Callback URL'}
                    </button>
                  </li>
                  <li>
                    Add <code className="font-mono text-slate-900">GITHUB_CLIENT_ID</code> and{' '}
                    <code className="font-mono text-slate-900">GITHUB_CLIENT_SECRET</code> in the AI
                    Studio Secrets / Environment Variables panel, then click{' '}
                    <strong>Sign in with GitHub</strong> above.
                  </li>
                </ol>
              </div>
            )}

            <form
              onSubmit={handleCreateGitHubRepo}
              className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end text-xs"
            >
              <div className="md:col-span-4 space-y-1.5">
                <label className="block text-slate-700 font-medium">New Repository Name *</label>
                <input
                  type="text"
                  required
                  value={ghRepoName}
                  onChange={(e) => setGhRepoName(e.target.value)}
                  placeholder="youpi-pg"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="md:col-span-5 space-y-1.5">
                <label className="block text-slate-700 font-medium">Repository Description</label>
                <input
                  type="text"
                  value={ghRepoDesc}
                  onChange={(e) => setGhRepoDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="md:col-span-3 flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-slate-700 font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={ghIsPrivate}
                    onChange={(e) => setGhIsPrivate(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Private</span>
                </label>

                <button
                  type="submit"
                  disabled={publishingRepo || !githubStatus?.authenticated}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-display font-semibold text-xs transition-colors cursor-pointer shadow-xs"
                >
                  {publishingRepo ? 'Pushing 20 Files...' : 'Create Repo & Push All'}
                </button>
              </div>
            </form>

            {ghError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {ghError}
              </div>
            )}

            {publishedRepoResult && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="font-semibold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>
                      Repository {publishedRepoResult.fullName} created &{' '}
                      {publishedRepoResult.filesCommittedCount} files pushed to{' '}
                      {publishedRepoResult.branch}!
                    </span>
                  </div>
                  <div className="font-mono text-emerald-700">
                    {publishedRepoResult.repoUrl}
                  </div>
                </div>
                <a
                  href={publishedRepoResult.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 shrink-0"
                >
                  <span>Open on GitHub</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={(e) => handleSaveMerchantSettings(e, false)}
              className="lg:col-span-7 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-5 text-xs"
            >
              <div>
                <h2 className="text-base font-display font-bold text-slate-900">
                  Merchant Account, Receiving UPI VPA & API Keys
                </h2>
                <p className="text-xs text-slate-500">
                  Configure the bank VPA that receives 100% of customer payments directly.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-slate-700 font-medium">Merchant Brand Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-slate-700 font-medium">
                    Receiving UPI VPA (pa) *
                  </label>
                  <input
                    type="text"
                    value={formVpa}
                    onChange={(e) => setFormVpa(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-slate-700 font-medium">Banking Payee Name (pn)</label>
                  <input
                    type="text"
                    value={formPayeeName}
                    onChange={(e) => setFormPayeeName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-slate-700 font-medium">Checkout Header Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formThemeColor}
                      onChange={(e) => setFormThemeColor(e.target.value)}
                      className="w-10 h-9 rounded border border-slate-300 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formThemeColor}
                      onChange={(e) => setFormThemeColor(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">
                  Outbound Merchant Webhook URL
                </label>
                <input
                  type="url"
                  value={formWebhookUrl}
                  onChange={(e) => setFormWebhookUrl(e.target.value)}
                  placeholder="https://your-backend.com/api/webhooks/youpi"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900"
                />
              </div>

              {/* API Keys Box */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Key ID:</span>
                  <span className="text-slate-900 font-semibold">
                    {snapshot.merchant.api_key_id}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Key Secret:</span>
                  <span className="text-blue-600 font-semibold">
                    {snapshot.merchant.api_key_secret}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Webhook Secret:</span>
                  <span className="text-slate-700">{snapshot.merchant.webhook_secret}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Observer Secret:</span>
                  <span className="text-slate-700">{snapshot.merchant.observer_secret}</span>
                </div>
              </div>

              {settingsSavedMsg && (
                <p className="text-xs text-emerald-600 font-medium">{settingsSavedMsg}</p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-display font-semibold text-xs cursor-pointer"
                >
                  {savingSettings ? 'Saving...' : 'Save Configuration'}
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSaveMerchantSettings(e, true)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium text-xs cursor-pointer"
                >
                  Rotate Secrets
                </button>
              </div>
            </form>

            {/* Android Observer Pairing QR */}
            <div className="lg:col-span-5 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
              <div>
                <h3 className="text-base font-display font-bold text-slate-900">
                  Android Bank Observer Pairing QR
                </h3>
                <p className="text-xs text-slate-500">
                  Scan this QR from the companion Android app (`/android-observer/YoupiObserverApp.kt`)
                  to auto-verify incoming bank SMS and UPI notifications.
                </p>
              </div>

              <div className="flex flex-col items-center p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                {pairingData?.qrSvg ? (
                  <div
                    className="w-44 h-44 p-2.5 bg-white rounded-xl border border-slate-200 [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: pairingData.qrSvg }}
                  />
                ) : (
                  <div className="w-44 h-44 rounded-xl bg-slate-100 animate-pulse" />
                )}
                <div className="w-full text-[11px] font-mono text-slate-600 truncate text-center">
                  POST {pairingData?.endpoint}
                </div>
              </div>
            </div>
          </div>

          {/* Complete Copy-Paste Integration Reference */}
          <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-6">
            <div>
              <h2 className="text-base font-display font-bold text-slate-900">
                How to Integrate OpenPay — By Aniket Anywhere (HTML, React/Next.js, Node.js/Python)
              </h2>
              <p className="text-xs text-slate-500">
                Embed zero-fee UPI checkout on any external domain or backend using the snippets
                below.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    1. Frontend JavaScript SDK (React, Next.js, Vue, HTML)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(jsProgrammaticSnippet, 'js_sdk')}
                    className="text-blue-600 hover:underline font-medium cursor-pointer"
                  >
                    {copiedKey === 'js_sdk' ? 'Copied' : 'Copy Code'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto leading-relaxed">
                  <code>{jsProgrammaticSnippet}</code>
                </pre>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    2. Server-to-Server Orders & Signature Verification API
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(backendOrderSnippet, 'backend_api')}
                    className="text-blue-600 hover:underline font-medium cursor-pointer"
                  >
                    {copiedKey === 'backend_api' ? 'Copied' : 'Copy Code'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto leading-relaxed">
                  <code>{backendOrderSnippet}</code>
                </pre>
              </div>
            </div>

            {/* Universal End-to-End Integration Architecture */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-display font-bold text-slate-900">
                    3. End-to-End Payment Verification Flow (E-Commerce, SaaS, Mobile & Web Apps)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Standard 4-step workflow to accept payments in any application and verify authenticity using HMAC-SHA256 signatures. Full copy-paste examples are included in <code className="font-mono text-slate-800">README.md</code>.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-mono font-bold text-blue-600">01. Create Order</div>
                  <div className="font-semibold text-slate-900">POST /api/v1/orders</div>
                  <p className="text-slate-600">
                    Your backend sends the order amount in integer paise (e.g. <code className="font-mono">49900</code> for ₹499.00) and receives <code className="font-mono">checkout_session_id</code>.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-mono font-bold text-blue-600">02. Open Modal</div>
                  <div className="font-semibold text-slate-900">YoupiPG.open()</div>
                  <p className="text-slate-600">
                    Your frontend opens the modal with <code className="font-mono">sessionId</code>. Customer scans the vector QR or taps GPay/PhonePe/Paytm.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-mono font-bold text-blue-600">03. Verify Signature</div>
                  <div className="font-semibold text-slate-900">POST /api/v1/payments/verify</div>
                  <p className="text-slate-600">
                    Verify <code className="font-mono">HMAC-SHA256(orderId + &quot;|&quot; + sessionId, secret)</code> on your backend before fulfilling the order.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-mono font-bold text-blue-600">04. Webhook Backup</div>
                  <div className="font-semibold text-slate-900">X-Youpi-Signature</div>
                  <p className="text-slate-600">
                    Even if the customer closes their browser tab, YouPI-PG POSTs <code className="font-mono">payment.captured</code> to your webhook URL.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: MERCHANT PROFILE, KYC & SECURITY */}
      {activeSubTab === 'profile' && (
        <ProfileView
          user={currentUser || snapshot.user || null}
          merchant={snapshot.merchant}
          authToken={authToken}
          onProfileUpdated={(updatedUser) => {
            onProfileUpdated(updatedUser);
            onRefresh();
          }}
          onSignOut={onSignOut}
        />
      )}
    </div>
  );
};
