import { readFile, readdir } from 'fs/promises';
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

    // Read the directory instead of a hardcoded list — 003 and 004 were
    // shipped but never registered here, so they never ran.
    const migrationFiles = (await readdir(__dirname))
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const [already] = await import('../lib/database.js').then(m => m.query('SELECT id FROM _migrations WHERE filename = ?', [file]));
      if (already) continue;

      const sql = await readFile(path.join(__dirname, file), 'utf8');
      // Strip whole-line `--` comments before splitting. Splitting the raw file
      // on ';' breaks apart any comment that contains one, and the fragment is
      // then sent to MySQL as a statement.
      const statements = sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
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
