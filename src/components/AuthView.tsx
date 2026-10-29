import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  CheckCircle2,
  UserPlus,
  LogIn,
  Zap,
} from 'lucide-react';
import { UserProfile } from '../lib/types';

interface AuthViewProps {
  onAuthenticated: (user: UserProfile, token: string) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('aniketchoudhary9507@gmail.com');
  const [password, setPassword] = useState('OpenPay@2026');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [businessName, setBusinessName] = useState('');
  const [vpa, setVpa] = useState('');
  const [businessCategory, setBusinessCategory] = useState('Fintech & SaaS Infrastructure');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const payload =
        mode === 'login'
          ? { email, password }
          : {
              fullName,
              email,
              phone,
              password,
              businessName,
              vpa,
              businessCategory,
            };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Authentication failed');
      } else if (data.user) {
        if (data.token) {
          localStorage.setItem('openpay_auth_token', data.token);
        }
        onAuthenticated(data.user, data.token || '');
      }
    } catch {
      setError('Network error communicating with OpenPay server.');
    } finally {
      setLoading(false);
    }
  };

  const handleFounderQuickLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/founder-quick-login', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.user) {
        if (data.token) {
          localStorage.setItem('openpay_auth_token', data.token);
        }
        onAuthenticated(data.user, data.token || '');
      } else {
        setError(data.error || 'Quick sign-in failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col justify-between">
      {/* Top Header */}
      <header className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-display font-bold text-sm flex items-center justify-center">
            OP
          </div>
          <span className="text-lg font-display font-bold tracking-tight text-slate-900">
            OpenPay <span className="text-xs font-normal text-slate-500">— By Aniket</span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Lock className="w-3.5 h-3.5 text-blue-600" />
          <span>Self-Hosted Zero-Fee UPI Gateway</span>
        </div>
      </header>

      {/* Main Split Auth Layout */}
      <main className="max-w-5xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: Value Proposition & Architecture */}
        <div className="lg:col-span-6 space-y-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
              <ShieldCheck className="w-4 h-4" />
              <span>DIRECT-TO-BANK NPCI UPI INFRASTRUCTURE</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-slate-900 leading-tight">
              Accept UPI Payments with 0% Platform Fees.
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              OpenPay — By Aniket routes customer payments directly from Google Pay, PhonePe, Paytm,
              and BHIM to your receiving bank VPA with deterministic FIFO queue locking and
              HMAC-SHA256 bank alert verification.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-semibold text-slate-900">
                  Zero Fund Custody & Instant Bank Settlement
                </div>
                <p className="text-slate-500">
                  100% of every rupee lands directly in your bank account via standard NPCI{' '}
                  <code className="font-mono text-slate-800">upi://pay</code> rails.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-semibold text-slate-900">
                  Atomic [VPA + Exact Amount] FIFO Queue
                </div>
                <p className="text-slate-500">
                  Prevents payment attribution collisions when multiple customers pay the same amount
                  simultaneously.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-semibold text-slate-900">
                  Universal Drop-In SDK, Payment Links & GitHub Publisher
                </div>
                <p className="text-slate-500">
                  Embed on any HTML, React, Next.js, or SaaS site in 60 seconds and publish your
                  entire gateway to GitHub in 1 click.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Login / Signup Card */}
        <div className="lg:col-span-6">
          <div className="p-7 rounded-2xl bg-white border border-slate-200 shadow-lg space-y-6">
            {/* Mode Switcher */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-display font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In to Dashboard</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setEmail('');
                  setPassword('');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-display font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create Merchant Account</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {mode === 'signup' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-slate-700 font-medium">Your Full Name *</label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Aniket Choudhary"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-slate-700 font-medium">Mobile Number *</label>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-slate-700 font-medium">
                        Business / Brand Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        placeholder="OpenPay — By Aniket"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-slate-700 font-medium">
                        Receiving UPI VPA (pa) *
                      </label>
                      <input
                        type="text"
                        required
                        value={vpa}
                        onChange={(e) => setVpa(e.target.value)}
                        placeholder="aniket@okaxis"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">Work Email Address *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="aniketchoudhary9507@gmail.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">Password *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-display font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
              >
                <span>
                  {loading
                    ? 'Authenticating...'
                    : mode === 'login'
                    ? 'Sign In to OpenPay'
                    : 'Create Account & Launch Gateway'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {/* Instant Founder Login Option */}
            <div className="pt-4 border-t border-slate-200 space-y-2.5">
              <div className="text-[11px] text-slate-500 text-center">
                Or access the pre-configured Founder Merchant Account immediately:
              </div>
              <button
                type="button"
                onClick={handleFounderQuickLogin}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-display font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-blue-600" />
                <span>Continue as Aniket Choudhary (Founder Account)</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto px-6 py-6 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
        <div>OpenPay — By Aniket · Direct-to-Bank UPI Payment Gateway</div>
        <div>SQLite WAL + Scrypt Cryptographic Auth</div>
      </footer>
    </div>
  );
};
