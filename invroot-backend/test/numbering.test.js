/**
 * Document numbering.
 *
 * The concurrency test is the reason this file exists: before the doc_counters
 * change, firing 5 simultaneous invoice creates produced one success and four
 * duplicate-key 500s. It must never regress.
 */

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/lib/database.js';
import { nextDocNumber, resyncCounter } from '../src/lib/numbering.js';
import { makeTenant, makeInvoice, makeClient, dropTenant } from './helpers.js';

const created = [];
async function tenant(opts) {
  const t = await makeTenant(opts);
  created.push(t.tenantId);
  return t;
}

after(async () => {
  for (const id of created) await dropTenant(id);
  await pool.end();
});

describe('nextDocNumber', () => {
  test('date format is PREFIX/MM/YYYY/SEQ and starts at 1', async () => {
    const { tenantId } = await tenant({ numberFormat: 'date', prefix: 'ACME' });
    const num = await nextDocNumber(tenantId, 'invoice');
    assert.match(num, /^ACME\/\d{2}\/\d{4}\/1$/, `got ${num}`);
  });

  test('classic format is zero-padded to five digits', async () => {
    const { tenantId } = await tenant({ numberFormat: 'classic', prefix: 'INV' });
    const num = await nextDocNumber(tenantId, 'invoice');
    assert.equal(num, 'INV-00001');
  });

  test('sequence increments across successive calls', async () => {
    const { tenantId } = await tenant({ numberFormat: 'classic', prefix: 'SEQ' });
    const a = await nextDocNumber(tenantId, 'invoice');
    const b = await nextDocNumber(tenantId, 'invoice');
    const c = await nextDocNumber(tenantId, 'invoice');
    assert.deepEqual([a, b, c], ['SEQ-00001', 'SEQ-00002', 'SEQ-00003']);
  });

  test('document types keep independent counters', async () => {
    const { tenantId } = await tenant({ numberFormat: 'classic', prefix: 'X' });
    await nextDocNumber(tenantId, 'invoice');
    await nextDocNumber(tenantId, 'invoice');
    const quote = await nextDocNumber(tenantId, 'quote');
    // Quotes must not inherit the invoice counter.
    assert.match(quote, /-00001$/, `got ${quote}`);
  });

  test('an unknown document type is rejected', async () => {
    const { tenantId } = await tenant();
    await assert.rejects(() => nextDocNumber(tenantId, 'purchase_order'), /Unknown document type/);
  });

  test('seeds from existing invoices so a live tenant never restarts at 1', async () => {
    const { tenantId } = await tenant({ numberFormat: 'classic', prefix: 'OLD' });
    const clientId = await makeClient(tenantId);
    // Simulate history that predates the counter table.
    await makeInvoice(tenantId, clientId, { number: 'OLD-00041' });
    await makeInvoice(tenantId, clientId, { number: 'OLD-00042' });

    const next = await nextDocNumber(tenantId, 'invoice');
    assert.equal(next, 'OLD-00043', 'must continue after the highest existing number');
  });

  test('CONCURRENCY: 12 simultaneous allocations are all unique and gapless', async () => {
    const { tenantId } = await tenant({ numberFormat: 'classic', prefix: 'RACE' });

    const numbers = await Promise.all(
      Array.from({ length: 12 }, () => nextDocNumber(tenantId, 'invoice'))
    );

    const unique = new Set(numbers);
    assert.equal(unique.size, 12, `expected 12 distinct numbers, got ${unique.size}: ${numbers.join(', ')}`);

    const seqs = numbers.map(n => Number(n.split('-')[1])).sort((a, b) => a - b);
    assert.deepEqual(seqs, Array.from({ length: 12 }, (_, i) => i + 1), 'sequence must be 1..12 with no gaps');
  });

  test('CONCURRENCY: separate tenants do not interfere', async () => {
    const a = await tenant({ numberFormat: 'classic', prefix: 'TA' });
    const b = await tenant({ numberFormat: 'classic', prefix: 'TB' });

    const all = await Promise.all([
      ...Array.from({ length: 5 }, () => nextDocNumber(a.tenantId, 'invoice')),
      ...Array.from({ length: 5 }, () => nextDocNumber(b.tenantId, 'invoice')),
    ]);

    const aNums = all.filter(n => n.startsWith('TA-'));
    const bNums = all.filter(n => n.startsWith('TB-'));
    assert.equal(new Set(aNums).size, 5);
    assert.equal(new Set(bNums).size, 5);
  });
});

describe('resyncCounter', () => {
  test('pulls the counter back in line after rows are deleted', async () => {
    const { tenantId } = await tenant({ numberFormat: 'classic', prefix: 'RS' });
    const clientId = await makeClient(tenantId);

    for (let i = 0; i < 5; i++) {
      const num = await nextDocNumber(tenantId, 'invoice');
      await makeInvoice(tenantId, clientId, { number: num });
    }
    // Wipe the documents but leave the counter ahead, as a manual DB delete would.
    const { execute } = await import('../src/lib/database.js');
    await execute('DELETE FROM invoices WHERE tenant_id = ?', [tenantId]);

    const next = await resyncCounter(tenantId, 'invoice');
    assert.equal(next, 1, 'with no invoices left the counter returns to the configured start');
  });
});
