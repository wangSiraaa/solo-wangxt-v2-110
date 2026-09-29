// 建表（幂等）。用法：node scripts/init-db.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../server/lib/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, '..', 'sql', 'schema.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('✓ schema applied');
} catch (e) {
  console.error('✗ schema failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
