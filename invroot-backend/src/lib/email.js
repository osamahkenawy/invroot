import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { host, port, secure, tls, user, pass } = config.smtp;
  if (!host) { console.warn('⚠️  SMTP not configured'); return null; }

  const opts = { host, port, secure, connectionTimeout: 15000, socketTimeout: 30000 };
  if (user && pass) opts.auth = { user, pass };
  if (secure) opts.tls = { rejectUnauthorized: false };
  else if (tls) { opts.requireTLS = true; opts.tls = { rejectUnauthorized: false }; }

  transporter = nodemailer.createTransport(opts);
  transporter.verify()
    .then(() => console.log('✅ Email transporter ready'))
    .catch(err => console.error('❌ Email transporter error:', err.message));
  return transporter;
}

/** Shared branded footer injected into every outgoing email */
function emailFooter(isAr = false) {
  return `
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;">
      ${isAr
        ? '<p style="margin:0;">مدعوم من <strong style="color:#244066;">Trasealla Solutions</strong></p>'
        : '<p style="margin:0;">Powered by <strong style="color:#244066;">Trasealla Solutions</strong></p>'
      }
    </div>
  `;
}

/**
 * Send an email.
 * @param {object} opts - { to, subject, html, text, attachments }
 */
export async function sendEmail({ to, subject, html, text, attachments = [] }) {
  const t = getTransporter();
  if (!t) return { skipped: true };
  return t.sendMail({
    from: `"${config.smtp.name}" <${config.smtp.from}>`,
    to, subject, html, text, attachments,
  });
}

/**
 * Send invoice to client.
 */
export async function sendInvoiceEmail({ to, clientName, invoiceNumber, dueDate, totalAmount, currency, pdfBuffer, portalLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  const subject = isAr
    ? `فاتورة رقم ${invoiceNumber}`
    : `Invoice #${invoiceNumber}`;

  const html = isAr ? `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>مرحباً ${clientName}</h2>
      <p>يرجى الاطلاع على الفاتورة المرفقة رقم <strong>${invoiceNumber}</strong>.</p>
      <p>المبلغ الإجمالي: <strong>${totalAmount} ${currency}</strong></p>
      <p>تاريخ الاستحقاق: <strong>${dueDate}</strong></p>
      ${portalLink ? `<p><a href="${portalLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">عرض الفاتورة</a></p>` : ''}
      ${emailFooter(true)}
    </div>
  ` : `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Hello ${clientName},</h2>
      <p>Please find attached invoice <strong>#${invoiceNumber}</strong>.</p>
      <p>Total amount due: <strong>${totalAmount} ${currency}</strong></p>
      <p>Due date: <strong>${dueDate}</strong></p>
      ${portalLink ? `<p><a href="${portalLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">View Invoice</a></p>` : ''}
      ${emailFooter()}
    </div>
  `;

  return sendEmail({
    to,
    subject,
    html,
    attachments: pdfBuffer ? [{ filename: `invoice-${invoiceNumber}.pdf`, content: pdfBuffer }] : [],
  });
}

/**
 * Send payment reminder.
 */
export async function sendPaymentReminder({ to, clientName, invoiceNumber, amount, currency, dueDate, portalLink, daysOverdue, lang = 'en' }) {
  const isAr = lang === 'ar';
  const overdue = daysOverdue > 0;

  const subject = isAr
    ? (overdue ? `تذكير: فاتورة متأخرة رقم ${invoiceNumber}` : `تذكير بموعد الدفع - فاتورة ${invoiceNumber}`)
    : (overdue ? `Overdue Invoice #${invoiceNumber}` : `Payment Reminder – Invoice #${invoiceNumber}`);

  const html = isAr ? `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>مرحباً ${clientName}</h2>
      ${overdue
        ? `<p style="color:#dc2626;">الفاتورة رقم <strong>${invoiceNumber}</strong> متأخرة بـ ${daysOverdue} يوم.</p>`
        : `<p>تذكير بأن الفاتورة رقم <strong>${invoiceNumber}</strong> مستحقة بتاريخ ${dueDate}.</p>`}
      <p>المبلغ المستحق: <strong>${amount} ${currency}</strong></p>
      ${portalLink ? `<p><a href="${portalLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">الدفع الآن</a></p>` : ''}
      ${emailFooter(true)}
    </div>
  ` : `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Hello ${clientName},</h2>
      ${overdue
        ? `<p style="color:#dc2626;">Invoice <strong>#${invoiceNumber}</strong> is ${daysOverdue} day(s) overdue.</p>`
        : `<p>This is a reminder that invoice <strong>#${invoiceNumber}</strong> is due on ${dueDate}.</p>`}
      <p>Amount due: <strong>${amount} ${currency}</strong></p>
      ${portalLink ? `<p><a href="${portalLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">Pay Now</a></p>` : ''}
      ${emailFooter()}
    </div>
  `;

  return sendEmail({ to, subject, html });
}

/**
 * Send password reset email.
 */
export async function sendPasswordResetEmail({ to, name, resetLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  return sendEmail({
    to,
    subject: isAr ? 'إعادة تعيين كلمة المرور' : 'Reset your password',
    html: isAr ? `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>مرحباً ${name}</h2>
        <p>اضغط على الزر أدناه لإعادة تعيين كلمة المرور. الرابط صالح لمدة ساعة.</p>
        <p><a href="${resetLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">إعادة تعيين كلمة المرور</a></p>
        ${emailFooter(true)}
      </div>
    ` : `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello ${name},</h2>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <p><a href="${resetLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">Reset Password</a></p>
        ${emailFooter()}
      </div>
    `,
  });
}

/**
 * Send email verification.
 */
export async function sendVerificationEmail({ to, name, verifyLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  return sendEmail({
    to,
    subject: isAr ? 'تحقق من بريدك الإلكتروني' : 'Verify your email',
    html: isAr ? `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>مرحباً ${name}</h2>
        <p>اضغط على الزر أدناه لتفعيل حسابك.</p>
        <p><a href="${verifyLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">تحقق من البريد</a></p>
        ${emailFooter(true)}
      </div>
    ` : `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Trasealla Solutions, ${name}!</h2>
        <p>Please verify your email address to get started.</p>
        <p><a href="${verifyLink}" style="background:#e85d04;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">Verify Email</a></p>
        ${emailFooter()}
      </div>
    `,
  });
}
