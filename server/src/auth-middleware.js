import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'guga-dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '30d';

export function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// 认证中间件：解析 Authorization: Bearer <token>，注入 req.user
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: Number(payload.uid), email: payload.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}
