import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth }   from '../middleware/auth.js';

const router = Router();

// GET /auth/profile
// Returns the current user's plan and subscription status
router.get('/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('plan, subscription_status, plan_expires_at')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /auth/migrate
// Called once after sign-in: bulk-imports words from chrome.storage into Supabase.
// Free plan: capped at 30 words. Premium: all words.
router.post('/migrate', requireAuth, async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words) || words.length === 0) {
    return res.json({ migrated: 0 });
  }

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('plan')
    .eq('id', req.user.id)
    .single();

  const isPremium = profile?.plan === 'premium';
  const toMigrate = isPremium ? words : words.slice(0, 30);

  const rows = toMigrate.map(w => ({
    user_id:      req.user.id,
    original:     w.original,
    translations: w.translations ?? [],
    source_lang:  w.sourceLang  ?? 'ES',
    target_lang:  w.targetLang  ?? 'EN',
    context:      w.context     ?? null,
    word_type:    w.wordType    ?? null,
    tags:         w.tags        ?? [],
    custom_tags:  w.customTags  ?? [],
    saved_at:     w.savedAt     ?? new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('words')
    .upsert(rows, { onConflict: 'user_id,original,source_lang,target_lang' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ migrated: rows.length });
});

// POST /auth/google-token
// Accepts a Google OAuth access token from chrome.identity.getAuthToken.
// Validates it with Google, creates/finds the Supabase user, and returns a Supabase session token.
// No email is ever sent — the magic link token is exchanged immediately on the server.
router.post('/google-token', async (req, res) => {
  const { token: googleToken } = req.body;
  if (!googleToken) return res.status(400).json({ error: 'token required' });

  // 1. Validate with Google and get user info
  const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${googleToken}` },
  });
  if (!googleRes.ok) return res.status(401).json({ error: 'Invalid Google token' });
  const { email, name } = await googleRes.json();
  if (!email) return res.status(401).json({ error: 'No email in Google response' });

  // 2. generateLink with type 'magiclink' creates the user if they don't exist,
  //    then we exchange hashed_token for a real session — no email is sent.
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type:    'magiclink',
    email,
    options: { redirectTo: 'https://verbly-backend.onrender.com' },
  });
  if (linkError) return res.status(500).json({ error: linkError.message });

  const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type:       'email',
  });
  if (sessionError) return res.status(500).json({ error: sessionError.message });

  // 3. Get user plan
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('plan')
    .eq('id', sessionData.session.user.id)
    .single();

  res.json({
    supabaseToken: sessionData.session.access_token,
    plan:          profile?.plan ?? 'free',
    email,
  });
});

export default router;
