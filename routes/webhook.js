import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

function verifySignature(rawBody, signature) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

// POST /webhook/lemonsqueezy
// Raw body is required — registered with express.raw() in server.js
router.post('/', async (req, res) => {
  const signature = req.headers['x-signature'];
  if (!signature) return res.status(401).json({ error: 'Missing signature' });

  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName  = payload.meta?.event_name;
  const attrs      = payload.data?.attributes;
  const customData = payload.meta?.custom_data;

  console.log('[webhook] event_name:', eventName);
  console.log('[webhook] custom_data:', JSON.stringify(customData));
  console.log('[webhook] data.attributes.status:', attrs?.status);

  const userId = customData?.user_id;
  if (!userId) {
    console.log('[webhook] skipping — no user_id in custom_data');
    return res.status(200).json({ ok: true });
  }

  const statusMap = {
    subscription_created:   handleActive,
    subscription_updated:   handleUpdated,
    subscription_cancelled: handleCancelled,
    subscription_expired:   handleExpired,
    order_created:          handleActive,
  };

  const handler = statusMap[eventName];
  if (!handler) {
    console.log('[webhook] skipping — unhandled event:', eventName);
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    await handler(userId, attrs);
    res.json({ ok: true });
  } catch (err) {
    console.error('[webhook] handler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function handleActive(userId, attrs) {
  await upsertUser(userId, {
    plan:                'premium',
    subscription_status: attrs.status,
    plan_expires_at:     attrs.ends_at ?? null,
  });
}

async function handleUpdated(userId, attrs) {
  const isPremium = attrs.status === 'active' || attrs.status === 'on_trial';
  await upsertUser(userId, {
    plan:                isPremium ? 'premium' : 'free',
    subscription_status: attrs.status,
    plan_expires_at:     attrs.ends_at ?? null,
  });
}

async function handleCancelled(userId, attrs) {
  // Cancelled but still active until period ends
  await upsertUser(userId, {
    subscription_status: 'cancelled',
    plan_expires_at:     attrs.ends_at ?? null,
  });
}

async function handleExpired(userId, _attrs) {
  await upsertUser(userId, {
    plan:                'free',
    subscription_status: 'expired',
    plan_expires_at:     null,
  });
}

async function upsertUser(userId, fields) {
  const { error } = await supabaseAdmin
    .from('users')
    .update(fields)
    .eq('id', userId);

  if (error) throw new Error(error.message);
}

export default router;
