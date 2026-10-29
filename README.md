# OpenPay — By Aniket | Self-Hosted Zero-Fee UPI Payment Gateway & Checkout Suite

**OpenPay — By Aniket** is a production-ready, self-hosted UPI Payment Gateway and Checkout Suite that lets you accept real money directly into your bank UPI VPA with **0% MDR fees**, **instant settlement**, **atomic FIFO queue collision protection**, and **cryptographic HMAC-SHA256 payment verification**.

---

## Core Architectural Invariants

1. **Zero Fund Custody (`0% Fee`):** Customer payments move directly from their UPI app (GPay, PhonePe, Paytm, BHIM, CRED) to your receiving bank VPA via standard NPCI `upi://pay` deep-links and dynamic vector SVG QR codes.
2. **Atomic Single-Slot FIFO Queue per `[VPA + Exact Amount]`:** Because Indian bank SMS/push notifications only include `(Amount, 12-Digit UTR, Sender)` and never your internal `order_id`, YouPI-PG locks only **one `ACTIVE` checkout session per `[VPA + Exact Amount]` bucket** (or globally per VPA). Concurrent customers paying the exact same amount enter a real-time Server-Sent Events (SSE) FIFO waiting room and are automatically promoted the millisecond the active slot completes or expires.
3. **Server-Authoritative Dual Timers:**
   - **5-Minute Active Window (`ACTIVE`):** Persisted in SQLite (`WAL` mode) so browser refreshes never reset the countdown.
   - **30-Second Verification Window (`PROCESSING`):** High-frequency verification state triggered when the customer clicks *"I Have Paid — Verify Now"* or submits their 12-digit UTR.
4. **Cryptographic Observation & Idempotency:** Incoming bank alerts from the companion Android Observer app (`/android-observer/YoupiObserverApp.kt`) are signed with `HMAC-SHA256` (`X-Observer-Signature`) and deduplicated using `SHA256(receivingVpa + amountPaise + utr + timeBucket)`.

---

## Quick Start (Self-Hosting)

```bash
# 1. Install dependencies
npm install

# 2. Run the Indian Bank SMS / UPI Regex Parser unit tests
npm run test:parser

# 3. Start the production-ready full-stack server (Port 3000)
npm run dev
```

---

## Universal Integration Guide (Integrate Into Any Website or App)

You can integrate YouPI-PG into **any website, e-commerce store, SaaS subscription app, or backend** using any of the 4 methods below:

---

### Option 1: 1-Line HTML Payment Button (Static Sites, WordPress, Webflow, Landing Pages)

Drop the standalone `<script src="https://your-gateway-domain.com/sdk.js" defer></script>` tag into your page and add `data-youpi-pay` to any button:

```html
<!-- 1. Include the YouPI-PG Drop-In SDK (<8KB, zero dependencies) -->
<script src="https://your-gateway-domain.com/sdk.js" defer></script>

<!-- 2. Place a Payment Button anywhere on your page -->
<button
  data-youpi-pay
  data-amount="499.00"
  data-order-id="ORD-1001"
  data-customer-name="Aarav Sharma"
  data-customer-phone="+919876543210"
  style="background:#2563EB;color:#fff;padding:12px 24px;border-radius:8px;border:none;font-weight:600;cursor:pointer;">
  Pay ₹499.00 via UPI
</button>
```

---

### Option 2: Frontend JavaScript / React / Next.js / Vue SDK (`window.YoupiPG.open`)

Use the programmatic JavaScript API when you want to trigger checkout dynamically from a shopping cart, SaaS upgrade flow, or single-page application:

```javascript
// Make sure <script src="https://your-gateway-domain.com/sdk.js"></script> is loaded
window.YoupiPG.open({
  amount: 499.00, // Amount in INR (or pass sessionId from your backend)
  orderId: 'ORD_' + Date.now(),
  customer: {
    name: 'Aarav Sharma',
    phone: '+91 9876543210',
    email: 'aarav@example.com'
  },
  onSuccess: function (payment) {
    // payment = { sessionId, orderId, amountPaise, utr, signature }
    console.log('Payment Verified! 12-Digit Bank UTR:', payment.utr);
    console.log('HMAC Signature:', payment.signature);
  },
  onDismiss: function () {
    console.log('Customer closed the checkout modal');
  }
});
```

