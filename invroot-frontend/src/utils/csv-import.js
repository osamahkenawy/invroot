/**
 * CSV → invoice import rows.
 *
 * Separate from csv.js, which writes CSV for reports. Reading someone else's
 * export is a different problem: the columns are named whatever the previous
 * system called them, and the numbers arrive as "AED 1,234.50".
 *
 * Hand-written rather than a dependency because the parsing is small and the
 * column mapping — the part that actually decides whether an import is right —
 * has to be readable.
 */

/** Split CSV text into rows of raw string cells. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');   // Excel's BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" is a literal quote
        else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ',')  { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  /* A trailing newline makes one empty row, and so does a blank line someone
     left mid-file. Neither is an invoice. */
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/* Column aliases — people export from different systems and rename things. */
const ALIASES = {
  invoice_number: ['invoice_number', 'invoice no', 'invoice #', 'invoice', 'number', 'ref', 'reference'],
  client_name:    ['client_name', 'client', 'customer', 'customer name', 'account', 'bill to'],
  client_email:   ['client_email', 'email', 'customer email'],
  client_id:      ['client_id'],
  issue_date:     ['issue_date', 'date', 'invoice date', 'issued'],
  due_date:       ['due_date', 'due', 'due date'],
  currency:       ['currency', 'ccy'],
  status:         ['status', 'state'],
  description:    ['description', 'item', 'details', 'particulars', 'line'],
  quantity:       ['quantity', 'qty'],
  unit_price:     ['unit_price', 'rate', 'price', 'unit price'],
  tax_rate:       ['tax_rate', 'vat', 'vat %', 'tax %', 'tax rate'],
  subtotal:       ['subtotal', 'net', 'net amount'],
  tax_amount:     ['tax_amount', 'vat amount', 'tax'],
  discount_amount:['discount_amount', 'discount'],
  total_amount:   ['total_amount', 'total', 'gross', 'amount', 'grand total'],
  paid_amount:    ['paid_amount', 'paid', 'amount paid'],
  po_number:      ['po_number', 'po', 'po #', 'purchase order'],
  notes:          ['notes', 'note', 'memo', 'remarks'],
  payment_amount: ['payment_amount', 'payment'],
  payment_date:   ['payment_date', 'paid on', 'payment date'],
  payment_method: ['payment_method', 'method', 'paid by'],
  payment_reference: ['payment_reference', 'payment ref', 'transaction ref'],
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

function mapHeaders(header) {
  const map = {};
  header.forEach((raw, i) => {
    const h = norm(raw);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (map[field] === undefined && names.some(n => norm(n) === h)) { map[field] = i; break; }
    }
  });
  return map;
}

const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  /* Strip thousands separators and currency symbols — exports are full of
     "AED 1,234.50". A comma used as the DECIMAL separator is deliberately not
     guessed: "1,50" is 1.5 in Europe and 150 elsewhere, and choosing wrong
     would be a hundredfold error on every row of the file. */
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Turn parsed CSV into the shape POST /api/invoices/import takes.
 *
 * Rows sharing an invoice_number merge into ONE invoice with several line
 * items — that is how most systems export a multi-line invoice. Treating them
 * as separate invoices would duplicate the number and split the total.
 */
export function csvToInvoices(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { invoices: [], error: 'The file needs a header row and at least one invoice.' };
  }

  const map = mapHeaders(rows[0]);
  if (map.invoice_number === undefined) {
    return {
      invoices: [],
      error: 'No invoice number column found. Add one called "invoice_number" — it is the number your customer already has.',
    };
  }

  const get = (row, field) => (map[field] === undefined ? undefined : String(row[map[field]] ?? '').trim());

  const byNumber = new Map();
  const order = [];

  for (const row of rows.slice(1)) {
    const number = get(row, 'invoice_number');
    if (!number) continue;

    if (!byNumber.has(number)) {
      order.push(number);
      byNumber.set(number, {
        invoice_number: number,
        client_id:    num(get(row, 'client_id')),
        client_name:  get(row, 'client_name') || undefined,
        client_email: get(row, 'client_email') || undefined,
        issue_date:   get(row, 'issue_date') || undefined,
        due_date:     get(row, 'due_date') || undefined,
        currency:     get(row, 'currency') || undefined,
        status:       (get(row, 'status') || '').toLowerCase() || undefined,
        subtotal:        num(get(row, 'subtotal')),
        tax_amount:      num(get(row, 'tax_amount')),
        discount_amount: num(get(row, 'discount_amount')),
        total_amount:    num(get(row, 'total_amount')),
        paid_amount:     num(get(row, 'paid_amount')),
        po_number:    get(row, 'po_number') || undefined,
        notes:        get(row, 'notes') || undefined,
        description:  get(row, 'description') || undefined,
        line_items: [],
        payments: [],
      });
    }

    const inv = byNumber.get(number);

    /* A line counts only if it has a description AND a price of its own.
       Otherwise a single-row invoice whose "description" is really a summary
       becomes a line item priced at zero, and the totals stop agreeing with
       the invoice the customer holds. */
    const desc = get(row, 'description');
    const price = num(get(row, 'unit_price'));
    if (desc && price !== undefined) {
      inv.line_items.push({
        description: desc,
        quantity: num(get(row, 'quantity')) ?? 1,
        unit_price: price,
        tax_rate: num(get(row, 'tax_rate')) ?? 0,
      });
    }

    const payAmt = num(get(row, 'payment_amount'));
    if (payAmt !== undefined && payAmt > 0) {
      inv.payments.push({
        amount: payAmt,
        payment_date: get(row, 'payment_date') || undefined,
        method: (get(row, 'payment_method') || 'bank_transfer').toLowerCase().replace(/\s+/g, '_'),
        reference: get(row, 'payment_reference') || undefined,
      });
    }
  }

  const invoices = order.map(n => {
    const inv = byNumber.get(n);
    if (!inv.line_items.length) delete inv.line_items;
    if (!inv.payments.length) delete inv.payments;
    return inv;
  });

  return { invoices, error: null };
}

/** The template, so nobody has to guess column names. */
export const CSV_TEMPLATE = [
  'invoice_number,client_name,client_email,issue_date,due_date,currency,status,description,quantity,unit_price,tax_rate,total_amount,payment_amount,payment_date,payment_method,payment_reference,po_number,notes',
  '2024-001,Acme Trading LLC,accounts@acme.example,2024-03-11,2024-04-10,AED,paid,Retainer — March,1,10000,5,10500,10500,2024-04-02,bank_transfer,FT24040201,PO-8891,',
  '2024-002,Blue Wave Marine,ops@bluewave.example,2024-05-01,2024-05-31,AED,partial,Consulting,20,500,0,10000,4000,2024-06-15,cash,,,Part paid on site',
  '2024-003,Acme Trading LLC,accounts@acme.example,2024-09-09,2024-10-09,AED,sent,Website maintenance 2024,1,2750.5,0,2750.5,,,,,,',
].join('\n');
