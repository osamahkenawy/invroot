/**
 * Test fixtures.
 *
 * Every test provisions its own throwaway tenant and deletes it afterwards, so
 * the suite can be run against a development database without touching real
 * data. Nothing here writes to an existing tenant.
 */

import crypto from 'crypto';
import { query, execute } from '../src/lib/database.js';

/** Create an isolated tenant with an owner user. */
export async function makeTenant({ currency = 'AED', numberFormat = 'date', prefix = 'TST' } = {}) {
  const tag = crypto.randomBytes(4).toString('hex');
  const r = await execute(
    `INSERT INTO tenants (company_name, slug, email, status, currency, lang)
     VALUES (?, ?, ?, 'active', ?, 'en')`,
    [`ZZ Test ${tag}`, `zz-test-${tag}`, `zz-${tag}@test.invalid`, currency]
  );
  const tenantId = r.insertId;

  const u = await execute(
    `INSERT INTO users (tenant_id, email, username, full_name, password, role,
                        is_owner, is_active, email_verified)
     VALUES (?, ?, ?, 'ZZ Test Owner', 'x', 'admin', 1, 1, 1)`,
    [tenantId, `zz-${tag}@test.invalid`, `zz-${tag}`]
  );

  await execute(
    `INSERT INTO invoice_numbering (tenant_id, number_format, invoice_prefix, invoice_start)
     VALUES (?, ?, ?, 1)`,
    [tenantId, numberFormat, prefix]
  );

  return { tenantId, userId: u.insertId, tag };
}

export async function makeClient(tenantId, { name = 'ZZ Client', currency = null } = {}) {
  const r = await execute(
    `INSERT INTO clients (tenant_id, name, email, currency, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [tenantId, name, 'zzclient@test.invalid', currency]
  );
  return r.insertId;
}

/** Insert an invoice directly, bypassing routes — used to set up ledger state. */
export async function makeInvoice(tenantId, clientId, {
  number = null, total = 100, status = 'sent',
  issueDate = '2026-01-15', dueDate = '2099-12-31', currency = 'AED',
} = {}) {
  const num = number || `ZZ-${crypto.randomBytes(4).toString('hex')}`;
  const r = await execute(
    `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date,
                           currency, line_items, subtotal, tax_amount, total_amount, paid_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
    [tenantId, clientId, num, status, issueDate, dueDate, currency,
     JSON.stringify([{ description: 'Test line', quantity: 1, unit_price: total, total }]),
     total, total]
  );
  return { id: r.insertId, number: num, total };
}

export async function makePayment(tenantId, invoiceId, clientId, {
  amount = 50, method = 'bank_transfer', date = '2026-02-01',
} = {}) {
  const r = await execute(
    `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, invoiceId, clientId, amount, method, date]
  );
  return r.insertId;
}

/** Remove everything belonging to a test tenant, children first. */
export async function dropTenant(tenantId) {
  const tables = [
    'payments', 'receipts', 'credit_notes', 'invoices', 'invroot_quotes',
    'clients', 'catalog_items', 'invoice_numbering', 'doc_counters',
    'invroot_notifications', 'login_history', 'user_sessions', 'users',
  ];
  for (const t of tables) {
    try { await execute(`DELETE FROM ${t} WHERE tenant_id = ?`, [tenantId]); }
    catch { /* table may not carry tenant_id in every deployment */ }
  }
  try { await execute('DELETE FROM user_sessions WHERE tenant_id = ?', [tenantId]); } catch {}
  await execute('DELETE FROM tenants WHERE id = ?', [tenantId]);
}

/** Safety net: clear any tenants a crashed run left behind. */
export async function dropStaleTestTenants() {
  const rows = await query("SELECT id FROM tenants WHERE company_name LIKE 'ZZ Test %'");
  for (const r of rows) await dropTenant(r.id);
  return rows.length;
}
