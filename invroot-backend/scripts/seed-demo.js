#!/usr/bin/env node
/**
 * Demo data seeder.
 *
 *   node scripts/seed-demo.js            seed the default tenant (1)
 *   node scripts/seed-demo.js --tenant 2 seed a specific tenant
 *   node scripts/seed-demo.js --clean    remove everything this script created
 *
 * Every client it creates is tagged "seed-demo", and all invoices, payments,
 * quotes and credit notes hang off those clients — so --clean can remove the
 * whole set without touching real records.
 *
 * Numbers follow the same PREFIX/MM/YYYY/SEQ scheme as nextDocNumber(), and the
 * sequence continues from the highest existing number, so seeding does not
 * disturb the live counter.
 */
import dotenv from 'dotenv';
dotenv.config();

const { query, execute } = await import('../src/lib/database.js');

const args     = process.argv.slice(2);
const CLEAN    = args.includes('--clean');
const TENANT   = Number(args[args.indexOf('--tenant') + 1]) || 1;
const SEED_TAG = 'seed-demo';

/* ── Deterministic PRNG so repeated runs give a comparable spread ── */
let _s = 20260726;
const rnd    = () => (_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick   = arr => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const money  = v => Math.round(v * 100) / 100;

const DAY = 86400000;
const today = new Date();
const dayOffset = n => new Date(today.getTime() + n * DAY);
const ymd = d => d.toISOString().split('T')[0];
const ymdhms = d => d.toISOString().slice(0, 19).replace('T', ' ');

/* ── Reference data ───────────────────────────────────────────── */
const CLIENTS = [
  ['Al Noor Trading LLC',        'Dubai, UAE',        'accounts@alnoor.example'],
  ['Gulf Horizon Contracting',   'Abu Dhabi, UAE',    'finance@gulfhorizon.example'],
  ['Sadara Tech Solutions',      'Riyadh, KSA',       'ap@sadaratech.example'],
  ['Bright Path Consultancy',    'Dubai, UAE',        'billing@brightpath.example'],
  ['Marina Logistics FZE',       'Sharjah, UAE',      'invoices@marinalog.example'],
  ['Cedar Interiors',            'Dubai, UAE',        'admin@cedarint.example'],
  ['Falcon Medical Supplies',    'Jeddah, KSA',       'accounts@falconmed.example'],
  ['Oasis Hospitality Group',    'Doha, Qatar',       'finance@oasishg.example'],
  ['Delta Engineering Works',    'Dammam, KSA',       'ap@deltaeng.example'],
  ['Nova Digital Agency',        'Dubai, UAE',        'hello@novadigital.example'],
  ['Pearl Facility Management',  'Abu Dhabi, UAE',    'billing@pearlfm.example'],
  ['Summit Legal Advisors',      'Dubai, UAE',        'accounts@summitlegal.example'],
  ['Aurora Retail Group',        'Kuwait City, KW',   'finance@auroraretail.example'],
  ['Silk Route Freight',         'Sharjah, UAE',      'ops@silkroute.example'],
  ['Verde Landscaping',          'Dubai, UAE',        'admin@verdeland.example'],
  ['Atlas Security Services',    'Riyadh, KSA',       'ap@atlassec.example'],
  ['Blue Wave Marine',           'Muscat, Oman',      'accounts@bluewave.example'],
  ['Crescent Food Industries',   'Jeddah, KSA',       'finance@crescentfood.example'],
  ['Vertex Architecture',        'Dubai, UAE',        'billing@vertexarch.example'],
  ['Harbour Print House',        'Abu Dhabi, UAE',    'orders@harbourprint.example'],
  ['Stellar HR Consulting',      'Dubai, UAE',        'accounts@stellarhr.example'],
  ['Quantum IT Services',        'Manama, Bahrain',   'ap@quantumit.example'],
  ['Golden Sands Real Estate',   'Dubai, UAE',        'finance@goldensands.example'],
  ['Meridian Travel Co.',        'Riyadh, KSA',       'billing@meridiantravel.example'],
];

const SERVICES = [
  ['Brand identity design',            2500, 6000],
  ['Website design & build',           6000, 22000],
  ['Monthly retainer — marketing',     3500, 9000],
  ['SEO audit & implementation',       1800, 5200],
  ['Mobile app development sprint',    8000, 26000],
  ['UI/UX consultation (per day)',      900,  2400],
  ['Cloud hosting — annual',            1200,  4800],
  ['IT support contract — quarterly',  2200,  7000],
  ['Content production package',       1500,  4500],
  ['Social media management',          2000,  5500],
  ['Photography & video shoot',        3000,  9500],
  ['Systems integration',              5000, 18000],
  ['Staff training workshop',          1800,  6200],
  ['Annual maintenance contract',      4000, 14000],
  ['Data migration service',           2600,  8800],
  ['Security assessment',              3200, 11000],
];

const PO_PREFIX  = ['PO', 'REQ', 'WO'];
const METHODS    = ['bank_transfer', 'bank_transfer', 'bank_transfer', 'card', 'cash', 'check', 'stripe'];
const CN_REASONS = ['return', 'overpayment', 'discount', 'error', 'goodwill'];

/* ── Cleanup ──────────────────────────────────────────────────── */
async function clean() {
  const clients = await query(
    `SELECT id FROM clients WHERE tenant_id = ? AND JSON_CONTAINS(tags, ?)`,
    [TENANT, JSON.stringify(SEED_TAG)]
  );
  if (!clients.length) { console.log('Nothing to clean — no seed-demo clients found.'); return; }
  const ids = clients.map(c => c.id);
  const list = ids.join(',');

  const inv = await query(`SELECT id FROM invoices WHERE tenant_id = ? AND client_id IN (${list})`, [TENANT]);
  const invList = inv.map(i => i.id).join(',') || '0';

  await execute(`DELETE FROM payments      WHERE tenant_id = ? AND invoice_id IN (${invList})`, [TENANT]);
  await execute(`DELETE FROM credit_notes  WHERE tenant_id = ? AND client_id  IN (${list})`, [TENANT]);
  await execute(`DELETE FROM invroot_quotes WHERE tenant_id = ? AND client_id IN (${list})`, [TENANT]);
  await execute(`DELETE FROM invoices      WHERE tenant_id = ? AND client_id  IN (${list})`, [TENANT]);
  await execute(`DELETE FROM clients       WHERE tenant_id = ? AND id         IN (${list})`, [TENANT]);

  console.log(`Removed ${inv.length} invoices and ${ids.length} demo clients (plus their payments, quotes and credit notes).`);
}

/* ── Numbering that continues from whatever already exists ────── */
async function seqStart(table, col) {
  const [row] = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(${col}, '/', -1) AS UNSIGNED)), 0) AS m
     FROM ${table} WHERE tenant_id = ?`, [TENANT]);
  return Number(row.m) + 1;
}
const docNumber = (prefix, date, seq) =>
  `${prefix}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}/${seq}`;

/* ── Seed ─────────────────────────────────────────────────────── */
async function seed() {
  const [tenant] = await query('SELECT currency, lang FROM tenants WHERE id = ?', [TENANT]);
  if (!tenant) { console.error(`Tenant ${TENANT} not found.`); process.exit(1); }
  const CUR = tenant.currency || 'AED';

  console.log(`Seeding tenant ${TENANT} (${CUR})…\n`);

  /* Clients */
  const clientIds = [];
  for (const [name, addr, email] of CLIENTS) {
    const r = await execute(
      `INSERT INTO clients (tenant_id, name, company_name, email, phone, billing_address,
                            currency, payment_terms, credit_limit, credit_balance,
                            preferred_language, tags, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'en', ?, 'active')`,
      [TENANT, name, name, email,
       `+9715${intBetween(10, 59)}${intBetween(100000, 999999)}`,
       addr, CUR, pick([0, 14, 30, 30, 45, 60]), pick([0, 25000, 50000, 100000]),
       JSON.stringify([SEED_TAG, pick(['retainer', 'project', 'enterprise', 'smb'])])]
    );
    clientIds.push(r.insertId);
  }
  console.log(`  ${clientIds.length} clients`);

  /* Invoices — spread over the last 14 months */
  let invSeq = await seqStart('invoices', 'invoice_number');
  const invoices = [];
  const TARGET = 140;

  for (let i = 0; i < TARGET; i++) {
    const clientId = pick(clientIds);
    // Weight recent months more heavily, but reach back far enough that the
    // aging buckets and month-over-month reports have something to show.
    const ageDays  = Math.floor(Math.pow(rnd(), 1.7) * 420);
    const issue    = dayOffset(-ageDays);
    const terms    = pick([0, 14, 30, 30, 45, 60]);
    const due      = new Date(issue.getTime() + terms * DAY);
    const overdueBy = Math.floor((today - due) / DAY);

    /* Line items */
    const lines = [];
    const n = intBetween(1, 4);
    for (let k = 0; k < n; k++) {
      const [desc, lo, hi] = pick(SERVICES);
      const qty   = pick([1, 1, 1, 2, 3]);
      const price = money(between(lo, hi) / (qty > 1 ? qty : 1));
      const tax   = pick([0, 5, 5, 15]);
      lines.push({ description: desc, quantity: qty, unit_price: price, tax_rate: tax, total: money(qty * price) });
    }
    const subtotal = money(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0));
    const taxAmt   = money(lines.reduce((s, l) => s + l.quantity * l.unit_price * l.tax_rate / 100, 0));

    const hasDiscount  = rnd() < 0.22;
    const discountType = hasDiscount ? pick(['percent', 'fixed']) : null;
    const discountVal  = !hasDiscount ? 0
      : discountType === 'percent' ? pick([5, 10, 12.5]) : money(between(100, Math.max(200, subtotal * 0.15)));
    const discountAmt  = !hasDiscount ? 0
      : discountType === 'percent' ? money(subtotal * discountVal / 100) : Math.min(discountVal, subtotal);
    const total = money(Math.max(0, subtotal + taxAmt - discountAmt));

    /* Status — realistic mix, and never contradicting the dates.
       A 'sent' invoice past its due date would be auto-flipped to overdue by
       the invoices route, so past-due ones are seeded as overdue outright. */
    let status, paid = 0;
    const roll = rnd();
    if (roll < 0.06)      status = 'draft';
    else if (roll < 0.09) status = 'void';
    else if (overdueBy > 0) {
      // Past due: mostly settled, the rest genuinely outstanding.
      const r2 = rnd();
      if (r2 < 0.55)      { status = 'paid';    paid = total; }
      else if (r2 < 0.72) { status = 'partial'; paid = money(total * between(0.2, 0.7)); }
      else                { status = 'overdue'; paid = 0; }
    } else {
      const r2 = rnd();
      if (r2 < 0.30)      { status = 'paid';    paid = total; }
      else if (r2 < 0.44) { status = 'partial'; paid = money(total * between(0.2, 0.7)); }
      else if (r2 < 0.72) { status = 'sent';    paid = 0; }
      else                { status = 'viewed';  paid = 0; }
    }
    if (status === 'draft' || status === 'void') paid = 0;

    const number = docNumber('INV', issue, invSeq++);
    const sentAt   = ['draft'].includes(status) ? null : ymdhms(issue);
    const viewedAt = ['draft', 'void', 'sent'].includes(status) ? null : ymdhms(dayOffset(-ageDays + 1));
    const paidAt   = status === 'paid' ? ymdhms(dayOffset(-Math.max(0, ageDays - intBetween(2, Math.max(3, terms))))) : null;

    const r = await execute(
      `INSERT INTO invoices
         (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
          line_items, subtotal, discount_type, discount_value, discount_amount,
          tax_amount, total_amount, paid_amount, notes, payment_terms, po_number, lang,
          relation_type, sent_at, viewed_at, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', 'original', ?, ?, ?, ?)`,
      [TENANT, clientId, number, status, ymd(issue), ymd(due), CUR,
       JSON.stringify(lines), subtotal, discountType, discountVal, discountAmt,
       taxAmt, total, paid,
       pick([null, 'Thank you for your business.', 'Payment due within terms.', null]),
       terms,
       rnd() < 0.4 ? `${pick(PO_PREFIX)}-${intBetween(1000, 9999)}` : null,
       sentAt, viewedAt, paidAt, ymdhms(issue)]
    );
    invoices.push({ id: r.insertId, clientId, total, paid, status, issue, currency: CUR });
  }
  console.log(`  ${invoices.length} invoices`);

  /* Payments — must sum to each invoice's paid_amount */
  let payCount = 0;
  for (const inv of invoices) {
    if (inv.paid <= 0) continue;
    const parts = inv.status === 'paid' && rnd() < 0.25 ? 2 : 1;   // some settled in instalments
    let remaining = inv.paid;
    for (let p = 0; p < parts; p++) {
      const amount = p === parts - 1 ? money(remaining) : money(inv.paid * between(0.3, 0.6));
      remaining = money(remaining - amount);
      if (amount <= 0) continue;
      await execute(
        `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date, reference, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [TENANT, inv.id, inv.clientId, amount, pick(METHODS),
         ymd(dayOffset(-intBetween(0, 20) + Math.floor((inv.issue - today) / DAY) + intBetween(1, 25))),
         `TRX-${intBetween(100000, 999999)}`,
         ymdhms(inv.issue)]
      );
      payCount++;
    }
  }
  console.log(`  ${payCount} payments`);

  /* Quotes */
  let qSeq = await seqStart('invroot_quotes', 'quote_number');
  let qCount = 0;
  for (let i = 0; i < 40; i++) {
    const clientId = pick(clientIds);
    const created  = dayOffset(-Math.floor(Math.pow(rnd(), 1.5) * 300));
    const validity = new Date(created.getTime() + pick([14, 30, 30, 45]) * DAY);

    const lines = [];
    for (let k = 0, n = intBetween(1, 3); k < n; k++) {
      const [desc, lo, hi] = pick(SERVICES);
      const qty = pick([1, 1, 2]);
      const price = money(between(lo, hi) / (qty > 1 ? qty : 1));
      const tax = pick([0, 5, 15]);
      lines.push({ description: desc, quantity: qty, unit_price: price, tax_rate: tax, total: money(qty * price) });
    }
    const subtotal = money(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0));
    const taxAmt   = money(lines.reduce((s, l) => s + l.quantity * l.unit_price * l.tax_rate / 100, 0));
    const total    = money(subtotal + taxAmt);

    const expired = validity < today;
    const roll = rnd();
    let status;
    if (roll < 0.12)      status = 'draft';
    else if (roll < 0.34) status = 'sent';
    else if (roll < 0.55) status = 'accepted';
    else if (roll < 0.70) status = 'rejected';
    else if (roll < 0.85) status = 'converted';
    else                  status = expired ? 'expired' : 'sent';
    if (expired && ['sent', 'draft'].includes(status)) status = 'expired';

    await execute(
      `INSERT INTO invroot_quotes
         (tenant_id, client_id, quote_number, status, valid_until, currency, line_items,
          subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
          notes, lang, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fixed', 0, 0, ?, ?, ?, 'en', ?, ?)`,
      [TENANT, clientId, docNumber('QUO', created, qSeq++), status, ymd(validity), CUR,
       JSON.stringify(lines), subtotal, taxAmt, total,
       pick([null, 'Valid for the period stated above.', null]),
       status === 'draft' ? null : ymdhms(created), ymdhms(created)]
    );
    qCount++;
  }
  console.log(`  ${qCount} quotes`);

  /* Credit notes — only against non-draft/void invoices, never exceeding the
     invoice total, matching the rules the API now enforces. */
  let cnSeq = await seqStart('credit_notes', 'cn_number');
  const creditable = invoices.filter(i => !['draft', 'void'].includes(i.status));
  let cnCount = 0;
  const usedInvoices = new Set();
  for (let i = 0; i < 14 && i < creditable.length; i++) {
    const inv = creditable[intBetween(0, creditable.length - 1)];
    if (usedInvoices.has(inv.id)) continue;   // one note per invoice keeps the caps simple
    const status = pick(['issued', 'issued', 'applied', 'voided']);
    // An APPLIED note counts toward paid_amount, so it must fit in what is
    // still outstanding or the invoice ends up paid beyond its total. Issued
    // and voided notes don't touch the invoice, so they may use the full total.
    const headroom = status === 'applied'
      ? Math.max(0, inv.total - inv.paid)
      : inv.total;
    const amount = money(Math.min(inv.total * between(0.05, 0.3), headroom));
    if (amount <= 0.01) continue;
    usedInvoices.add(inv.id);
    const when   = dayOffset(-intBetween(1, 90));
    await execute(
      `INSERT INTO credit_notes
         (tenant_id, invoice_id, client_id, cn_number, amount, currency, reason, reason_code,
          status, created_at, applied_at, voided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [TENANT, inv.id, inv.clientId, docNumber('CN', when, cnSeq++), amount, inv.currency,
       pick([null, 'Agreed with client', 'Partial return']), pick(CN_REASONS), status,
       ymdhms(when),
       status === 'applied' ? ymdhms(when) : null,
       status === 'voided'  ? ymdhms(when) : null]
    );
    if (status === 'issued') {
      await execute('UPDATE clients SET credit_balance = COALESCE(credit_balance,0) + ? WHERE id = ?', [amount, inv.clientId]);
    }
    cnCount++;
  }
  console.log(`  ${cnCount} credit notes`);

  /* Applied credit notes count toward the invoice, so bring those invoices'
     paid_amount and status back in line with the shared recalc rule. */
  const { recalcInvoice } = await import('../src/lib/invoice-totals.js');
  const touched = await query(
    `SELECT DISTINCT invoice_id FROM credit_notes WHERE tenant_id = ? AND status = 'applied'`, [TENANT]);
  for (const t of touched) await recalcInvoice(t.invoice_id);
  console.log(`  recalculated ${touched.length} invoices carrying applied credit`);

  console.log('\nDone. Run with --clean to remove it all.');
}

try {
  await (CLEAN ? clean() : seed());
  process.exit(0);
} catch (err) {
  console.error('Seeder failed:', err.message);
  process.exit(1);
}
