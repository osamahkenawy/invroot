/**
 * Purge fixture tenants left behind by a test run that died mid-way.
 *
 * Each suite tears down after itself, but a crash — nodemon restarting the
 * server under a running test, most often — skips the teardown and strands a
 * tenant with its invoices, payments and S3 objects. They are harmless but they
 * accumulate, and a bucket full of orphaned fixtures makes it hard to tell
 * whether a real upload worked.
 *
 * Deliberately matches only names this project's own suites generate. It will
 * not touch a real workspace, whatever it is called.
 */
import 'dotenv/config';
import { query, execute } from '../src/lib/database.js';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

const PATTERNS = ['%Fixture%', 'Adv %', '%Demo %'];
const where = PATTERNS.map(() => 'company_name LIKE ?').join(' OR ');
const rows = await query(`SELECT id, company_name FROM tenants WHERE ${where}`, PATTERNS);

if (!rows.length) { console.log('No fixture tenants left behind.'); process.exit(0); }
const ids = rows.map(r => r.id);
console.log(`Removing ${ids.length} fixture tenant(s):`);
rows.forEach(r => console.log(`   ${r.id}  ${r.company_name}`));

let objects = 0;
if (process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
  const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-2',
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
  });
  for (const id of ids) {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: `tenants/${id}/` })).catch(() => ({}));
    for (const o of r.Contents || []) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: o.Key }));
      objects++;
    }
  }
}

/* Children before parents — no FK cascade to rely on here. */
const TABLES = [
  ['payments','tenant_id'], ['bank_transactions','tenant_id'], ['bank_accounts','tenant_id'],
  ['invroot_attachments','tenant_id'], ['company_signatories','tenant_id'], ['receipts','tenant_id'],
  ['time_entries','tenant_id'], ['expenses','tenant_id'], ['invoices','tenant_id'],
  ['clients','tenant_id'], ['users','tenant_id'], ['invroot_audit_logs','tenant_id'],
  ['doc_counters','tenant_id'], ['invoice_numbering','tenant_id'], ['tenants','id'],
];
const ph = ids.map(() => '?').join(',');
for (const [table, col] of TABLES) {
  await execute(`DELETE FROM ${table} WHERE ${col} IN (${ph})`, ids).catch(() => {});
}

console.log(`\nDone — ${ids.length} tenant(s), ${objects} S3 object(s) removed.`);
process.exit(0);
