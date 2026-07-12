import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execute } from '../lib/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  try {
    // Create migrations tracker table
    await execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        filename   VARCHAR(200) UNIQUE NOT NULL,
        ran_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationFiles = ['001_init.sql', '002_receipts.sql'];

    for (const file of migrationFiles) {
      const [already] = await import('../lib/database.js').then(m => m.query('SELECT id FROM _migrations WHERE filename = ?', [file]));
      if (already) continue;

      const sql = await readFile(path.join(__dirname, file), 'utf8');
      const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        try { await execute(stmt); } catch (e) {
          const msg = e.message || '';
          if (!/already exists|Duplicate column|Duplicate key name/i.test(msg)) throw e;
        }
      }
      await execute('INSERT INTO _migrations (filename) VALUES (?)', [file]);
      console.log(`✅ Migration ${file} ran`);
    }
  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  }
}
