/**
 * YouPI-PG Universal Drop-In Checkout SDK (v1.0.0)
 * Zero-dependency vanilla JS script (<8KB) supporting:
 * 1. Zero-JS Declarative Mode: <button data-youpi-pay data-amount="499" data-order-id="ORD-101">Pay Now</button>
 * 2. Programmatic API: window.YoupiPG.open({ amount: 499, orderId: 'ORD-101', customer: {...}, onSuccess, onClose })
 */
(function (window, document) {
  if (window.YoupiPG) return;

  var activeOverlay = null;
  var activeCallbacks = {};

  function resolveBaseUrl() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('sdk.js') !== -1) {
        try {
          var url = new URL(src, window.location.origin);
          return url.origin;
        } catch (e) {
          return window.location.origin;
        }
      }
    }
    return window.location.origin;
  }

  function closeOverlay(reason) {
    if (!activeOverlay) return;
    var overlayEl = activeOverlay;
    activeOverlay = null;
    overlayEl.style.opacity = '0';
    setTimeout(function () {
      if (overlayEl.parentNode) {
        overlayEl.parentNode.removeChild(overlayEl);
      }
    }, 180);
    if (typeof activeCallbacks.onClose === 'function') {
      try {
        activeCallbacks.onClose({ reason: reason || 'user_dismissed' });
      } catch (e) {
        console.error('[YoupiPG] onClose callback error:', e);
      }
    }
    activeCallbacks = {};
  }

  function mountIframeModal(sessionId, baseUrl) {
    if (activeOverlay) {
      closeOverlay('replaced');
    }

    var overlay = document.createElement('div');
    overlay.id = 'youpi-pg-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483640',
      'background:rgba(15, 23, 42, 0.65)',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:16px',
      'opacity:0',
      'transition:opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)'
    ].join(';');

    var frameContainer = document.createElement('div');
    frameContainer.style.cssText = [
      'position:relative',
      'width:100%',
      'max-width:440px',
      'height:min(720px, 92vh)',
      'border-radius:16px',
      'overflow:hidden',
      'box-shadow:0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(15, 23, 42, 0.08)',
      'background:#FFFFFF'
    ].join(';');

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close checkout');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:12px',
      'z-index:10',
      'width:30px',
      'height:30px',
      'border-radius:9999px',
      'border:1px solid rgba(255,255,255,0.25)',
      'background:rgba(15, 23, 42, 0.25)',
      'color:#FFFFFF',
      'font-size:20px',
      'line-height:1',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center'
    ].join(';');
    closeBtn.onclick = function () {
      closeOverlay('button_close');
    };

    var iframe = document.createElement('iframe');
    iframe.src = baseUrl + '/checkout/' + encodeURIComponent(sessionId) + '?embed=1';
    iframe.title = 'YouPI-PG Secure UPI Checkout';
    iframe.allow = 'clipboard-write';
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#FFFFFF;';

    frameContainer.appendChild(closeBtn);
    frameContainer.appendChild(iframe);
    overlay.appendChild(frameContainer);

    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) {
        closeOverlay('backdrop_click');
      }
    });

    document.body.appendChild(overlay);
    activeOverlay = overlay;
    requestAnimationFrame(function () {
      overlay.style.opacity = '1';
    });
  }

  function openCheckout(options) {
    if (!options || (!options.amount && !options.amountPaise && !options.sessionId)) {
      throw new Error('[YoupiPG] amount or sessionId is required.');
    }

    var baseUrl = options.baseUrl || resolveBaseUrl();
    activeCallbacks = {
      onSuccess: options.onSuccess,
      onExpired: options.onExpired,
      onClose: options.onClose
    };

    if (options.sessionId) {
      mountIframeModal(options.sessionId, baseUrl);
      return Promise.resolve({ sessionId: options.sessionId });
    }

    var amountPaise = options.amountPaise
      ? parseInt(options.amountPaise, 10)
      : Math.round(parseFloat(options.amount) * 100);

    var payload = {
      orderId: options.orderId || 'ORD-' + Math.floor(100000 + Math.random() * 900000),
      amountPaise: amountPaise,
      customerName: (options.customer && options.customer.name) || options.customerName || '',
      customerPhone: (options.customer && options.customer.phone) || options.customerPhone || '',
      customerEmail: (options.customer && options.customer.email) || options.customerEmail || '',
      callbackUrl: options.callbackUrl || window.location.href
    };

    return fetch(baseUrl + '/api/checkout/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to create checkout session');
        return res.json();
      })
      .then(function (data) {
        mountIframeModal(data.session.id, baseUrl);
        return data.session;
      });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    if (msg.type === 'youpi:payment:success') {
      var successEvent = new CustomEvent('youpi:payment:success', { detail: msg.payload });
      window.dispatchEvent(successEvent);
      if (typeof activeCallbacks.onSuccess === 'function') {
        try {
          activeCallbacks.onSuccess(msg.payload);
        } catch (e) {
          console.error('[YoupiPG] onSuccess error:', e);
        }
      }
      if (msg.payload && msg.payload.autoClose) {
        closeOverlay('payment_verified');
      }
    } else if (msg.type === 'youpi:payment:expired') {
      var expiredEvent = new CustomEvent('youpi:payment:expired', { detail: msg.payload });
      window.dispatchEvent(expiredEvent);
      if (typeof activeCallbacks.onExpired === 'function') {
        try {
          activeCallbacks.onExpired(msg.payload);
        } catch (e) {
          console.error('[YoupiPG] onExpired error:', e);
        }
      }
    } else if (msg.type === 'youpi:checkout:close') {
      closeOverlay('iframe_close');
    }
  });

  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-youpi-pay]') : null;
    if (!target) return;
    e.preventDefault();

    var amount = target.getAttribute('data-amount') || '499';
    var orderId = target.getAttribute('data-order-id') || 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    var customerName = target.getAttribute('data-customer-name') || '';
    var customerPhone = target.getAttribute('data-customer-phone') || '';

    openCheckout({
      amount: parseFloat(amount),
      orderId: orderId,
      customerName: customerName,
      customerPhone: customerPhone
    });
  });

  window.YoupiPG = {
    version: '1.0.0',
    open: openCheckout,
    close: closeOverlay
  };
})(window, document);
