import React, { useState, useEffect } from 'react';
import {
  User,
  ShieldCheck,
  KeyRound,
  LogOut,
  CheckCircle2,
  Building2,
  Smartphone,
  Mail,
  Laptop,
  Lock,
} from 'lucide-react';
import { UserProfile, Merchant, UserSessionRecord } from '../lib/types';

interface ProfileViewProps {
  user: UserProfile | null;
  merchant: Merchant;
  authToken: string;
  onProfileUpdated: (user: UserProfile) => void;
  onSignOut: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  merchant,
  authToken,
  onProfileUpdated,
  onSignOut,
}) => {
  const [fullName, setFullName] = useState(user?.full_name || 'Aniket Choudhary');
  const [email, setEmail] = useState(user?.email || 'aniketchoudhary9507@gmail.com');
  const [phone, setPhone] = useState(user?.phone || '+91 98765 43210');
  const [jobTitle, setJobTitle] = useState(
    user?.job_title || 'Founder & Principal Systems Architect'
  );
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [businessCategory, setBusinessCategory] = useState(
    user?.business_category || 'Fintech & SaaS Infrastructure'
  );
  const [panNumber, setPanNumber] = useState(user?.pan_number || 'ABCDE1234F');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean>(
    user ? Boolean(user.two_factor_enabled) : true
  );
  const [merchantName, setMerchantName] = useState(merchant.name);
  const [merchantVpa, setMerchantVpa] = useState(merchant.vpa);
  const [merchantGstin, setMerchantGstin] = useState(merchant.gstin || '');

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [passErr, setPassErr] = useState<string | null>(null);

  // Active Sessions State
  const [sessions, setSessions] = useState<UserSessionRecord[]>([]);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: authToken ? { 'X-OpenPay-Token': authToken } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.sessions) setSessions(data.sessions);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [authToken]);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name);
      setEmail(user.email);
      setPhone(user.phone);
      setJobTitle(user.job_title);
      setAvatarUrl(user.avatar_url || '');
      setBusinessCategory(user.business_category || 'Fintech & SaaS Infrastructure');
      setPanNumber(user.pan_number || '');
      setTwoFactorEnabled(Boolean(user.two_factor_enabled));
    }
    setMerchantName(merchant.name);
    setMerchantVpa(merchant.vpa);
    setMerchantGstin(merchant.gstin || '');
  }, [user?.id, merchant.id]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileErr(null);
    setSavingProfile(true);

    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'X-OpenPay-Token': authToken } : {}),
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone,
          job_title: jobTitle,
          avatar_url: avatarUrl,
          business_category: businessCategory,
          pan_number: panNumber,
          two_factor_enabled: twoFactorEnabled,
          merchant_name: merchantName,
          merchant_vpa: merchantVpa,
          merchant_gstin: merchantGstin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileErr(data.error || 'Failed to update profile');
      } else if (data.user) {
        setProfileMsg('Profile & Merchant KYC details saved successfully.');
        onProfileUpdated(data.user);
      }
    } catch {
      setProfileErr('Network error while saving profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg(null);
    setPassErr(null);

    if (newPassword !== confirmPassword) {
      setPassErr('New password and confirmation do not match.');
      return;
    }

    setChangingPass(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'X-OpenPay-Token': authToken } : {}),
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPassErr(data.error || 'Failed to update password');
      } else {
        setPassMsg('Password updated with Scrypt cryptographic hash.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setPassErr('Network error while updating password.');
    } finally {
      setChangingPass(false);
    }
  };

  const handleRevokeOtherSessions = async () => {
    await fetch('/api/auth/revoke-other-sessions', {
      method: 'POST',
      headers: authToken ? { 'X-OpenPay-Token': authToken } : {},
    });
    fetchSessions();
  };

  const initials = (fullName || 'AC')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-8">
      {/* Top Profile Identity Banner */}
      <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={fullName}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white font-display font-bold text-xl flex items-center justify-center shrink-0 shadow-xs">
              {initials}
            </div>
          )}

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-display font-bold text-slate-900">{fullName}</h2>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{user?.role || 'Founder & Owner'}</span>
              </span>
            </div>
            <div className="text-xs text-slate-600">{jobTitle}</div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono">
              <span className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                {email}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                {phone || 'No phone set'}
              </span>
              <span>·</span>
              <span>VPA: {merchant.vpa}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onSignOut}
            className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-display font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Personal + Business KYC Form (Left) & Security / Sessions (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Edit Personal & Merchant KYC Profile */}
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-7 p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-6 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-display font-bold text-slate-900 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <span>Personal Profile & Merchant KYC Details</span>
              </h3>
              <p className="text-xs text-slate-500">
                Manage your personal owner identity, business category, and receiving UPI account.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Full Name *</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Job Title / Designation</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Email Address *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Mobile Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div className="flex items-center gap-2 font-display font-bold text-sm text-slate-900">
              <Building2 className="w-4 h-4 text-blue-600" />
              <span>Business KYC & Direct UPI Settlement Account</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">
                  Registered Business / Brand Name *
                </label>
                <input
                  type="text"
                  required
                  value={merchantName}
                  onChange={(e) => setMerchantName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">
                  Receiving Bank UPI VPA (pa) *
                </label>
                <input
                  type="text"
                  required
                  value={merchantVpa}
                  onChange={(e) => setMerchantVpa(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">Business Category</label>
                <input
                  type="text"
                  value={businessCategory}
                  onChange={(e) => setBusinessCategory(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">Business PAN Number</label>
                <input
                  type="text"
                  maxLength={10}
                  value={panNumber}
                  onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">GSTIN (For Tax Invoices)</label>
                <input
                  type="text"
                  value={merchantGstin}
                  onChange={(e) => setMerchantGstin(e.target.value.toUpperCase())}
                  placeholder="27AAPFU0939F1ZV"
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-700 font-medium">Profile Avatar URL</label>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900">
                Require HMAC-SHA256 Signature Verification on All Webhooks
              </div>
              <div className="text-[11px] text-slate-500">
                Enforces cryptographic signature checks for incoming Android Observer alerts and
                outbound order webhooks.
              </div>
            </div>
            <input
              type="checkbox"
              checked={twoFactorEnabled}
              onChange={(e) => setTwoFactorEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
            />
          </div>

          {profileMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{profileMsg}</span>
            </div>
          )}

          {profileErr && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">
              {profileErr}
            </div>
          )}

          <button
            type="submit"
            disabled={savingProfile}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-display font-semibold text-xs transition-colors cursor-pointer shadow-xs"
          >
            {savingProfile ? 'Saving Profile...' : 'Save Profile & KYC Details'}
          </button>
        </form>

        {/* Right 5 Cols: Password Change + Active Sessions */}
        <div className="lg:col-span-5 space-y-6">
          {/* Change Password Card */}
          <form
            onSubmit={handleChangePassword}
            className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4 text-xs"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-600" />
              <h3 className="text-base font-display font-bold text-slate-900">
                Change Account Password
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Default Founder Password is <code className="font-mono text-slate-800">OpenPay@2026</code>.
            </p>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Current Password *</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">New Password *</label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-700 font-medium">Confirm New Password *</label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            {passMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
                {passMsg}
              </div>
            )}

            {passErr && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">
                {passErr}
              </div>
            )}

            <button
              type="submit"
              disabled={changingPass}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-display font-semibold text-xs transition-colors cursor-pointer"
            >
              {changingPass ? 'Updating Password...' : 'Update Password'}
            </button>
          </form>

          {/* Active Login Sessions Card */}
          <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-blue-600" />
                <h3 className="text-base font-display font-bold text-slate-900">
                  Active Login Sessions
                </h3>
              </div>
              {sessions.length > 1 && (
                <button
                  type="button"
                  onClick={handleRevokeOtherSessions}
                  className="text-rose-600 hover:underline font-medium cursor-pointer"
                >
                  Revoke Others
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {sessions.length === 0 ? (
                <div className="p-4 text-slate-500 text-center">
                  Active Founder Session (Authenticated)
                </div>
              ) : (
                sessions.map((s, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-white flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Laptop className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-mono text-slate-900 font-medium truncate">
                          {s.token_prefix}{' '}
                          {s.is_current && (
                            <span className="text-emerald-600 font-sans font-semibold">
                              · Current Session
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{s.user_agent}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          IP: {s.ip_address} · Signed in{' '}
                          {new Date(s.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
