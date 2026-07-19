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

/**
 * Build the HTML for an invoice and return the PDF buffer.
 */
export async function generateInvoicePdf(invoice, tenant, lang = 'en', docType = 'invoice') {
  const isRTL = lang === 'ar';
  const dir = isRTL ? 'rtl' : 'ltr';
  const docTitle = docType === 'quote'
    ? (isRTL ? 'عرض سعر' : 'QUOTATION')
    : (isRTL ? 'فاتورة' : 'INVOICE');

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
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
        .company-logo img { max-height: 60px; }
        .invoice-title { font-size: 28px; font-weight: bold; color: #e85d04; }
        .invoice-meta { margin-bottom: 20px; }
        .invoice-meta table { width: 100%; }
        .invoice-meta td { padding: 4px 8px; }
        .parties { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .party h4 { font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
        table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        table.items th { background: #f4f4f4; padding: 8px; text-align: ${isRTL ? 'right' : 'left'}; font-size: 12px; }
        table.items td { padding: 8px; border-bottom: 1px solid #eee; }
        .totals { ${isRTL ? 'text-align:left' : 'text-align:right'}; }
        .totals table { display: inline-block; }
        .totals td { padding: 4px 8px; }
        .totals .grand-total { font-weight: bold; font-size: 16px; color: #e85d04; }
        .notes { margin-top: 20px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 10px; }
        .stamp-area { display: flex; justify-content: flex-end; align-items: flex-end; margin-top: 36px; gap: 40px; padding-top: 20px; border-top: 1px solid #eee; }
        .stamp-box { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .stamp-box .stamp-label { font-size: 10px; text-transform: uppercase; color: #aaa; letter-spacing: .08em; }
        .stamp-box img { max-height: 90px; max-width: 160px; object-fit: contain; opacity: 0.92; }
        .stamp-box .stamp-signatory { font-size: 12px; font-weight: 600; color: #444; margin-top: 2px; }
        .stamp-box .stamp-title { font-size: 11px; color: #888; }
        .footer { margin-top: 30px; border-top: 2px solid #e85d04; padding-top: 10px; font-size: 11px; color: #888; text-align: center; }
      </style>
    </head>
    <body>
      <div class="invoice-wrapper">
        <div class="header">
          <div class="company-logo">
            ${tenant.logo_url ? `<img src="${config.app.apiUrl}/uploads/${tenant.logo_url}" alt="logo">` : `<strong>${tenant.company_name}</strong>`}
          </div>
          <div>
            <div class="invoice-title">${docTitle}</div>
            <div>#${invoice.invoice_number}</div>
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
            ${invoice.discount_amount ? `<tr><td>${isRTL ? 'الخصم' : 'Discount'}</td><td>-${formatAmount(invoice.discount_amount, invoice.currency)}</td></tr>` : ''}
            <tr><td>${isRTL ? 'الضريبة' : 'Tax'}</td><td>${formatAmount(invoice.tax_amount, invoice.currency)}</td></tr>
            <tr class="grand-total"><td>${isRTL ? 'الإجمالي' : 'Total'}</td><td>${formatAmount(invoice.total_amount, invoice.currency)}</td></tr>
          </table>
        </div>

        ${invoice.notes ? `<div class="notes"><strong>${isRTL ? 'ملاحظات' : 'Notes'}:</strong> ${invoice.notes}</div>` : ''}
        ${invoice.footer_text ? `<div class="notes" style="margin-top:8px">${invoice.footer_text}</div>` : ''}

        ${(tenant.stamp_url || tenant.signature_url) ? `
        <div class="stamp-area">
          ${tenant.signature_url ? `
          <div class="stamp-box">
            <img src="${config.app.apiUrl}/uploads/signatures/${tenant.signature_url}" alt="signature" />
            ${tenant.signatory_name ? `<div class="stamp-signatory">${tenant.signatory_name}</div>` : ''}
            ${tenant.signatory_title ? `<div class="stamp-title">${tenant.signatory_title}</div>` : ''}
            <div class="stamp-label">${isRTL ? 'التوقيع المعتمد' : 'Authorized Signature'}</div>
          </div>` : ''}
          ${tenant.stamp_url ? `
          <div class="stamp-box">
            <img src="${config.app.apiUrl}/uploads/stamps/${tenant.stamp_url}" alt="stamp" />
            <div class="stamp-label">${isRTL ? 'الختم الرسمي' : 'Official Stamp'}</div>
          </div>` : ''}
        </div>` : ''}

        <div class="footer">${tenant.footer_text || (isRTL ? 'شكراً لتعاملكم معنا' : 'Thank you for your business')}</div>
      </div>
    </body>
    </html>
  `;

  return htmlToPdf(html);
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
        .paid-badge { display: inline-block; margin-top: 8px; padding: 4px 14px; border-radius: 20px;
          background: #dcfce7; color: #16a34a; font-weight: bold; font-size: 12px; text-transform: uppercase; }
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
            ${tenant.logo_url ? `<img src="${config.app.apiUrl}/uploads/${tenant.logo_url}" alt="logo">` : `<strong style="font-size:18px">${tenant.company_name}</strong>`}
          </div>
          <div style="text-align:${isRTL ? 'left' : 'right'}">
            <div class="doc-title">${isRTL ? 'إيصال' : 'RECEIPT'}</div>
            <div>#${receipt.receipt_number}</div>
            <div class="paid-badge">${isRTL ? 'مدفوع' : 'PAID'}</div>
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

        <table class="meta">
          <tr><td>${isRTL ? 'رقم الإيصال' : 'Receipt Number'}</td><td>${receipt.receipt_number}</td></tr>
          <tr><td>${isRTL ? 'تاريخ الدفع' : 'Payment Date'}</td><td>${receipt.issued_date}</td></tr>
          <tr><td>${isRTL ? 'طريقة الدفع' : 'Payment Method'}</td><td>${methodLabel}</td></tr>
          <tr><td>${isRTL ? 'الفاتورة المرتبطة' : 'For Invoice'}</td><td>${receipt.invoice_number || '—'}</td></tr>
          ${receipt.reference ? `<tr><td>${isRTL ? 'المرجع' : 'Reference'}</td><td>${receipt.reference}</td></tr>` : ''}
        </table>

        ${receipt.notes ? `<div style="margin-top:20px;font-size:12px;color:#666"><strong>${isRTL ? 'ملاحظات' : 'Notes'}:</strong> ${receipt.notes}</div>` : ''}

        ${(tenant.stamp_url || tenant.signature_url) ? `
        <div class="receipt-stamp-area">
          ${tenant.signature_url ? `
          <div class="receipt-stamp-box">
            <img src="${config.app.apiUrl}/uploads/signatures/${tenant.signature_url}" alt="signature" />
            ${tenant.signatory_name ? `<div class="receipt-stamp-signatory">${tenant.signatory_name}</div>` : ''}
            ${tenant.signatory_title ? `<div class="receipt-stamp-title-txt">${tenant.signatory_title}</div>` : ''}
            <div class="receipt-stamp-label">${isRTL ? 'التوقيع المعتمد' : 'Authorized Signature'}</div>
          </div>` : ''}
          ${tenant.stamp_url ? `
          <div class="receipt-stamp-box">
            <img src="${config.app.apiUrl}/uploads/stamps/${tenant.stamp_url}" alt="stamp" />
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