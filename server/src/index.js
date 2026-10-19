import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import authRouter from './auth.js';
import dataRouter from './data.js';
import filesRouter from './files.js';
import hotRouter from './hot.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api', hotRouter);
app.use('/api', dataRouter);
app.use('/api', filesRouter);

// 统一 404
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[server]', err.message);
  res.status(500).json({ error: '服务内部错误' });
});

app.listen(PORT, () => {
  console.log(`[server] 咕嘎管家后端已启动，端口 ${PORT}`);
});
