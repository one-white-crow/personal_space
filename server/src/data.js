import { Router } from 'express';
import { query } from './db.js';
import { requireAuth } from './auth-middleware.js';

const router = Router();
router.use(requireAuth);

/* ===== 日记 ===== */

// 拉取当前用户全部日记
router.get('/diaries', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, client_id, date, html, updated_at FROM diaries WHERE user_id = $1 ORDER BY date, created_at',
      [req.user.id]
    );
    res.json({ diaries: rows });
  } catch (e) {
    console.error('[diaries/get]', e.message);
    res.status(500).json({ error: '读取日记失败' });
  }
});

// 幂等 upsert（按 client_id）
router.put('/diaries/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { date, html, updated_at } = req.body || {};
  if (!clientId) return res.status(400).json({ error: '缺少 client_id' });
  try {
    await query(
      `INSERT INTO diaries (user_id, client_id, date, html, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, client_id)
       DO UPDATE SET date = EXCLUDED.date, html = EXCLUDED.html, updated_at = EXCLUDED.updated_at`,
      [req.user.id, clientId, date || '', html || '', updated_at || new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[diaries/put]', e.message);
    res.status(500).json({ error: '保存日记失败' });
  }
});

// 按 client_id 删除
router.delete('/diaries/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    await query('DELETE FROM diaries WHERE user_id = $1 AND client_id = $2', [req.user.id, clientId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[diaries/delete]', e.message);
    res.status(500).json({ error: '删除日记失败' });
  }
});

// 按数据库 id 删除（兼容前端冲突解决逻辑）
router.delete('/diaries-id/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: '缺少 id' });
  try {
    await query('DELETE FROM diaries WHERE user_id = $1 AND id = $2', [req.user.id, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[diaries/delete-id]', e.message);
    res.status(500).json({ error: '删除日记失败' });
  }
});

/* ===== 应用状态（目标/日程/提醒/番茄统计 整包 JSONB） ===== */

router.get('/state', async (req, res) => {
  try {
    const { rows } = await query('SELECT payload FROM app_state WHERE user_id = $1', [req.user.id]);
    res.json({ payload: rows[0] ? rows[0].payload : null });
  } catch (e) {
    console.error('[state/get]', e.message);
    res.status(500).json({ error: '读取状态失败' });
  }
});

router.put('/state', async (req, res) => {
  const { payload } = req.body || {};
  try {
    await query(
      `INSERT INTO app_state (user_id, payload, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [req.user.id, JSON.stringify(payload || {})]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[state/put]', e.message);
    res.status(500).json({ error: '保存状态失败' });
  }
});

export default router;
