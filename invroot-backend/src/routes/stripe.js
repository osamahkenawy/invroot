import express from 'express';
import Stripe from 'stripe';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { config } from '../config.js';

const router = express.Router();
const stripe = new Stripe(config.stripe.secretKey);

/* ── POST /api/stripe/create-checkout ──────────────── */
router.post('/create-checkout', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const { plan } = req.body; // 'starter' | 'professional' | 'enterprise'
    const priceId = config.stripe.priceIds[plan];
    if (!priceId) return res.status(400).json({ success: false, message: 'Invalid plan' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${config.app.url}/settings/billing?success=1`,
      cancel_url: `${config.app.url}/settings/billing?cancelled=1`,
      metadata: { tenant_id: String(req.tenantId) },
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/stripe/webhook ───────────────────────── */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) {
        const plan = getPlanFromPriceId(sub.items.data[0]?.price?.id);
        await execute('UPDATE tenants SET plan = ?, subscription_id = ?, status = ? WHERE id = ?',
          [plan, sub.id, sub.status === 'active' ? 'active' : 'suspended', tenantId]);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) await execute("UPDATE tenants SET status = 'suspended' WHERE id = ?", [tenantId]);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    res.status(500).send('Handler error');
  }
});

function getPlanFromPriceId(priceId) {
  for (const [plan, id] of Object.entries(config.stripe.priceIds)) {
    if (id === priceId) return plan;
  }
  return 'starter';
}

export default router;