---

### Option 3: Full Server-to-Server Order Creation & Signature Verification (Razorpay-Compatible Flow)

For production e-commerce stores, SaaS platforms, or digital subscriptions where you must prevent client-side tampering:

#### Step A — Create an Order on Your Backend (`POST /api/v1/orders`)

```javascript
// Node.js / Next.js API Route / Express Backend
const response = await fetch('https://your-gateway-domain.com/api/v1/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: 49900, // ₹499.00 in integer paise
    currency: 'INR',
    receipt: 'rcpt_order_101',
    notes: {
      customer_name: 'Aarav Sharma',
      customer_phone: '+919876543210',
      customer_email: 'aarav@example.com'
    }
  })
});

const order = await response.json();
// Returns:
// {
//   id: "order_...",
//   amount: 49900,
//   currency: "INR",
//   status: "created" | "queued",
//   checkout_session_id: "pay_...",
//   checkout_url: "/checkout/pay_..."
// }
```

#### Step B — Open the Checkout Modal with `sessionId` on Your Frontend

```javascript
window.YoupiPG.open({
  sessionId: order.checkout_session_id,
  onSuccess: async (payment) => {
    // Send payment proof to your backend to verify & fulfill the order
    await fetch('/api/fulfill-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        youpi_order_id: payment.orderId,
        youpi_payment_id: payment.sessionId,
        youpi_signature: payment.signature,
        utr: payment.utr
      })
    });
  }
});
```

#### Step C — Verify the Cryptographic Payment Signature on Your Backend (`POST /api/v1/payments/verify`)

```javascript
// Verify via YouPI-PG API or compute HMAC-SHA256 locally:
// expectedSignature = HMAC_SHA256(youpi_order_id + "|" + youpi_payment_id, YOUR_API_KEY_SECRET)
const verifyRes = await fetch('https://your-gateway-domain.com/api/v1/payments/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    youpi_order_id,
    youpi_payment_id,
    youpi_signature
  })
});

const { verified } = await verifyRes.json();
if (verified) {
  // Mark order paid / activate user subscription in your database!
}
```

---

### Option 4: Asynchronous Outbound Webhooks (`X-Youpi-Signature`)

Even if a customer closes their browser tab immediately after paying on their phone, YouPI-PG dispatches a signed `POST` webhook to the **Outbound Merchant Webhook URL** configured in your dashboard:

```javascript
import crypto from 'crypto';

app.post('/api/webhooks/youpi', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-youpi-signature'];
  const rawBody = req.body.toString('utf8');

  const expectedSignature = crypto
    .createHmac('sha256', process.env.YOUPI_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).send('Invalid webhook signature');
  }

  const event = JSON.parse(rawBody);
  if (event.event === 'payment.captured') {
    // event = { sessionId, orderId, amountPaise, utr, payerVpa, paymentSignature, customer }
    console.log(`Order ${event.orderId} paid via UPI! UTR: ${event.utr}`);
  }

  res.status(200).json({ received: true });
});
```

---

## Project Structure

- `/server.ts` — Express + SQLite (`WAL` mode) + SSE real-time payment engine, atomic FIFO queue, v1 Orders & Verification API, Payment Links, Refunds, CSV reconciliation, and GitHub OAuth Repo Publisher.
- `/public/sdk.js` — Standalone (<8KB) Universal Drop-In Checkout SDK.
- `/src/lib/bank-parser.ts` — Regex normalizer for Indian bank SMS & UPI push notifications (HDFC, ICICI, SBI, Axis, Kotak, Yes Bank, GPay, PhonePe, Paytm) + CSV statement parser.
- `/src/components/CustomerCheckoutModal.tsx` — High-craft responsive customer checkout modal with vector SVG QR, 1-tap UPI app intent buttons, UPI ID collect flow, and 12-digit UTR verification.
- `/src/components/AdminDashboard.tsx` — Merchant Dashboard for Orders, Live Queue Slots, Payment Links, Button Builder, CSV Statement Reconciliation, and GitHub Repository Publishing.
- `/android-observer/YoupiObserverApp.kt` — Companion Android Kotlin source code (`NotificationListenerService` + `BroadcastReceiver` + `HMAC-SHA256` signer + SQLite offline retry queue).
