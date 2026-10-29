import React, { useEffect, useState, useRef } from 'react';
import {
  ShieldCheck,
  QrCode,
  Smartphone,
  AtSign,
  Copy,
  Check,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  Lock,
  ExternalLink,
  Download,
  User,
  Edit3,
} from 'lucide-react';
import { CheckoutSession } from '../lib/types';
import { formatPaiseToInr } from '../lib/bank-parser';

interface CustomerCheckoutModalProps {
  sessionId: string;
  isStandalonePage?: boolean;
  isEmbeddedIframe?: boolean;
  onClose?: () => void;
  onVerified?: (session: CheckoutSession) => void;
}

function playCheckoutChime(type: 'promoted' | 'verified') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = type === 'verified' ? [523.25, 659.25, 783.99] : [440, 587.33];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);
      gain.gain.setValueAtTime(0.08, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.34);
    });

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(type === 'verified' ? [40, 50, 80] : [50]);
    }
  } catch {
    // Ignore audio context restrictions
  }
}

export const CustomerCheckoutModal: React.FC<CustomerCheckoutModalProps> = ({
  sessionId,
  isStandalonePage = false,
  isEmbeddedIframe = false,
  onClose,
  onVerified,
}) => {
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentTab, setPaymentTab] = useState<'qr' | 'vpa' | 'intent'>('qr');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [payerVpaInput, setPayerVpaInput] = useState('');
  const [vpaError, setVpaError] = useState<string | null>(null);
  const [manualUtr, setManualUtr] = useState('');
  const [utrError, setUtrError] = useState<string | null>(null);
  const [isSubmittingVerify, setIsSubmittingVerify] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [redirectCountdown, setRedirectCountdown] = useState<number>(3);

  // Customer Contact Edit Bar State
  const [editingContact, setEditingContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  const prevStatusRef = useRef<string | null>(null);
  const clockOffsetRef = useRef<number>(0);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let isMounted = true;

    async function fetchInitial() {
      try {
        setLoading(true);
        const res = await fetch(`/api/checkout/sessions/${encodeURIComponent(sessionId)}`);
        if (!res.ok) {
          throw new Error('Checkout session not found');
        }
        const data = await res.json();
        if (!isMounted) return;
        const sess: CheckoutSession = data.session;
        if (sess.server_now) {
          clockOffsetRef.current = sess.server_now - Date.now();
        }
        prevStatusRef.current = sess.status;
        if (sess.payer_vpa) setPayerVpaInput(sess.payer_vpa);
        setContactName(sess.customer_name || '');
        setContactPhone(sess.customer_phone || '');
        setContactEmail(sess.customer_email || '');
        setSession(sess);
        setLoading(false);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load checkout session');
        setLoading(false);
      }
    }

    fetchInitial();

    eventSource = new EventSource(`/api/checkout/sessions/${encodeURIComponent(sessionId)}/stream`);
    eventSource.addEventListener('session_update', (ev: MessageEvent) => {
      try {
        const updated: CheckoutSession = JSON.parse(ev.data);
        if (updated.server_now) {
          clockOffsetRef.current = updated.server_now - Date.now();
        }

        const prevStatus = prevStatusRef.current;
        if (prevStatus === 'QUEUED' && updated.status === 'ACTIVE') {
          playCheckoutChime('promoted');
        } else if (
          prevStatus !== 'OBSERVED_SUCCESS' &&
          prevStatus !== 'RECONCILED' &&
          (updated.status === 'OBSERVED_SUCCESS' || updated.status === 'RECONCILED')
        ) {
          playCheckoutChime('verified');
          onVerified?.(updated);

          if (window.parent && window.parent !== window) {
            window.parent.postMessage(
              {
                type: 'youpi:payment:success',
                payload: {
                  sessionId: updated.id,
                  orderId: updated.order_id,
                  amountPaise: updated.amount_paise,
                  utr: updated.utr,
                  signature: updated.payment_signature,
                  status: updated.status,
                  autoClose: false,
                },
              },
              '*'
            );
          }
        } else if (prevStatus !== 'EXPIRED' && updated.status === 'EXPIRED') {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(
              {
                type: 'youpi:payment:expired',
                payload: {
                  sessionId: updated.id,
                  orderId: updated.order_id,
                },
              },
              '*'
            );
          }
        }

        prevStatusRef.current = updated.status;
        setSession(updated);
        setLoading(false);
      } catch (e) {
        console.error('Failed to parse SSE session_update:', e);
      }
    });

    return () => {
      isMounted = false;
      eventSource?.close();
    };
  }, [sessionId]);

  useEffect(() => {
    if (!session) return;
    const updateTimer = () => {
      const alignedNow = Date.now() + clockOffsetRef.current;
      if (session.status === 'ACTIVE' && session.active_expires_at) {
        setRemainingMs(Math.max(0, session.active_expires_at - alignedNow));
      } else if (session.status === 'PROCESSING' && session.processing_expires_at) {
        setRemainingMs(Math.max(0, session.processing_expires_at - alignedNow));
      } else {
        setRemainingMs(0);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 200);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (session.status !== 'OBSERVED_SUCCESS' && session.status !== 'RECONCILED') {
      setRedirectCountdown(3);
      return;
    }

    const timer = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (
            session.callback_url &&
            session.callback_url.startsWith('http') &&
            !isEmbeddedIframe
          ) {
            window.location.href = session.callback_url;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.status]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    try {
      setSavingContact(true);
      const res = await fetch(
        `/api/checkout/sessions/${encodeURIComponent(session.id)}/contact`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName: contactName,
            customerPhone: contactPhone,
            customerEmail: contactEmail,
          }),
        }
      );
      const data = await res.json();
      if (res.ok && data.session) {
        setSession(data.session);
        setEditingContact(false);
      }
    } finally {
      setSavingContact(false);
    }
  };

  const handleVpaCollectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setVpaError(null);

    const vpa = payerVpaInput.trim();
    if (!/^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/.test(vpa)) {
      setVpaError('Enter a valid UPI ID (e.g. name@okicici, mobile@ybl)');
      return;
    }

    try {
      setIsSubmittingVerify(true);
      const res = await fetch(
        `/api/checkout/sessions/${encodeURIComponent(session.id)}/collect-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payerVpa: vpa }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setVpaError(data.error || 'Failed to initiate collect request');
      } else if (data.session) {
        setSession(data.session);
      }
    } catch {
      setVpaError('Network error');
    } finally {
      setIsSubmittingVerify(false);
    }
  };

  const handleTriggerVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!session) return;

    setUtrError(null);
    const cleanedUtr = manualUtr.replace(/\D/g, '').trim();
    if (cleanedUtr.length > 0 && cleanedUtr.length !== 12) {
      setUtrError('Please enter a valid 12-digit numeric UPI Reference / UTR number.');
      return;
    }

    try {
      setIsSubmittingVerify(true);
      const res = await fetch(`/api/checkout/sessions/${encodeURIComponent(session.id)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualUtr: cleanedUtr || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUtrError(data.error || 'Verification trigger failed');
      } else if (data.session) {
        setSession(data.session);
      }
    } catch {
      setUtrError('Network error communicating with gateway');
    } finally {
      setIsSubmittingVerify(false);
    }
  };

  const handleDownloadReceipt = () => {
    if (!session) return;
    const receiptContent = [
      '==================================================',
      `          ${(session.merchant?.name || 'MERCHANT').toUpperCase()} — PAYMENT RECEIPT`,
      '==================================================',
      `Order ID         : ${session.order_id}`,
      `Payment ID       : ${session.id}`,
      `Amount Paid      : ${formatPaiseToInr(session.amount_paise)}`,
      `12-Digit UTR     : ${session.utr || 'N/A'}`,
      `Beneficiary VPA  : ${session.merchant?.vpa || ''}`,
      `Customer         : ${session.customer_name || 'Customer'} (${session.customer_phone || ''})`,
      `Status           : ${session.status}`,
      `Signature (HMAC) : ${session.payment_signature || ''}`,
      `Date & Time      : ${new Date().toISOString()}`,
      '==================================================',
    ].join('\n');

    const blob = new Blob([receiptContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Receipt-${session.order_id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCancelSession = async () => {
    if (!session) return;
    await fetch(`/api/checkout/sessions/${encodeURIComponent(session.id)}/cancel`, {
      method: 'POST',
    });
    if (onClose) onClose();
    if (isEmbeddedIframe && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'youpi:checkout:close' }, '*');
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-[430px] mx-auto rounded-2xl bg-white border border-slate-200 p-6 shadow-xl">
        <div className="animate-pulse space-y-4">
          <div className="h-14 bg-slate-100 rounded-xl" />
          <div className="h-64 bg-slate-50 rounded-xl" />
          <div className="h-11 bg-slate-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="w-full max-w-[430px] mx-auto rounded-2xl bg-white border border-rose-200 p-6 text-center space-y-4 shadow-xl">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <h3 className="text-base font-semibold text-slate-900">Checkout Session Unavailable</h3>
        <p className="text-xs text-slate-500">{error || 'Unable to load session'}</p>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  const brandColor =
    session.merchant?.theme_color && session.merchant.theme_color !== '#10B981'
      ? session.merchant.theme_color
      : '#2563EB';
  const totalWindowMs = session.status === 'PROCESSING' ? 30_000 : 300_000;
  const progressFraction = Math.min(1, Math.max(0, remainingMs / totalWindowMs));
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const formattedCountdown = `${mins}:${secs.toString().padStart(2, '0')}`;

  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progressFraction);

  const vpaHandles = ['@okicici', '@okhdfcbank', '@okaxis', '@ybl', '@paytm'];

  return (
    <div className="w-full max-w-[430px] mx-auto rounded-2xl bg-white border border-slate-200/90 shadow-2xl overflow-hidden text-slate-900 flex flex-col justify-between">
      {/* Razorpay-Style Colored Merchant Header */}
      <div
        className="px-5 pt-5 pb-4 text-white flex items-center justify-between gap-3"
        style={{ backgroundColor: brandColor }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {session.merchant?.logo_url ? (
            <img
              src={session.merchant.logo_url}
              alt={session.merchant.name}
              referrerPolicy="no-referrer"
              className="w-11 h-11 rounded-xl object-cover bg-white p-0.5 shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur-sm border border-white/25 flex items-center justify-center font-display font-bold text-sm text-white shrink-0">
              {(session.merchant?.name || 'M').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-display font-bold text-base text-white truncate">
                {session.merchant?.name || 'Merchant'}
              </h2>
              <ShieldCheck className="w-4 h-4 text-white/90 shrink-0" aria-label="Verified Merchant" />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/80 font-mono truncate">
              <span>{session.order_id}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{session.merchant?.vpa}</span>
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-xl font-mono font-bold text-white tabular-nums tracking-tight">
            {formatPaiseToInr(session.amount_paise)}
          </div>
          <div className="text-[11px] text-white/85">Zero-Fee UPI</div>
        </div>
      </div>

      {/* Razorpay-Style Customer Contact Bar */}
      <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs">
        {!editingContact ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-600 truncate">
              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-800 truncate">
                {session.customer_name || 'Guest Customer'}
              </span>
              {session.customer_phone && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-600">{session.customer_phone}</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditingContact(true)}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium shrink-0 cursor-pointer"
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSaveContact} className="space-y-2 py-1">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Your Name"
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+91 Phone"
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email for receipt"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={savingContact}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium text-xs cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingContact(false)}
                className="px-2 py-1.5 text-slate-500 hover:text-slate-800 text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Main Checkout Body */}
      <div className="p-5 space-y-5 bg-white">
        {/* STATE 1: QUEUE WAITING ROOM (QUEUED) */}
        {session.status === 'QUEUED' && (
          <div className="space-y-4 py-2">
            <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center mx-auto">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-800">
                  High traffic on this UPI line — You are{' '}
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    #{session.queue_position}
                  </span>{' '}
                  in queue
                </p>
                <h3 className="text-base font-display font-bold text-slate-900">
                  Waiting for {formatPaiseToInr(session.amount_paise)} Payment Slot
                </h3>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Your payment screen will unlock automatically with an audio chime the moment the
                active transaction on{' '}
                <span className="font-mono font-medium text-slate-900">
                  {session.merchant?.vpa}
                </span>{' '}
                completes.
              </p>

              <div className="pt-2 flex items-center justify-center gap-4 text-xs text-slate-700 font-mono tabular-nums">
                <span>Queue Position: #{session.queue_position}</span>
                <span aria-hidden="true">·</span>
                <span>Est. Wait: ~{Math.max(15, session.queue_position * 25)}s</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCancelSession}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Cancel Payment
            </button>
          </div>
        )}

        {/* STATE 2: ACTIVE PAYMENT SCREEN (ACTIVE) */}
        {session.status === 'ACTIVE' && (
          <div className="space-y-4">
            {/* Payment Method Selector + Countdown */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPaymentTab('qr')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paymentTab === 'qr'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>UPI QR</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentTab('vpa')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paymentTab === 'vpa'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <AtSign className="w-3.5 h-3.5" />
                  <span>UPI ID</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentTab('intent')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paymentTab === 'intent'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>UPI Apps</span>
                </button>
              </div>

              {/* Circular SVG Countdown Timer */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200">
                <svg className="w-5 h-5 -rotate-90" viewBox="0 0 40 40">
                  <circle cx="20" cy="20" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="3.5" />
                  <circle
                    cx="20"
                    cy="20"
                    r={radius}
                    fill="none"
                    stroke={totalSeconds <= 60 ? '#D97706' : brandColor}
                    strokeWidth="3.5"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums">
                  {formattedCountdown}
                </span>
              </div>
            </div>

            {/* Method 1: QR Code */}
            {paymentTab === 'qr' && (
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 flex flex-col items-center space-y-3">
                <div className="relative p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
                  <div
                    className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 rounded-tl-md"
                    style={{ borderColor: brandColor }}
                  />
                  <div
                    className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 rounded-tr-md"
                    style={{ borderColor: brandColor }}
                  />
                  <div
                    className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 rounded-bl-md"
                    style={{ borderColor: brandColor }}
                  />
                  <div
                    className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 rounded-br-md"
                    style={{ borderColor: brandColor }}
                  />

                  {session.qr_svg ? (
                    <div
                      className="w-44 h-44 [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: session.qr_svg }}
                    />
                  ) : (
                    <div className="w-44 h-44 flex items-center justify-center text-slate-500 text-xs">
                      Generating QR...
                    </div>
                  )}
                </div>

                <div className="text-center space-y-1">
                  <p className="text-xs text-slate-700 font-medium">
                    Scan with any UPI App to pay{' '}
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {formatPaiseToInr(session.amount_paise)}
                    </span>
                  </p>
                  <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500">
                    <span>Google Pay</span>
                    <span aria-hidden="true">·</span>
                    <span>PhonePe</span>
                    <span aria-hidden="true">·</span>
                    <span>Paytm</span>
                    <span aria-hidden="true">·</span>
                    <span>CRED</span>
                    <span aria-hidden="true">·</span>
                    <span>BHIM</span>
                  </div>
                </div>

                <div className="w-full pt-2.5 border-t border-slate-200 flex items-center justify-between gap-2 text-xs">
                  <div className="truncate text-slate-500">
                    VPA:{' '}
                    <span className="font-mono font-medium text-slate-800">
                      {session.merchant?.vpa}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(session.merchant?.vpa || '', 'vpa')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium transition-colors shrink-0 cursor-pointer"
                  >
                    {copiedField === 'vpa' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy VPA</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Method 2: Enter Customer UPI ID / VPA */}
            {paymentTab === 'vpa' && (
              <form
                onSubmit={handleVpaCollectSubmit}
                className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
              >
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Enter your UPI ID (VPA)
                  </label>
                  <input
                    type="text"
                    value={payerVpaInput}
                    onChange={(e) => {
                      setPayerVpaInput(e.target.value);
                      setVpaError(null);
                    }}
                    placeholder="mobilenumber@okicici"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {vpaHandles.map((handle) => (
                    <button
                      key={handle}
                      type="button"
                      onClick={() => {
                        const base = payerVpaInput.split('@')[0] || '';
                        setPayerVpaInput(`${base}${handle}`);
                      }}
                      className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-mono text-slate-700 transition-colors cursor-pointer"
                    >
                      {handle}
                    </button>
                  ))}
                </div>

                {vpaError && <p className="text-[11px] text-rose-600">{vpaError}</p>}

                <button
                  type="submit"
                  disabled={isSubmittingVerify || !payerVpaInput.trim()}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-xs font-display font-semibold text-white transition-colors cursor-pointer"
                >
                  Verify & Pay {formatPaiseToInr(session.amount_paise)}
                </button>
              </form>
            )}

            {/* Method 3: 1-Tap UPI Intent Apps */}
            {paymentTab === 'intent' && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <a
                    href={session.upi_intents?.gpay || '#'}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors group"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">Google Pay</div>
                      <div className="text-[11px] font-mono text-slate-500">Instant Intent</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </a>

                  <a
                    href={session.upi_intents?.phonepe || '#'}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors group"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">PhonePe</div>
                      <div className="text-[11px] font-mono text-slate-500">Instant Intent</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </a>

                  <a
                    href={session.upi_intents?.paytm || '#'}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors group"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">Paytm</div>
                      <div className="text-[11px] font-mono text-slate-500">Instant Intent</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </a>

                  <a
                    href={session.upi_intents?.generic || '#'}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors group"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">BHIM / Other</div>
                      <div className="text-[11px] font-mono text-slate-500">upi://pay</div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 transition-colors" />
                  </a>
                </div>
              </div>
            )}

            {/* Primary Action Button */}
            <button
              type="button"
              disabled={isSubmittingVerify}
              onClick={() => handleTriggerVerify()}
              className="w-full py-3 px-4 rounded-xl font-display font-semibold text-sm text-white shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer hover:opacity-95 disabled:opacity-50"
              style={{ backgroundColor: brandColor }}
            >
              <span>I Have Paid — Verify Payment</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STATE 3: FAST VERIFICATION WINDOW (PROCESSING) */}
        {session.status === 'PROCESSING' && (
          <div className="space-y-4 py-2">
            <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-4">
              <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                <div
                  className="absolute inset-0 rounded-full animate-radar-1"
                  style={{ border: `1.5px solid ${brandColor}` }}
                />
                <div
                  className="absolute inset-0 rounded-full animate-radar-2"
                  style={{ border: `1.5px solid ${brandColor}` }}
                />
                <div
                  className="relative z-10 w-12 h-12 rounded-full flex items-center justify-center font-mono font-bold text-sm text-white tabular-nums"
                  style={{ backgroundColor: brandColor }}
                >
                  {totalSeconds}s
                </div>
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-display font-bold text-slate-900">
                  Confirming transfer with bank rails...
                </h3>
                <p className="text-xs text-slate-600">
                  Verifying credit of{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatPaiseToInr(session.amount_paise)}
                  </span>{' '}
                  to <span className="font-mono text-slate-800">{session.merchant?.vpa}</span>
                </p>
              </div>
            </div>

            <form
              onSubmit={handleTriggerVerify}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
            >
              <label className="block text-xs font-medium text-slate-700">
                Taking longer? Enter 12-digit UPI Ref / UTR number
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={12}
                  value={manualUtr}
                  onChange={(e) => {
                    setManualUtr(e.target.value.replace(/\D/g, ''));
                    setUtrError(null);
                  }}
                  placeholder="12-digit UPI Ref / UTR"
                  className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 tabular-nums"
                />
                <button
                  type="submit"
                  disabled={isSubmittingVerify || manualUtr.length !== 12}
                  className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Submit UTR
                </button>
              </div>
              {utrError && <p className="text-[11px] text-rose-600">{utrError}</p>}
              {session.utr && (
                <p className="text-[11px] text-emerald-700 font-mono">
                  Recorded UTR #{session.utr} — awaiting confirmation...
                </p>
              )}
            </form>
          </div>
        )}

        {/* STATE 4: INSTANT VERIFIED OUTCOME (OBSERVED_SUCCESS / RECONCILED) */}
        {(session.status === 'OBSERVED_SUCCESS' || session.status === 'RECONCILED') && (
          <div className="space-y-4 py-2">
            <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-7 h-7 stroke-[2.5]" />
              </div>

              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-emerald-700">Payment Successful</div>
                <h3 className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {formatPaiseToInr(session.amount_paise)}
                </h3>
              </div>

              <div className="pt-3 border-t border-emerald-200/80 text-left space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Order ID</span>
                  <span className="font-mono font-medium text-slate-900">{session.order_id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">12-Digit UTR</span>
                  <span className="font-mono font-bold text-emerald-700 tabular-nums">
                    {session.utr || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Beneficiary VPA</span>
                  <span className="font-mono text-slate-800">{session.merchant?.vpa}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleDownloadReceipt}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-medium text-slate-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Receipt</span>
              </button>

              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-4 rounded-xl text-xs font-display font-semibold text-white transition-colors cursor-pointer"
                  style={{ backgroundColor: brandColor }}
                >
                  Done ({redirectCountdown}s)
                </button>
              )}
            </div>
          </div>
        )}

        {/* EXPIRED OR CANCELLED STATE */}
        {(session.status === 'EXPIRED' || session.status === 'CANCELLED') && (
          <div className="p-5 rounded-xl bg-rose-50 border border-rose-200 text-center space-y-3">
            <X className="w-10 h-10 text-rose-500 mx-auto" />
            <div className="space-y-1">
              <h3 className="text-base font-display font-semibold text-slate-900">
                {session.status === 'EXPIRED' ? 'Payment Window Expired' : 'Payment Cancelled'}
              </h3>
              <p className="text-xs text-slate-600">
                The payment slot for {formatPaiseToInr(session.amount_paise)} has closed.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Razorpay-Style Footer Bar */}
      <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5 font-medium">
          <Lock className="w-3 h-3 text-blue-600" />
          <span>Secured by OpenPay — By Aniket · Direct NPCI UPI</span>
        </span>
        {(isStandalonePage || onClose) &&
          session.status !== 'OBSERVED_SUCCESS' &&
          session.status !== 'RECONCILED' && (
            <button
              type="button"
              onClick={handleCancelSession}
              className="text-slate-500 hover:text-rose-600 font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
      </div>
    </div>
  );
};
