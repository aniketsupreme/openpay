import React, { useEffect, useState } from 'react';
import { ShieldCheck, ArrowRight, AlertCircle, Lock } from 'lucide-react';
import { PaymentLink } from '../lib/types';
import { formatPaiseToInr } from '../lib/bank-parser';
import { CustomerCheckoutModal } from './CustomerCheckoutModal';

interface PaymentLinkViewProps {
  shortCode: string;
}

export const PaymentLinkView: React.FC<PaymentLinkViewProps> = ({ shortCode }) => {
  const [linkData, setLinkData] = useState<{
    paymentLink: PaymentLink;
    merchant: {
      name: string;
      vpa: string;
      PayeeName: string;
      theme_color: string;
      gstin: string;
      support_email: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/payment-links/${encodeURIComponent(shortCode)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Payment link not found or expired');
        return res.json();
      })
      .then((data) => {
        setLinkData(data);
        setCustomerName(data.paymentLink.customer_name || '');
        setCustomerPhone(data.paymentLink.customer_phone || '');
        setCustomerEmail(data.paymentLink.customer_email || '');
        if (data.paymentLink.status === 'PAID' && data.paymentLink.paid_session_id) {
          setActiveSessionId(data.paymentLink.paid_session_id);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unable to load payment link');
        setLoading(false);
      });
  }, [shortCode]);

  const handleProceedToPay = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const res = await fetch(`/api/payment-links/${encodeURIComponent(shortCode)}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
        }),
      });
      const data = await res.json();
      if (res.ok && data.session) {
        setActiveSessionId(data.session.id);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="h-72 rounded-2xl bg-white border border-slate-200 animate-pulse shadow-sm" />
      </div>
    );
  }

  if (error || !linkData) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="p-6 rounded-2xl bg-white border border-rose-200 text-center space-y-3 shadow-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-base font-display font-semibold text-slate-900">
            Payment Link Unavailable
          </h2>
          <p className="text-xs text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (activeSessionId) {
    return (
      <div className="max-w-md mx-auto px-4 py-10">
        <CustomerCheckoutModal sessionId={activeSessionId} isStandalonePage />
      </div>
    );
  }

  const { paymentLink, merchant } = linkData;
  const brandColor =
    merchant.theme_color && merchant.theme_color !== '#10B981'
      ? merchant.theme_color
      : '#2563EB';

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <div className="rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden">
        <div
          className="p-6 text-white flex items-center justify-between"
          style={{ backgroundColor: brandColor }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center font-display font-bold text-xs text-white">
              {merchant.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-display font-bold text-white flex items-center gap-1.5">
                <span>{merchant.name}</span>
                <ShieldCheck className="w-4 h-4 text-white/90" />
              </div>
              <div className="text-xs font-mono text-white/80">{merchant.vpa}</div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] text-white/80">Amount Due</div>
            <div className="text-xl font-mono font-bold text-white tabular-nums">
              {formatPaiseToInr(paymentLink.amount_paise)}
            </div>
          </div>
        </div>

        <div className="px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-50/60 space-y-1">
          <div className="text-[11px] font-mono text-slate-500">
            PAYMENT REQUEST · {paymentLink.short_code.toUpperCase()}
          </div>
          <h1 className="text-base font-display font-bold text-slate-900">
            {paymentLink.title}
          </h1>
          {paymentLink.description && (
            <p className="text-xs text-slate-600 leading-relaxed">
              {paymentLink.description}
            </p>
          )}
        </div>

        <form onSubmit={handleProceedToPay} className="p-6 space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="block text-slate-700 font-medium">Full Name *</label>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter your full name"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-slate-700 font-medium">Mobile Number (WhatsApp / SMS) *</label>
            <input
              type="tel"
              required
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-slate-700 font-medium">Email Address (For Receipt)</label>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 rounded-xl font-display font-semibold text-sm text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-95 cursor-pointer shadow-md"
            style={{ backgroundColor: brandColor }}
          >
            <span>
              {submitting
                ? 'Initializing UPI Session...'
                : `Pay ${formatPaiseToInr(paymentLink.amount_paise)}`}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5 font-medium">
            <Lock className="w-3 h-3 text-blue-600" />
            <span>OpenPay — By Aniket · Direct-to-Bank UPI</span>
          </span>
          <span className="font-mono">{paymentLink.short_code}</span>
        </div>
      </div>
    </div>
  );
};
