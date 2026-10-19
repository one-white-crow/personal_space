import { Router } from 'express';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { query } from './db.js';
import { signToken, requireAuth } from './auth-middleware.js';

const router = Router();

// 邮箱验证码（内存存储，TTL 10 分钟；单实例部署够用，多实例请改存数据库/Redis）
const otpStore = new Map(); // email -> { code, expires }

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// SMTP 邮件发送（未配置 SMTP 时返回 null，验证码接口会给出明确提示）
function mailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' },
  });
}

async function sendMail(to, subject, text) {
  const t = mailTransport();
  if (!t) throw new Error('SMTP 未配置，无法发送邮件');
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text,
  });
}

// 注册（邮箱 + 密码）
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });
  const em = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  try {
    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [em, hash]
    );
    const user = rows[0];
    res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: '该邮箱已注册，请直接登录' });
    console.error('[auth/register]', e.message);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

// 登录（邮箱 + 密码）
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });
  const em = String(email).trim().toLowerCase();
  try {
    const { rows } = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [em]);
    const user = rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: '邮箱或密码错误' });
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: '邮箱或密码错误' });
    res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// 发送验证码
router.post('/otp/send', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: '请填写邮箱' });
  const em = String(email).trim().toLowerCase();
  const code = genCode();
  otpStore.set(em, { code, expires: Date.now() + 10 * 60 * 1000 });
  try {
    await sendMail(em, '【咕嘎管家】登录验证码', `你的验证码是 ${code}，10 分钟内有效。若非本人操作请忽略。`);
    res.json({ ok: true, message: '验证码已发送，请查收邮箱' });
  } catch (e) {
    console.error('[auth/otp/send]', e.message);
    res.status(503).json({ error: '邮件发送失败：服务端未配置 SMTP，请改用密码登录或联系管理员' });
  }
});

// 验证码登录（用户不存在则自动注册；可选 password 用于注册/补设密码）
router.post('/otp/verify', async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: '请填写邮箱和验证码' });
  const em = String(email).trim().toLowerCase();
  const rec = otpStore.get(em);
  if (!rec || rec.expires < Date.now()) return res.status(401).json({ error: '验证码已过期，请重新获取' });
  if (rec.code !== String(code).trim()) return res.status(401).json({ error: '验证码错误' });
  otpStore.delete(em);

  try {
    let { rows } = await query('SELECT id, email, password_hash FROM users WHERE email = $1', [em]);
    let user = rows[0];
    if (!user) {
      const hash = password ? await bcrypt.hash(String(password), 10) : null;
      const ins = await query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [em, hash]
      );
      user = ins.rows[0];
    } else if (password && !user.password_hash) {
      // 已有 OTP-only 用户，补设密码
      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await bcrypt.hash(String(password), 10)]);
    }
    res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('[auth/otp/verify]', e.message);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// 忘记密码：发送重置验证码（简化处理，与登录验证码共用；实际生产可单独链路）
router.post('/reset-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: '请填写邮箱' });
  const em = String(email).trim().toLowerCase();
  const code = genCode();
  otpStore.set('reset:' + em, { code, expires: Date.now() + 10 * 60 * 1000 });
  try {
    await sendMail(em, '【咕嘎管家】重置密码验证码', `你的重置验证码是 ${code}，10 分钟内有效。`);
    res.json({ ok: true, message: '验证码已发送，请查收邮箱' });
  } catch (e) {
    res.status(503).json({ error: '邮件发送失败：服务端未配置 SMTP' });
  }
});

// 验证码 + 新密码 重置密码，成功后直接返回 token（自动登录）
router.post('/reset-password/confirm', async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) return res.status(400).json({ error: '请填写邮箱、验证码和新密码' });
  const em = String(email).trim().toLowerCase();
  if (String(newPassword).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const rec = otpStore.get('reset:' + em);
  if (!rec || rec.expires < Date.now()) return res.status(401).json({ error: '验证码已过期，请重新获取' });
  if (rec.code !== String(code).trim()) return res.status(401).json({ error: '验证码错误' });
  otpStore.delete('reset:' + em);
  try {
    const hash = await bcrypt.hash(String(newPassword), 10);
    const { rows } = await query(
      'UPDATE users SET password_hash = $2 WHERE email = $1 RETURNING id, email',
      [em, hash]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: '该邮箱尚未注册' });
    res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('[auth/reset-confirm]', e.message);
    res.status(500).json({ error: '重置失败，请稍后重试' });
  }
});

// 当前用户
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

// 登出（JWT 无状态，前端删除 token 即可；保留接口占位）
router.post('/logout', requireAuth, (req, res) => {
  res.json({ ok: true });
});

export default router;
