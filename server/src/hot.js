import express from 'express';

/**
 * 热点聚合模块
 *
 * GET /api/hot/:platform   单平台（douyin | xiaohongshu）
 * GET /api/hot/all         一次取两个平台
 *
 * 设计要点：
 * - 服务端代理第三方热榜源，前端不直连外部域名（避免跨域 + 内网/预览环境访问不到外网）
 * - 内存缓存 10 分钟：热榜更新频率本来就不高，避免把上游打爆
 * - 多源回退：主源失败自动切备用源
 * - 全失败时回吐上次成功缓存（stale=true），前端可继续展示旧数据而不是空
 * - 公开数据，不鉴权（未登录也要能看）
 */
const router = express.Router();

const CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_FORCE_INTERVAL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 热度值格式化：本来就是字符串（如 "947.5w"）就原样用 */
function fmtHot(v) {
  if (typeof v === 'string') {
    const s = v.trim();
    return s && s !== '0' ? s : '';
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + 'w';
  return String(n);
}

function cleanTitle(t) {
  return String(t || '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DailyHotApi 标准格式的解析器（baiwumm / imsyy 等都是这套结构） */
function parseDailyHot(json) {
  const list = Array.isArray(json?.data) ? json.data : null;
  if (!list || !list.length) return null;
  const items = [];
  for (const it of list) {
    const title = cleanTitle(it.title);
    if (!title) continue;
    const url = String(it.url || it.mobileUrl || '').trim();
    items.push({
      title,
      hot: typeof it.hot === 'number' ? it.hot : Number(it.hot) || 0,
      hotText: fmtHot(it.hot),
      url: /^https?:\/\//i.test(url) ? url : '',
      pic: String(it.pic || ''),
      label: String(it.label || ''),
    });
  }
  if (!items.length) return null;
  return items.map((it, i) => ({ rank: i + 1, ...it }));
}

/** 平台 → 数据源列表（按优先级，全部免 key） */
const PLATFORMS = {
  douyin: {
    label: '抖音热榜',
    sources: [
      { name: 'baiwumm', url: 'https://hot.baiwumm.com/api/douyin' },
      { name: 'vvhan', url: 'https://api.vvhan.com/api/hotlist/douyinHot' },
    ],
  },
  xiaohongshu: {
    label: '小红书热门',
    sources: [
      { name: 'baiwumm', url: 'https://hot.baiwumm.com/api/xiaohongshu' },
    ],
  },
};

/** 每平台一份缓存 */
const cache = new Map(); // platform -> { at, lastForce, items, source }

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const items = parseDailyHot(json);
    if (!items) throw new Error('返回结构异常或列表为空');
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function loadPlatform(platform, { force = false } = {}) {
  const def = PLATFORMS[platform];
  const now = Date.now();
  const hit = cache.get(platform);

  const isFresh = hit && now - hit.at < CACHE_TTL_MS;
  const forceTooSoon = force && hit && now - hit.lastForce < MIN_FORCE_INTERVAL_MS;
  if (isFresh && !(force && !forceTooSoon)) {
    return { ok: true, platform, label: def.label, items: hit.items, source: hit.source, updatedAt: new Date(hit.at).toISOString(), cached: true, stale: false };
  }

  const errors = [];
  for (const src of def.sources) {
    try {
      const items = await fetchOnce(src.url);
      cache.set(platform, { at: now, lastForce: now, items, source: src.name });
      return { ok: true, platform, label: def.label, items, source: src.name, updatedAt: new Date(now).toISOString(), cached: false, stale: false };
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`);
      console.warn(`[hot] ${platform} 源 ${src.name} 失败: ${e.message}`);
    }
  }

  // 全部失败：有旧缓存就回吐旧数据
  if (hit) {
    return { ok: true, platform, label: def.label, items: hit.items, source: hit.source, updatedAt: new Date(hit.at).toISOString(), cached: true, stale: true, warning: errors.join('; ') };
  }
  return { ok: false, platform, label: def.label, items: [], error: '热榜源暂时不可用', detail: errors.join('; ') };
}

// 单平台
router.get('/hot/:platform', async (req, res) => {
  const platform = String(req.params.platform || '').toLowerCase();
  if (!PLATFORMS[platform]) {
    return res.status(404).json({ ok: false, error: '不支持的热榜平台', supported: Object.keys(PLATFORMS) });
  }
  try {
    const data = await loadPlatform(platform, { force: req.query.force === '1' });
    res.status(data.ok ? 200 : 503).json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: '获取热榜失败' });
  }
});

// 聚合（前端一次拿全，减少请求）
router.get('/hot', async (req, res) => {
  const force = req.query.force === '1';
  try {
    const names = Object.keys(PLATFORMS);
    const results = await Promise.all(names.map((p) => loadPlatform(p, { force })));
    const payload = { ok: results.some((r) => r.ok), updatedAt: new Date().toISOString() };
    for (const r of results) payload[r.platform] = r;
    res.json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: '获取热榜失败' });
  }
});

export default router;
