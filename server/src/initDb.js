import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[init-db] 数据库表结构已就绪');
  await pool.end();
}

main().catch((e) => {
  console.error('[init-db] 失败:', e.message);
  process.exit(1);
});
