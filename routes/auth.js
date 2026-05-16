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

export default router;
