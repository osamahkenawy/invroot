import mysql from 'mysql2/promise';
import { config } from '../config.js';

const typeCast = (field, next) => {
  if (field.type === 'DATE') return field.string();
  if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') return field.string();
  if (field.type === 'TINY' && field.length === 1) return field.string() === '1';
  return next();
};

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  typeCast,
  timezone: '+00:00',
});

export async function query(sql, params = []) {
  const [results] = await pool.query(sql, params);
  return results;
}

export async function execute(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result;
}

export async function transaction(fn) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function initDatabase() {
  try {
    const tempPool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
    });
    await tempPool.execute(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await tempPool.end();
    console.log(`Database '${config.db.database}' ready`);

    // Run initial migration
    const { runMigrations } = await import('../migrations/run.js');
    await runMigrations();
  } catch (err) {
    console.error('Database init failed:', err);
    throw err;
  }
}

export default pool;
