import puppeteer from 'puppeteer';
import { config } from '../config.js';

/**
 * Generate a PDF buffer from HTML string using Puppeteer.
 */
export async function htmlToPdf(html, options = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      margin: options.margin || { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

/** Only allow plain hex colours into the stylesheet. */
function sanitizeColor(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test((value || '').trim()) ? value.trim() : null;
}

/* ── Colour helpers ───────────────────────────────────────
   Tenants pick arbitrary brand colours, so anything painted on top of one has
   to derive its contrast rather than assume a light or dark background. */
function hexToRgb(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);          // drop alpha
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Relative luminance (WCAG) — decides whether text on this colour is dark or light. */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Legible foreground for a filled band — white on dark brands, ink on pale ones. */
function readableOn(hex) {
  return luminance(hex) > 0.45 ? '#1a1a1a' : '#ffffff';
}

/** Blend toward white; used for subtle fills so pale brands don't wash out. */
function tint(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = c => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * Build the HTML for an invoice and return the PDF buffer.
 */
export async function generateInvoicePdf(invoice, tenant, lang = 'en', docType = 'invoice') {
  const isRTL = lang === 'ar';
  const dir = isRTL ? 'rtl' : 'ltr';
  const docTitle = docType === 'quote'
    ? (isRTL ? 'عرض سعر' : 'QUOTATION')
    : (isRTL ? 'فاتورة' : 'INVOICE');

  // Honour the tenant's Branding settings; fall back to the product palette.
  const accent  = sanitizeColor(tenant.accent_color)  || '#8A6D1F';
  const primary = sanitizeColor(tenant.primary_color) || '#0D1B2A';
  const template = ['classic', 'modern', 'minimal'].includes(tenant.invoice_template)
    ? tenant.invoice_template
    : 'classic';

  const onPrimary   = readableOn(primary);
  // A pale brand colour is fine as a fill but unreadable as text on white,
  // so small labels fall back to neutral grey rather than tinting illegibly.
  const primaryInk  = luminance(primary) > 0.55 ? '#777' : primary;
  const primarySoft = tint(primary, 0.90);   // table header / meta fills
  const isModern    = template === 'modern';
  const isMinimal   = template === 'minimal';

  // Per-template chrome. Classic keeps the familiar look, Modern paints a full
  // brand band, Minimal strips fills back to hairlines.
  const tpl = {
    classic: {
      headerCss:   `padding-bottom:16px; border-bottom:3px solid ${primary};`,
      titleColor:  primaryInk,
      thBg:        primarySoft,
      thColor:     primary,
      rowBorder:   '#eee',
      footerRule:  `2px solid ${accent}`,
    },
    modern: {
      headerCss:   `background:${primary}; color:${onPrimary}; padding:24px 28px; margin:-30px -30px 26px; border-bottom:5px solid ${accent};`,
      titleColor:  onPrimary,
      thBg:        primary,
      thColor:     onPrimary,
      rowBorder:   '#e8e8e8',
      footerRule:  `2px solid ${accent}`,
    },
    minimal: {
      headerCss:   `padding-bottom:14px; border-bottom:1px solid #e5e5e5;`,
      titleColor:  primaryInk,
      thBg:        'transparent',
      thColor:     '#777',
      rowBorder:   '#f0f0f0',
      footerRule:  '1px solid #e5e5e5',
    },
  }[template];

  const lineItemsHtml = (invoice.line_items || []).map(item => `
    <tr>
      <td>${item.description}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">${formatAmount(item.unit_price, invoice.currency)}</td>
      <td style="text-align:right">${item.tax_rate || 0}%</td>
      <td style="text-align:right">${formatAmount(item.total, invoice.currency)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html dir="${dir}" lang="${lang}">
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 13px; color: #333; direction: ${dir}; }
        .invoice-wrapper { max-width: 800px; margin: 0 auto; padding: 30px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; ${tpl.headerCss} }
        .company-logo img { max-height: 60px; }
        /* Modern paints a dark brand band; a dark tenant logo would vanish on
           it, so give the mark its own light plate. */
        ${isModern ? '.company-logo { background:#fff; color:#1a1a1a; padding:8px 12px; border-radius:6px; display:inline-block; }' : ''}
        .invoice-title { font-size: 28px; font-weight: bold; color: ${tpl.titleColor}; }
        .invoice-number { ${isModern ? `color:${onPrimary}; opacity:.85;` : 'color:#666;'} }
        .invoice-meta { margin-bottom: 20px; }
        .invoice-meta table { width: 100%; }
        .invoice-meta td { padding: 4px 8px; }
        .parties { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .party h4 { font-size: 11px; text-transform: uppercase; color: ${isMinimal ? '#888' : primaryInk}; margin-bottom: 6px; letter-spacing: .04em; }
        table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        table.items th {
          background: ${tpl.thBg}; color: ${tpl.thColor};
          padding: 9px 8px; text-align: ${isRTL ? 'right' : 'left'}; font-size: 12px;
          ${isMinimal ? `border-bottom:2px solid ${primary};` : ''}
        }
        table.items td { padding: 8px; border-bottom: 1px solid ${tpl.rowBorder}; }
        .totals { ${isRTL ? 'text-align:left' : 'text-align:right'}; }
        .totals table { display: inline-block; }
        .totals td { padding: 4px 8px; }
        .totals .grand-total { font-weight: bold; font-size: 16px; color: ${accent}; }
        .notes { margin-top: 20px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 10px; }
        /* Bank details as a field grid, not a sentence. Each value sits under
           its own label so the customer can copy an IBAN without picking it
           out of a paragraph, and auto-fit keeps a tenant who fills in three
           fields from getting six columns of whitespace. */
        .pay { margin-top: 20px; border-top: 1px solid #eee; padding-top: 12px; }
        .pay-title {
          font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
          color: #aaa; margin-bottom: 8px;
        }
        .pay-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px 24px;
        }
        .pay-k { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #999; }
        /* Account numbers and IBANs are read a character at a time and are the
           one thing on the page nobody may misread, so they get a mono face and
           are allowed to break rather than overflow their column. */
        .pay-v {
          font-size: 11.5px; color: #333; font-weight: 600; margin-top: 1px;
          font-family: 'DejaVu Sans Mono', Menlo, Consolas, monospace;
          word-break: break-all; direction: ltr; unicode-bidi: embed;
        }
        .pay-v.is-text { font-family: inherit; word-break: normal; }
        .stamp-area { display: flex; justify-content: flex-end; align-items: flex-end; margin-top: 36px; gap: 40px; padding-top: 20px; border-top: 1px solid #eee; }
        .stamp-box { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .stamp-box .stamp-label { font-size: 10px; text-transform: uppercase; color: #aaa; letter-spacing: .08em; }
        .stamp-box img { max-height: 90px; max-width: 160px; object-fit: contain; opacity: 0.92; }
        .stamp-box .stamp-signatory { font-size: 12px; font-weight: 600; color: #444; margin-top: 2px; }
        .stamp-box .stamp-title { font-size: 11px; color: #888; }
        .footer { margin-top: 30px; border-top: ${tpl.footerRule}; padding-top: 10px; font-size: 11px; color: #888; text-align: center; }
      </style>
    </head>
    <body>
      <div class="invoice-wrapper">
        <div class="header">
          <div class="company-logo">
            ${tenant.logo_url ? `<img src="${tenant.logo_url}" alt="logo">` : `<strong>${tenant.company_name}</strong>`}
          </div>
          <div>
            <div class="invoice-title">${docTitle}</div>
            <div class="invoice-number">#${invoice.invoice_number}</div>
          </div>
        </div>

        <div class="parties">
          <div class="party">
            <h4>${isRTL ? 'من' : 'From'}</h4>
            <div><strong>${tenant.company_name}</strong></div>
            <div>${tenant.address || ''}</div>
            <div>${tenant.tax_id ? (isRTL ? `الرقم الضريبي: ${tenant.tax_id}` : `Tax ID: ${tenant.tax_id}`) : ''}</div>
          </div>
          <div class="party">
            <h4>${isRTL ? 'إلى' : 'Bill To'}</h4>
            <div><strong>${invoice.client_name}</strong></div>
            <div>${invoice.client_address || ''}</div>
            <div>${invoice.client_email || ''}</div>
          </div>
        </div>

        <div class="invoice-meta">
          <table>
            <tr>
              <td><strong>${isRTL ? 'تاريخ الإصدار' : 'Issue Date'}</strong></td>
              <td>${invoice.issue_date}</td>
              <td><strong>${isRTL ? 'تاريخ الاستحقاق' : 'Due Date'}</strong></td>
              <td>${invoice.due_date}</td>
            </tr>
            ${invoice.po_number ? `<tr>
              <td><strong>${isRTL ? 'رقم أمر الشراء' : 'PO Number'}</strong></td>
              <td colspan="3">${invoice.po_number}</td>
            </tr>` : ''}
            ${invoice.memo ? `<tr>
              <td colspan="4" style="font-style:italic;color:#666;font-size:12px;padding-top:8px">${invoice.memo}</td>
            </tr>` : ''}
          </table>
        </div>

        <table class="items">
          <thead>
            <tr>
              <th>${isRTL ? 'الوصف' : 'Description'}</th>
              <th style="text-align:center">${isRTL ? 'الكمية' : 'Qty'}</th>
              <th style="text-align:right">${isRTL ? 'سعر الوحدة' : 'Unit Price'}</th>
              <th style="text-align:right">${isRTL ? 'الضريبة' : 'Tax'}</th>
              <th style="text-align:right">${isRTL ? 'الإجمالي' : 'Total'}</th>
            </tr>
          </thead>
          <tbody>${lineItemsHtml}</tbody>
        </table>

        <div class="totals">
          <table>
            <tr><td>${isRTL ? 'المجموع الفرعي' : 'Subtotal'}</td><td>${formatAmount(invoice.subtotal, invoice.currency)}</td></tr>
            ${Number(invoice.discount_amount) > 0 ? `<tr><td>${isRTL ? 'الخصم' : 'Discount'}</td><td>-${formatAmount(invoice.discount_amount, invoice.currency)}</td></tr>` : ''}
            <tr><td>${isRTL ? 'الضريبة' : 'Tax'}</td><td>${formatAmount(invoice.tax_amount, invoice.currency)}</td></tr>
            <tr class="grand-total"><td>${isRTL ? 'الإجمالي' : 'Total'}</td><td>${formatAmount(invoice.total_amount, invoice.currency)}</td></tr>
          </table>
        </div>

        ${invoice.notes ? `<div class="notes"><strong>${isRTL ? 'ملاحظات' : 'Notes'}:</strong> ${invoice.notes}</div>` : ''}
        ${paymentBlockHtml(tenant.bank, isRTL, invoice.currency)}

        ${(tenant.stamp_url || tenant.signature_url) ? `
        <div class="stamp-area">
          ${tenant.signature_url ? `
          <div class="stamp-box">
            <img src="${tenant.signature_url}" alt="signature" />
            ${tenant.signatory_name ? `<div class="stamp-signatory">${tenant.signatory_name}</div>` : ''}
            ${tenant.signatory_title ? `<div class="stamp-title">${tenant.signatory_title}</div>` : ''}
            <div class="stamp-label">${isRTL ? 'التوقيع المعتمد' : 'Authorized Signature'}</div>
          </div>` : ''}
          ${tenant.stamp_url ? `
          <div class="stamp-box">
            <img src="${tenant.stamp_url}" alt="stamp" />
            <div class="stamp-label">${isRTL ? 'الختم الرسمي' : 'Official Stamp'}</div>
          </div>` : ''}
        </div>` : ''}

        <!-- One footer, at the foot of the page. invoice.footer_text used to
             ALSO render as a notes block above the signature area, and since it
             is copied from the tenant default at creation, both slots printed
             the same sentence on every invoice. The per-invoice text still
             wins over the tenant default; it just wins in one place. -->
        <div class="footer">${invoice.footer_text || tenant.footer_text || (isRTL ? 'شكراً لتعاملكم معنا' : 'Thank you for your business')}</div>
      </div>
    </body>
    </html>
  `;

  return htmlToPdf(html);
}

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * "Where to send the money", as labelled fields rather than a paragraph.
 *
 * Tenants used to type this into the invoice Notes box, which meant it printed
 * as one wrapped run of text — "AccountNumber: … Bank Name: … BIC Code: …
 * IBAN: …" — and a customer had to pick a 23-character IBAN out of the middle
 * of a sentence. Now each value is its own field with its own label.
 *
 * Only fields the tenant filled in are rendered. The set is deliberately
 * country-neutral: IBAN and SWIFT cover Europe, the Gulf and most of Asia,
 * while `routing_code` carries whatever the local equivalent is (US routing
 * number, UK sort code, Indian IFSC, Australian BSB) under one generic label,
 * because hardcoding six country-specific rows would leave five of them blank
 * on every invoice.
 */
function paymentBlockHtml(bank, isRTL, invoiceCurrency) {
  if (!bank) return '';

  const fields = [
    ['account_holder', isRTL ? 'اسم الحساب' : 'Account Name', true],
    ['bank_name',      isRTL ? 'البنك' : 'Bank', true],
    ['branch',         isRTL ? 'الفرع' : 'Branch', true],
    ['account_number', isRTL ? 'رقم الحساب' : 'Account Number', false],
    ['iban',           isRTL ? 'الآيبان' : 'IBAN', false],
    ['swift',          isRTL ? 'سويفت / BIC' : 'SWIFT / BIC', false],
    ['routing_code',   isRTL ? 'رمز التوجيه' : 'Routing / Sort Code', false],
  ];

  const cells = fields
    .filter(([key]) => bank[key])
    .map(([key, label, isText]) => `
      <div>
        <div class="pay-k">${label}</div>
        <div class="pay-v${isText ? ' is-text' : ''}">${esc(bank[key])}</div>
      </div>`);

  /* Only worth saying when it differs — an invoice in one currency paid into
     an account held in another is a conversion the customer needs to expect. */
  if (bank.bank_currency && invoiceCurrency && bank.bank_currency !== invoiceCurrency) {
    cells.push(`
      <div>
        <div class="pay-k">${isRTL ? 'عملة الحساب' : 'Account Currency'}</div>
        <div class="pay-v is-text">${esc(bank.bank_currency)}</div>
      </div>`);
  }

  if (!cells.length) return '';

  return `
    <div class="pay">
      <div class="pay-title">${isRTL ? 'تفاصيل الدفع' : 'Payment Details'}</div>
      <div class="pay-grid">${cells.join('')}</div>
    </div>`;
}

function formatAmount(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0);
}

const METHOD_LABELS = {
  en: { cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card', check: 'Check', stripe: 'Stripe', paypal: 'PayPal', other: 'Other' },
  ar: { cash: 'نقداً', bank_transfer: 'تحويل بنكي', card: 'بطاقة', check: 'شيك', stripe: 'سترايب', paypal: 'باي بال', other: 'أخرى' },
};

/**
 * Build the HTML for a payment receipt and return the PDF buffer.
 */
export async function generateReceiptPdf(receipt, tenant, lang = 'en') {
  const isRTL = lang === 'ar';
  const dir = isRTL ? 'rtl' : 'ltr';
  const methodLabel = (METHOD_LABELS[isRTL ? 'ar' : 'en'] || METHOD_LABELS.en)[receipt.method] || receipt.method;

  const html = `
    <!DOCTYPE html>
    <html dir="${dir}" lang="${lang}">
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 13px; color: #333; direction: ${dir}; }
        .wrap { max-width: 720px; margin: 0 auto; padding: 40px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
        .company-logo img { max-height: 60px; }
        .doc-title { font-size: 30px; font-weight: bold; color: #244066; letter-spacing: 1px; }
        /* Rubber stamp — a rotated double-ruled box in translucent ink, laid
           over the amount so it reads as struck onto the paper rather than
           drawn as UI. */
        /* Reserve space under the detail rows so the stamp lands on clear
           paper — a stamp over the invoice number looks authentic but makes
           the receipt harder to actually read. */
        .stamp-anchor { position: relative; padding-bottom: 74px; }
        .paid-stamp {
          position: absolute;
          bottom: 2px;
          ${isRTL ? 'left: 30px' : 'right: 30px'};
          transform: rotate(${isRTL ? '12' : '-12'}deg);
          padding: 9px 22px 7px;
          border: 3px solid #15803d;
          border-radius: 8px;
          color: #15803d;
          font-size: 27px;
          font-weight: 900;
          /* Latin gets the wide stamped tracking; Arabic must not — spacing
             breaks the cursive joins and renders م د ف و ع instead of مدفوع. */
          letter-spacing: ${isRTL ? '0' : '7px'};
          text-indent: ${isRTL ? '0' : '7px'};   /* balance the trailing space */
          text-transform: uppercase;
          line-height: 1;
          opacity: 0.72;                 /* ink soaking into the page */
          white-space: nowrap;
          z-index: 2;
        }
        /* Inner rule — the classic double-ring stamp edge. */
        .paid-stamp::before {
          content: '';
          position: absolute;
          inset: 3px;
          border: 1px solid #15803d;
          border-radius: 5px;
        }
        .paid-stamp .stamp-sub {
          display: block;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 2px;   /* the sub-line is always digits, safe in both */
          text-indent: 2px;
          margin-top: 5px;
          opacity: .95;
        }
        .amount-box { text-align: center; background: linear-gradient(135deg, #244066, #3a5a8a); color: #fff;
          border-radius: 12px; padding: 28px; margin: 24px 0; }
        .amount-box .label { font-size: 12px; text-transform: uppercase; opacity: 0.8; letter-spacing: 1px; }
        .amount-box .value { font-size: 34px; font-weight: bold; margin-top: 6px; }
        .meta { width: 100%; border-collapse: collapse; margin-top: 12px; }
        .meta td { padding: 10px 8px; border-bottom: 1px solid #eee; }
        .meta td:first-child { color: #888; width: 40%; }
        .meta td:last-child { font-weight: 600; text-align: ${isRTL ? 'left' : 'right'}; }
        .parties { display: flex; justify-content: space-between; margin: 24px 0; }
        .party h4 { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
        .footer { margin-top: 30px; border-top: 2px solid #244066; padding-top: 10px; font-size: 11px; color: #888; text-align: center; }
        .receipt-stamp-area { display: flex; justify-content: flex-end; align-items: flex-end; gap: 40px; margin-top: 36px; padding-top: 20px; border-top: 1px solid #eee; }
        .receipt-stamp-box { display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .receipt-stamp-box img { max-height: 80px; max-width: 140px; object-fit: contain; opacity: 0.92; }
        .receipt-stamp-label { font-size: 10px; text-transform: uppercase; color: #aaa; letter-spacing: .08em; }
        .receipt-stamp-signatory { font-size: 12px; font-weight: 600; color: #444; }
        .receipt-stamp-title-txt { font-size: 11px; color: #888; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="header">
          <div class="company-logo">
            ${tenant.logo_url ? `<img src="${tenant.logo_url}" alt="logo">` : `<strong style="font-size:18px">${tenant.company_name}</strong>`}
          </div>
          <div style="text-align:${isRTL ? 'left' : 'right'}">
            <div class="doc-title">${isRTL ? 'إيصال' : 'RECEIPT'}</div>
            <div>#${receipt.receipt_number}</div>
          </div>
        </div>

        <div class="parties">
          <div class="party">
            <h4>${isRTL ? 'من' : 'From'}</h4>
            <div><strong>${tenant.company_name}</strong></div>
            <div>${tenant.address || ''}</div>
            ${tenant.tax_id ? `<div>${isRTL ? `الرقم الضريبي: ${tenant.tax_id}` : `Tax ID: ${tenant.tax_id}`}</div>` : ''}
          </div>
          <div class="party" style="text-align:${isRTL ? 'left' : 'right'}">
            <h4>${isRTL ? 'استلمت من' : 'Received From'}</h4>
            <div><strong>${receipt.client_name || ''}</strong></div>
            <div>${receipt.client_email || ''}</div>
          </div>
        </div>

        <div class="amount-box">
          <div class="label">${isRTL ? 'المبلغ المستلم' : 'Amount Received'}</div>
          <div class="value">${formatAmount(receipt.amount, receipt.currency)}</div>
        </div>

        <div class="stamp-anchor">
          <div class="paid-stamp">
            ${isRTL ? 'مدفوع' : 'PAID'}
            <span class="stamp-sub">${String(receipt.issued_date || receipt.payment_date || '').split(/[T ]/)[0]}</span>
          </div>
        <table class="meta">
          <tr><td>${isRTL ? 'رقم الإيصال' : 'Receipt Number'}</td><td>${receipt.receipt_number}</td></tr>
          <tr><td>${isRTL ? 'تاريخ الدفع' : 'Payment Date'}</td><td>${receipt.issued_date}</td></tr>
          <tr><td>${isRTL ? 'طريقة الدفع' : 'Payment Method'}</td><td>${methodLabel}</td></tr>
          <tr><td>${isRTL ? 'الفاتورة المرتبطة' : 'For Invoice'}</td><td>${receipt.invoice_number || '—'}</td></tr>
          ${receipt.reference ? `<tr><td>${isRTL ? 'المرجع' : 'Reference'}</td><td>${receipt.reference}</td></tr>` : ''}
        </table>
        </div>

        ${receipt.notes ? `<div style="margin-top:20px;font-size:12px;color:#666"><strong>${isRTL ? 'ملاحظات' : 'Notes'}:</strong> ${receipt.notes}</div>` : ''}

        ${(tenant.stamp_url || tenant.signature_url) ? `
        <div class="receipt-stamp-area">
          ${tenant.signature_url ? `
          <div class="receipt-stamp-box">
            <img src="${tenant.signature_url}" alt="signature" />
            ${tenant.signatory_name ? `<div class="receipt-stamp-signatory">${tenant.signatory_name}</div>` : ''}
            ${tenant.signatory_title ? `<div class="receipt-stamp-title-txt">${tenant.signatory_title}</div>` : ''}
            <div class="receipt-stamp-label">${isRTL ? 'التوقيع المعتمد' : 'Authorized Signature'}</div>
          </div>` : ''}
          ${tenant.stamp_url ? `
          <div class="receipt-stamp-box">
            <img src="${tenant.stamp_url}" alt="stamp" />
            <div class="receipt-stamp-label">${isRTL ? 'الختم الرسمي' : 'Official Stamp'}</div>
          </div>` : ''}
        </div>` : ''}

        <div class="footer">${tenant.footer_text || (isRTL ? 'شكراً لتعاملكم معنا' : 'Thank you for your business')}</div>
      </div>
    </body>
    </html>
  `;

  return htmlToPdf(html);
}