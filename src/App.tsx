import React, { useEffect, useState, useCallback } from 'react';
import { AdminDashboardSnapshot, UserProfile } from './lib/types';
import { CustomerCheckoutModal } from './components/CustomerCheckoutModal';
import { AdminDashboard, AdminTabType } from './components/AdminDashboard';
import { PaymentLinkView } from './components/PaymentLinkView';
import { AuthView } from './components/AuthView';

type ActiveRoute =
  | { view: 'admin'; subTab: AdminTabType }
  | { view: 'checkout'; sessionId: string; isEmbed: boolean }
  | { view: 'payment_link'; shortCode: string }
  | { view: 'auth' };

function parseLocationRoute(): ActiveRoute {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const isEmbed = params.get('embed') === '1';

  const checkoutMatch = path.match(/^\/checkout\/([^/?#]+)/);
  if (checkoutMatch && checkoutMatch[1]) {
    return {
      view: 'checkout',
      sessionId: decodeURIComponent(checkoutMatch[1]),
      isEmbed,
    };
  }

  const payLinkMatch = path.match(/^\/pay\/([^/?#]+)/);
  if (payLinkMatch && payLinkMatch[1]) {
    return {
      view: 'payment_link',
      shortCode: decodeURIComponent(payLinkMatch[1]),
    };
  }

  const tabParam = params.get('tab');
  if (tabParam === 'auth') {
    return { view: 'auth' };
  }

  const subTab: AdminTabType =
    tabParam === 'links' ||
    tabParam === 'buttons' ||
    tabParam === 'reconcile' ||
    tabParam === 'settings' ||
    tabParam === 'profile'
      ? tabParam
      : 'transactions';

  return { view: 'admin', subTab };
}

export default function App() {
  const [route, setRoute] = useState<ActiveRoute>(() => parseLocationRoute());
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authToken, setAuthToken] = useState<string>(
    () => localStorage.getItem('openpay_auth_token') || ''
  );

  const navigateTo = useCallback((nextRoute: ActiveRoute) => {
    setRoute(nextRoute);
    if (nextRoute.view === 'admin') {
      window.history.pushState(
        {},
        '',
        nextRoute.subTab === 'transactions' ? '/' : `/?tab=${nextRoute.subTab}`
      );
    } else if (nextRoute.view === 'auth') {
      window.history.pushState({}, '', '/?tab=auth');
    } else if (nextRoute.view === 'checkout') {
      window.history.pushState(
        {},
        '',
        `/checkout/${encodeURIComponent(nextRoute.sessionId)}${
          nextRoute.isEmbed ? '?embed=1' : ''
        }`
      );
    } else if (nextRoute.view === 'payment_link') {
      window.history.pushState({}, '', `/pay/${encodeURIComponent(nextRoute.shortCode)}`);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(parseLocationRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchAuthMe = useCallback(async (tokenOverride?: string) => {
    const tok = tokenOverride !== undefined ? tokenOverride : authToken;
    try {
      const res = await fetch('/api/auth/me', {
        headers: tok ? { 'X-OpenPay-Token': tok } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setCurrentUser(data.user);
        }
      }
    } catch {
      // Ignore transient errors
    }
  }, [authToken]);

  useEffect(() => {
    fetchAuthMe();
  }, [fetchAuthMe]);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/snapshot');
      if (res.ok) {
        const data: AdminDashboardSnapshot = await res.json();
        setSnapshot(data);
        if (!currentUser && data.user) {
          setCurrentUser(data.user);
        }
      }
    } catch {
      // Ignore transient errors
    }
  }, [currentUser]);

  useEffect(() => {
    if (route.view !== 'admin') return;

    fetchSnapshot();
    const es = new EventSource('/api/admin/stream');
    es.addEventListener('admin_snapshot', (ev: MessageEvent) => {
      try {
        const data: AdminDashboardSnapshot = JSON.parse(ev.data);
        setSnapshot(data);
      } catch {
        // Ignore malformed SSE
      }
    });

    return () => {
      es.close();
    };
  }, [route.view, fetchSnapshot]);

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: authToken ? { 'X-OpenPay-Token': authToken } : {},
    });
    localStorage.removeItem('openpay_auth_token');
    setAuthToken('');
    setCurrentUser(null);
    navigateTo({ view: 'auth' });
  };

  // Embedded SDK Iframe View
  if (route.view === 'checkout' && route.isEmbed) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-2">
        <CustomerCheckoutModal
          sessionId={route.sessionId}
          isEmbeddedIframe
          onClose={() => {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'youpi:checkout:close' }, '*');
            }
          }}
        />
      </div>
    );
  }

  // Standalone Shareable Payment Link Page (/pay/:shortCode)
  if (route.view === 'payment_link') {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <PaymentLinkView shortCode={route.shortCode} />
      </div>
    );
  }

  // Merchant Sign In / Sign Up Portal
  if (route.view === 'auth') {
    return (
      <AuthView
        onAuthenticated={(user, token) => {
          setCurrentUser(user);
          setAuthToken(token);
          fetchSnapshot();
          navigateTo({ view: 'admin', subTab: 'transactions' });
        }}
      />
    );
  }

  const activeUser = currentUser || snapshot?.user || null;
  const userInitials = (activeUser?.full_name || 'Aniket Choudhary')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col justify-between">
      <div>
        {/* 3-Zone Top Bar Contract — Crisp Razorpay White & Royal Blue */}
        <header className="flex items-center justify-between gap-6 px-6 py-3.5 border-b border-slate-200 bg-white sticky top-0 z-40">
          {/* Zone 1: Brand wordmark */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateTo({ view: 'admin', subTab: 'transactions' });
            }}
            className="flex items-center gap-2 text-lg font-display font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-display font-bold flex items-center justify-center">
              OP
            </span>
            <span>
              OpenPay <span className="text-xs font-normal text-slate-500">— By Aniket</span>
            </span>
          </a>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="flex items-center gap-5 text-sm font-medium text-slate-600 overflow-x-auto">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigateTo({ view: 'admin', subTab: 'transactions' });
              }}
              className={`hover:text-blue-600 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'admin' && route.subTab === 'transactions'
                  ? 'text-blue-600 font-semibold underline'
                  : ''
              }`}
            >
              Transactions
            </a>
            <a
              href="/?tab=links"
              onClick={(e) => {
                e.preventDefault();
                navigateTo({ view: 'admin', subTab: 'links' });
              }}
              className={`hover:text-blue-600 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'admin' && route.subTab === 'links'
                  ? 'text-blue-600 font-semibold underline'
                  : ''
              }`}
            >
              Payment Links
            </a>
            <a
              href="/?tab=buttons"
              onClick={(e) => {
                e.preventDefault();
                navigateTo({ view: 'admin', subTab: 'buttons' });
              }}
              className={`hover:text-blue-600 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'admin' && route.subTab === 'buttons'
                  ? 'text-blue-600 font-semibold underline'
                  : ''
              }`}
            >
              Payment Buttons
            </a>
            <a
              href="/?tab=reconcile"
              onClick={(e) => {
                e.preventDefault();
                navigateTo({ view: 'admin', subTab: 'reconcile' });
              }}
              className={`hover:text-blue-600 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'admin' && route.subTab === 'reconcile'
                  ? 'text-blue-600 font-semibold underline'
                  : ''
              }`}
            >
              Reconciliation
            </a>
            <a
              href="/?tab=settings"
              onClick={(e) => {
                e.preventDefault();
                navigateTo({ view: 'admin', subTab: 'settings' });
              }}
              className={`hover:text-blue-600 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'admin' && route.subTab === 'settings'
                  ? 'text-blue-600 font-semibold underline'
                  : ''
              }`}
            >
              Integration & Settings
            </a>
            <a
              href="/?tab=profile"
              onClick={(e) => {
                e.preventDefault();
                navigateTo({ view: 'admin', subTab: 'profile' });
              }}
              className={`hover:text-blue-600 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                route.view === 'admin' && route.subTab === 'profile'
                  ? 'text-blue-600 font-semibold underline'
                  : ''
              }`}
            >
              Profile
            </a>
          </nav>

          {/* Zone 3: Primary Action & Merchant Profile Chip */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => navigateTo({ view: 'admin', subTab: 'links' })}
              className="hidden sm:inline-flex px-3.5 py-2 text-xs font-display font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
            >
              + Payment Link
            </button>

            <button
              type="button"
              onClick={() => navigateTo({ view: 'admin', subTab: 'profile' })}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs transition-colors cursor-pointer"
              title="Open Profile & Account Security"
            >
              <span className="w-6 h-6 rounded-lg bg-slate-900 text-white font-display font-bold text-[11px] flex items-center justify-center">
                {userInitials}
              </span>
              <span className="font-semibold text-slate-800 max-w-[110px] truncate">
                {activeUser?.full_name || 'Aniket'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo({ view: 'auth' })}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Sign In / Create Account"
            >
              Login
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main>
          {route.view === 'admin' && (
            <AdminDashboard
              snapshot={snapshot}
              activeSubTab={route.subTab}
              currentUser={activeUser}
              authToken={authToken}
              onSubTabChange={(subTab) => navigateTo({ view: 'admin', subTab })}
              onOpenCheckoutModal={(sessionId) =>
                navigateTo({ view: 'checkout', sessionId, isEmbed: false })
              }
              onRefresh={fetchSnapshot}
              onProfileUpdated={(updatedUser) => setCurrentUser(updatedUser)}
              onSignOut={handleSignOut}
            />
          )}

          {route.view === 'checkout' && (
            <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => navigateTo({ view: 'admin', subTab: 'transactions' })}
                  className="hover:text-slate-900 font-medium transition-colors cursor-pointer"
                >
                  ← Back to Dashboard
                </button>
                <span className="font-mono text-slate-400">
                  /checkout/{route.sessionId}
                </span>
              </div>

              <CustomerCheckoutModal
                sessionId={route.sessionId}
                isStandalonePage
                onVerified={fetchSnapshot}
                onClose={() => navigateTo({ view: 'admin', subTab: 'transactions' })}
              />
            </div>
          )}
        </main>
      </div>

      <footer className="max-w-[1320px] w-full mx-auto px-6 py-6 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
        <div>OpenPay — By Aniket · Direct-to-Bank UPI Payment Suite</div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigateTo({ view: 'admin', subTab: 'profile' })}
            className="hover:text-blue-600 cursor-pointer"
          >
            Merchant Profile
          </button>
          <a
            href="/sdk.js"
            target="_blank"
            rel="noreferrer"
            className="hover:text-blue-600 font-mono"
          >
            /sdk.js
          </a>
        </div>
      </footer>
    </div>
  );
}
