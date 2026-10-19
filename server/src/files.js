import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { requireAuth } from './auth-middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 上传根目录：server/uploads（可用 UPLOAD_DIR 环境变量覆盖）
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, String(req.user.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// 上传图片（需登录）
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const rel = `${req.user.id}/${req.file.filename}`;
  res.json({ path: rel, url: `/api/files/${rel}` });
});

// 访问图片（公开路径，文件名含随机串；如需鉴权可在此加校验）
router.get('/files/:userId/:name', (req, res) => {
  const { userId, name } = req.params;
  // 防目录穿越
  if (!/^\d+$/.test(userId) || !/^[\w.-]+$/.test(name)) return res.status(400).send('bad path');
  const p = path.join(UPLOAD_ROOT, userId, name);
  if (!p.startsWith(UPLOAD_ROOT)) return res.status(403).send('forbidden');
  res.sendFile(p, (err) => {
    if (err) res.status(404).send('not found');
  });
});

export default router;
