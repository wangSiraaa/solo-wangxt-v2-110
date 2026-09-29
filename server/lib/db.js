import pg from 'pg';

export const pool = new pg.Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 55432),
  user: process.env.PGUSER || 'migration',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'url_migration',
  max: 8,
});

export const q = (text, params) => pool.query(text, params);
