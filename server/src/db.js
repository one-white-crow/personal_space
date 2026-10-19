import pg from 'pg';

const { Pool } = pg;

// 数据库连接池。优先读取 DATABASE_URL（docker-compose / 云托管常见），
// 否则用独立的 PG* 环境变量拼接。
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'guga',
        user: process.env.PGUSER || 'guga',
        password: process.env.PGPASSWORD || 'guga',
      }
);

pool.on('error', (err) => {
  console.error('[db] 连接池异常:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

export default pool;
