import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth }   from '../middleware/auth.js';

const router = Router();

const FREE_WORD_LIMIT  = 30;
const FREE_DAILY_LIMIT = 20;

// GET /usage
// Returns current word count, daily translation count, plan limits, and
// boolean gates so the extension can decide whether to show upgrade prompts.
router.get('/', requireAuth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const [
    { count: wordCount },
    { data: usageRow },
    { data: profile },
  ] = await Promise.all([
    supabaseAdmin
      .from('words')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id),
    supabaseAdmin
      .from('usage')
      .select('translations_count')
      .eq('user_id', req.user.id)
      .eq('date', today)
      .maybeSingle(),
    supabaseAdmin
      .from('users')
      .select('plan')
      .eq('id', req.user.id)
      .single(),
  ]);

  const isPremium  = profile?.plan === 'premium';
  const dailyCount = usageRow?.translations_count ?? 0;
  const words      = wordCount ?? 0;

  res.json({
    plan:              profile?.plan ?? 'free',
    wordCount:         words,
    dailyTranslations: dailyCount,
    limits: {
      words:      isPremium ? null : FREE_WORD_LIMIT,
      dailyTrans: isPremium ? null : FREE_DAILY_LIMIT,
    },
    canTranslate: isPremium || dailyCount < FREE_DAILY_LIMIT,
    canSave:      isPremium || words      < FREE_WORD_LIMIT,
  });
});

// POST /usage/track
// Atomically increments today's translation counter for the user.
// No-op for premium users.
router.post('/track', requireAuth, async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('plan')
    .eq('id', req.user.id)
    .single();

  if (profile?.plan === 'premium') return res.json({ ok: true });

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin.rpc('increment_usage', {
    p_user_id: req.user.id,
    p_date:    today,
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, dailyTranslations: data });
});

export default router;
