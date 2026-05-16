import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth }   from '../middleware/auth.js';

const router = Router();

const FREE_WORD_LIMIT = 30;

// GET /words
// Returns all words for the authenticated user, newest first.
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('words')
    .select('*')
    .eq('user_id', req.user.id)
    .order('saved_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /words
// Saves a new word. Enforces free plan limit.
router.post('/', requireAuth, async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('plan')
    .eq('id', req.user.id)
    .single();

  const isPremium = profile?.plan === 'premium';

  if (!isPremium) {
    const { count } = await supabaseAdmin
      .from('words')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    if ((count ?? 0) >= FREE_WORD_LIMIT) {
      return res.status(403).json({
        error: 'Free plan word limit reached',
        code:  'WORD_LIMIT',
      });
    }
  }

  const w = req.body;
  const { data, error } = await supabaseAdmin
    .from('words')
    .insert({
      user_id:      req.user.id,
      original:     w.original,
      translations: w.translations ?? [],
      source_lang:  w.sourceLang,
      target_lang:  w.targetLang,
      context:      w.context    ?? null,
      word_type:    w.wordType   ?? null,
      tags:         w.tags       ?? [],
      custom_tags:  w.customTags ?? [],
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /words/:id
// Updates a word. Only allows safe fields; enforces ownership.
router.put('/:id', requireAuth, async (req, res) => {
  const ALLOWED = ['translations', 'tags', 'custom_tags', 'context', 'word_type'];
  const patch   = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED.includes(k))
  );

  const { data, error } = await supabaseAdmin
    .from('words')
    .update(patch)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)   // ownership guard
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Word not found' });
  res.json(data);
});

// DELETE /words/:id
// Deletes a single word owned by the user.
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('words')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

// DELETE /words  (body: { ids: string[] })
// Bulk-deletes words — used by the "Delete all" filtered action.
router.delete('/', requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  const { error } = await supabaseAdmin
    .from('words')
    .delete()
    .in('id', ids)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
});

export default router;
