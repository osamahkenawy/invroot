import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Brand palette ─────────────────────────────────────── */
const BRAND = {
  navy:     '#1b2a4a',
  navyDark: '#111d36',
  gold:     '#c9a24b',
  goldSoft: '#e7d4a2',
  ink:      '#2b3550',
  muted:    '#8a93a6',
  bg:       '#f4f6fb',
  card:     '#ffffff',
  border:   '#e7ebf3',
};

/* Load the logo once and reuse it as an inline (CID) attachment so it
   renders reliably across email clients (no external hotlinking).
 *
 * The navy plate is baked INTO the image on purpose. The wordmark is
 * white-on-transparent, so it only reads against the navy header — and the
 * header colour is exactly what strict webmail sanitisers drop. Yopmail does:
 * it strips the cell's bgcolor and background-color alike, leaving a white
 * header on which the white wordmark vanished and only the gold wedge of the
 * mark survived. An opaque background in the PNG cannot be sanitised away: it
 * is seamless inside the navy header and still legible when the header is
 * stripped to white. Regenerate from the white original with:
 *   sharp({create:{width:600,height:200,channels:4,background:'#1b2a4a'}})
 *     .composite([{input:'email-logo.png'}]).png().toFile('email-logo-navy.png')
 */
let LOGO_ATTACHMENT = null;
function logoAttachment() {
  if (LOGO_ATTACHMENT !== null) return LOGO_ATTACHMENT;
  try {
    LOGO_ATTACHMENT = {
      filename: 'invroot-logo.png',
      content: readFileSync(join(__dirname, '../assets/email-logo-navy.png')),
      cid: 'invrootlogo',
      contentDisposition: 'inline',
    };
  } catch (err) {
    console.warn('⚠️  Email logo not found, sending without it:', err.message);
    LOGO_ATTACHMENT = false;
  }
  return LOGO_ATTACHMENT;
}

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

/** A branded gold pill button used as the primary call-to-action. */
export function emailButton(label, href) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px auto;">
      <tr><td align="center" style="border-radius:10px;background:${BRAND.gold};box-shadow:0 6px 16px rgba(201,162,75,0.35);">
        <a href="${href}" target="_blank"
           style="display:inline-block;padding:15px 40px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:${BRAND.navyDark};text-decoration:none;letter-spacing:.3px;border-radius:10px;">
          ${label}
        </a>
      </td></tr>
    </table>`;
}

/** A highlighted amount panel for invoice / payment emails. */
export function amountBox({ label, amount, sub = '', isAr = false }) {
  const align = isAr ? 'right' : 'left';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:22px 0;border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.bg};">
      <tr><td style="padding:18px 22px;text-align:${align};">
        <div style="font-family:Arial,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:${BRAND.muted};margin-bottom:6px;">${label}</div>
        <div style="font-family:Arial,sans-serif;font-size:26px;font-weight:800;color:${BRAND.navy};">${amount}</div>
        ${sub ? `<div style="font-family:Arial,sans-serif;font-size:13px;color:${BRAND.muted};margin-top:6px;">${sub}</div>` : ''}
      </td></tr>
    </table>`;
}

/**
 * Wrap content in the full Invroot branded shell: navy header with the logo,
 * a white content card, gold accent, and a footer. Returns HTML only — the
 * inline logo attachment is added automatically by sendEmail().
 * @param {object} o - { heading, intro, bodyHtml, isAr }
 */
export function renderBrandedEmail({ heading = '', intro = '', bodyHtml = '', isAr = false } = {}) {
  const dir = isAr ? 'rtl' : 'ltr';
  const align = isAr ? 'right' : 'left';
  const year = new Date().getFullYear();
  const poweredBy = isAr ? 'مدعوم من' : 'Powered by';
  const tagline = isAr ? 'الفوترة، ببساطة.' : 'Billing, Simplified.';
  const supportEmail = config.smtp.from || 'support@invroot.com';
  const needHelp = isAr ? 'تحتاج مساعدة؟ تواصل معنا على' : 'Need help? Reach us at';
  const autoNote = isAr
    ? 'هذه رسالة آلية، يُرجى عدم الرد عليها مباشرةً.'
    : 'This is an automated message — please do not reply directly.';

  return `
  <div style="margin:0;padding:0;background:${BRAND.bg};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${intro || heading}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="width:600px;max-width:100%;background:${BRAND.card};border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(27,42,74,0.10);font-family:Arial,Helvetica,sans-serif;">

          <!-- Header -->
          <!-- The bgcolor attribute and background-color are NOT redundant with the
               gradient. Many mail clients (Outlook desktop, several webmail
               viewers) drop CSS gradients entirely; with no solid fallback the
               header rendered white, and since the logo is white-on-transparent
               it disappeared — only the gold mark was visible. Solid navy first,
               gradient as an enhancement for clients that support it. -->
          <tr><td bgcolor="${BRAND.navy}" style="background-color:${BRAND.navy};background:linear-gradient(135deg,${BRAND.navy} 0%,${BRAND.navyDark} 100%);padding:34px 40px 30px;text-align:center;">
            <img src="cid:invrootlogo" alt="Invroot" width="190"
                 style="display:inline-block;width:190px;max-width:70%;height:auto;border:0;" />
            <div style="height:3px;width:56px;margin:18px auto 0;background:${BRAND.gold};border-radius:2px;"></div>
          </td></tr>

          <!-- Body -->
          <tr><td dir="${dir}" style="padding:40px 44px 8px;text-align:${align};color:${BRAND.ink};">
            ${heading ? `<h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:${BRAND.navy};font-weight:800;">${heading}</h1>` : ''}
            ${bodyHtml}
          </td></tr>

          <!-- Footer -->
          <tr><td style="padding:26px 44px 36px;">
            <div style="border-top:1px solid ${BRAND.border};padding-top:24px;text-align:center;">
              <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:14px;color:${BRAND.navy};font-weight:800;letter-spacing:.5px;">INVROOT <span style="color:${BRAND.gold};">·</span> <span style="font-weight:600;">${tagline}</span></p>

              <p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:12px;color:${BRAND.muted};line-height:1.6;">
                ${needHelp} <a href="mailto:${supportEmail}" style="color:${BRAND.gold};text-decoration:none;font-weight:600;">${supportEmail}</a>
              </p>
              <p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:11px;color:${BRAND.muted};font-style:italic;">${autoNote}</p>

              <div style="height:1px;width:100%;background:${BRAND.border};margin:18px 0;"></div>

              <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:${BRAND.muted};">${poweredBy} <strong style="color:${BRAND.navy};">Trasealla Solutions</strong></p>
              <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;color:${BRAND.muted};">© ${year} Invroot. ${isAr ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}</p>
            </div>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </div>`;
}

/**
 * Send an email. The inline Invroot logo (cid:invrootlogo) is attached
 * automatically so branded templates render it everywhere.
 * @param {object} opts - { to, subject, html, text, attachments }
 */
export async function sendEmail({ to, subject, html, text, attachments = [], replyTo, cc, bcc }) {
  const t = getTransporter();
  if (!t) return { skipped: true };
  const logo = logoAttachment();
  const allAttachments = logo ? [logo, ...attachments] : attachments;
  return t.sendMail({
    from: `"${config.smtp.name}" <${config.smtp.from}>`,
    to, subject, html, text, attachments: allAttachments,
    // Optional; used by sales enquiries so a reply reaches the requester
    // rather than the no-reply sending mailbox.
    ...(replyTo ? { replyTo } : {}),
    ...(cc  ? { cc }  : {}),
    ...(bcc ? { bcc } : {}),
  });
}

/**
 * Send invoice to client.
 */
export async function sendInvoiceEmail({ to, clientName, companyName, invoiceNumber, dueDate, totalAmount, currency, pdfBuffer, portalLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  /* The sender is Invroot, so without the tenant's name the subject read
     "Invoice #INV/08/2026/1" from a brand the recipient has no relationship
     with — and a client who buys from several Invroot businesses got a row of
     identical-looking subjects with no way to tell whose bill was whose. The
     name of the business owed the money belongs in the subject line.
     Falls back to the bare number when the tenant has no name on file, rather
     than emitting a dangling "from". */
  const subject = companyName
    ? (isAr ? `فاتورة رقم ${invoiceNumber} من ${companyName}` : `Invoice #${invoiceNumber} from ${companyName}`)
    : (isAr ? `فاتورة رقم ${invoiceNumber}` : `Invoice #${invoiceNumber}`);

  const p = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a5573;';

  const bodyHtml = isAr ? `
    <p style="${p}">مرحباً <strong style="color:${BRAND.navy};">${clientName}</strong>،</p>
    <p style="${p}">يرجى الاطلاع على الفاتورة المرفقة رقم <strong>${invoiceNumber}</strong>.</p>
    ${amountBox({ label: 'المبلغ الإجمالي', amount: `${totalAmount} ${currency}`, sub: `تاريخ الاستحقاق: ${dueDate}`, isAr })}
    ${portalLink ? `<div style="text-align:center;margin:28px 0;">${emailButton('عرض الفاتورة', portalLink)}</div>` : ''}
  ` : `
    <p style="${p}">Hello <strong style="color:${BRAND.navy};">${clientName}</strong>,</p>
    <p style="${p}">Please find attached invoice <strong>#${invoiceNumber}</strong>.</p>
    ${amountBox({ label: 'Total amount due', amount: `${totalAmount} ${currency}`, sub: `Due date: ${dueDate}`, isAr })}
    ${portalLink ? `<div style="text-align:center;margin:28px 0;">${emailButton('View Invoice', portalLink)}</div>` : ''}
  `;

  return sendEmail({
    to,
    subject,
    /* The link belongs in BOTH alternatives.
       It used to be HTML-only, which cost us twice. A plain-text reader got an
       invoice with no way to pay it — and Namecheap's outbound filter rejected
       the message outright (550 JFE040009, "odd number of URIs even though it
       has a multipart/alternative type") because a URI appeared in one part of
       the alternative and not the other. Bounced invoices are invisible to the
       sender and unpaid to everyone else. */
    text: isAr
      ? `مرحباً ${clientName}، فاتورة رقم ${invoiceNumber} بمبلغ ${totalAmount} ${currency} مستحقة بتاريخ ${dueDate}.`
        + (portalLink ? `\n\nعرض الفاتورة: ${portalLink}` : '')
      : `Hello ${clientName}, invoice #${invoiceNumber} for ${totalAmount} ${currency} is due on ${dueDate}.`
        + (portalLink ? `\n\nView invoice: ${portalLink}` : ''),
    html: renderBrandedEmail({
      heading: isAr ? `فاتورة #${invoiceNumber}` : `Invoice #${invoiceNumber}`,
      intro: isAr ? `فاتورة بمبلغ ${totalAmount} ${currency}` : `Invoice for ${totalAmount} ${currency}`,
      bodyHtml,
      isAr,
    }),
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

  const p = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a5573;';
  const alert = 'margin:0 0 16px;padding:12px 16px;border-radius:10px;background:#fdecec;color:#b42318;font-size:14px;line-height:1.6;border-left:3px solid #e5484d;';

  const bodyHtml = isAr ? `
    <p style="${p}">مرحباً <strong style="color:${BRAND.navy};">${clientName}</strong>،</p>
    ${overdue
      ? `<p style="${alert}">⚠️ الفاتورة رقم <strong>${invoiceNumber}</strong> متأخرة بـ <strong>${daysOverdue}</strong> يوم.</p>`
      : `<p style="${p}">هذا تذكير ودّي بأن الفاتورة رقم <strong>${invoiceNumber}</strong> مستحقة بتاريخ <strong>${dueDate}</strong>.</p>`}
    ${amountBox({ label: 'المبلغ المستحق', amount: `${amount} ${currency}`, sub: overdue ? '' : `تاريخ الاستحقاق: ${dueDate}`, isAr })}
    ${portalLink ? `<div style="text-align:center;margin:28px 0;">${emailButton('الدفع الآن', portalLink)}</div>` : ''}
  ` : `
    <p style="${p}">Hello <strong style="color:${BRAND.navy};">${clientName}</strong>,</p>
    ${overdue
      ? `<p style="${alert}">⚠️ Invoice <strong>#${invoiceNumber}</strong> is <strong>${daysOverdue}</strong> day(s) overdue.</p>`
      : `<p style="${p}">This is a friendly reminder that invoice <strong>#${invoiceNumber}</strong> is due on <strong>${dueDate}</strong>.</p>`}
    ${amountBox({ label: 'Amount due', amount: `${amount} ${currency}`, sub: overdue ? '' : `Due date: ${dueDate}`, isAr })}
    ${portalLink ? `<div style="text-align:center;margin:28px 0;">${emailButton('Pay Now', portalLink)}</div>` : ''}
  `;

  return sendEmail({
    to,
    subject,
    // Same URI-parity rule as the invoice above — see the note there.
    text: isAr
      ? `مرحباً ${clientName}، الفاتورة رقم ${invoiceNumber} بمبلغ ${amount} ${currency}${overdue ? ` متأخرة بـ ${daysOverdue} يوم.` : ` مستحقة بتاريخ ${dueDate}.`}`
        + (portalLink ? `\n\nالدفع الآن: ${portalLink}` : '')
      : `Hello ${clientName}, invoice #${invoiceNumber} for ${amount} ${currency} is ${overdue ? `${daysOverdue} day(s) overdue.` : `due on ${dueDate}.`}`
        + (portalLink ? `\n\nPay now: ${portalLink}` : ''),
    html: renderBrandedEmail({
      heading: isAr ? (overdue ? 'فاتورة متأخرة' : 'تذكير بالدفع') : (overdue ? 'Payment overdue' : 'Payment reminder'),
      intro: isAr ? `فاتورة رقم ${invoiceNumber}` : `Invoice #${invoiceNumber}`,
      bodyHtml,
      isAr,
    }),
  });
}

/**
 * Send password reset email.
 */
export async function sendPasswordResetEmail({ to, name, resetLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  const p = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a5573;';

  const bodyHtml = isAr ? `
    <p style="${p}">مرحباً <strong style="color:${BRAND.navy};">${name}</strong>،</p>
    <p style="${p}">تلقّينا طلباً لإعادة تعيين كلمة مرور حسابك في <strong>Invroot</strong>. اضغط على الزر أدناه للمتابعة:</p>
    <div style="text-align:center;margin:30px 0;">${emailButton('إعادة تعيين كلمة المرور', resetLink)}</div>
    <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">أو انسخ هذا الرابط في متصفحك:</p>
    <p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="${resetLink}" style="color:${BRAND.gold};">${resetLink}</a></p>
    <div style="background:${BRAND.bg};border-radius:10px;padding:14px 18px;font-size:13px;color:${BRAND.muted};line-height:1.6;">
      🔒 هذا الرابط صالح لمدة ساعة واحدة. إذا لم تطلب ذلك، تجاهل هذه الرسالة وستبقى كلمة مرورك دون تغيير.
    </div>
  ` : `
    <p style="${p}">Hello <strong style="color:${BRAND.navy};">${name}</strong>,</p>
    <p style="${p}">We received a request to reset the password for your <strong>Invroot</strong> account. Click the button below to continue:</p>
    <div style="text-align:center;margin:30px 0;">${emailButton('Reset Password', resetLink)}</div>
    <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">Or copy and paste this link into your browser:</p>
    <p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="${resetLink}" style="color:${BRAND.gold};">${resetLink}</a></p>
    <div style="background:${BRAND.bg};border-radius:10px;padding:14px 18px;font-size:13px;color:${BRAND.muted};line-height:1.6;">
      🔒 This link is valid for 1 hour. If you didn't request this, simply ignore this email — your password won't change.
    </div>
  `;

  return sendEmail({
    to,
    subject: isAr ? '🔑 إعادة تعيين كلمة المرور - Invroot' : '🔑 Reset your Invroot password',
    text: isAr
      ? `مرحباً ${name}، أعد تعيين كلمة المرور عبر الرابط (صالح لمدة ساعة): ${resetLink}`
      : `Hello ${name}, reset your password using this link (valid for 1 hour): ${resetLink}`,
    html: renderBrandedEmail({
      heading: isAr ? 'إعادة تعيين كلمة المرور 🔑' : 'Reset your password 🔑',
      intro: isAr ? 'رابط إعادة تعيين كلمة المرور بالداخل' : 'Your password reset link is inside',
      bodyHtml,
      isAr,
    }),
  });
}

/**
 * Send email verification.
 */
export async function sendVerificationEmail({ to, name, verifyLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  const p = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a5573;';

  const bodyHtml = isAr ? `
    <p style="${p}">أهلاً بك <strong style="color:${BRAND.navy};">${name}</strong> 👋</p>
    <p style="${p}">يسعدنا انضمامك إلى <strong>Invroot</strong> — منصة الفوترة والمدفوعات الأذكى لأعمالك. خطوة أخيرة فقط لتفعيل حسابك.</p>
    <p style="${p}">اضغط على الزر أدناه لتأكيد بريدك الإلكتروني والبدء:</p>
    <div style="text-align:center;margin:30px 0;">${emailButton('✓ تفعيل حسابي', verifyLink)}</div>
    <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">أو انسخ هذا الرابط في متصفحك:</p>
    <p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="${verifyLink}" style="color:${BRAND.gold};">${verifyLink}</a></p>
    <div style="background:${BRAND.bg};border-radius:10px;padding:14px 18px;font-size:13px;color:${BRAND.muted};line-height:1.6;">
      🔒 ينتهي هذا الرابط بعد فترة قصيرة. إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.
    </div>
  ` : `
    <p style="${p}">Hi <strong style="color:${BRAND.navy};">${name}</strong> 👋</p>
    <p style="${p}">Welcome aboard <strong>Invroot</strong> — the smarter way to invoice, bill, and get paid. You're just one click away from getting started.</p>
    <p style="${p}">Tap the button below to confirm your email and activate your account:</p>
    <div style="text-align:center;margin:30px 0;">${emailButton('✓ Verify My Email', verifyLink)}</div>
    <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">Or copy and paste this link into your browser:</p>
    <p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="${verifyLink}" style="color:${BRAND.gold};">${verifyLink}</a></p>
    <div style="background:${BRAND.bg};border-radius:10px;padding:14px 18px;font-size:13px;color:${BRAND.muted};line-height:1.6;">
      🔒 This link expires shortly. If you didn't create an Invroot account, you can safely ignore this email.
    </div>
  `;

  return sendEmail({
    to,
    subject: isAr ? '🎉 مرحباً بك في Invroot — فعّل حسابك' : '🎉 Welcome to Invroot — Verify your email',
    text: isAr
      ? `مرحباً ${name}، فعّل حسابك عبر الرابط: ${verifyLink}`
      : `Hi ${name}, verify your Invroot account: ${verifyLink}`,
    html: renderBrandedEmail({
      heading: isAr ? 'فعّل حسابك ✨' : "Let's verify your email ✨",
      intro: isAr ? 'خطوة أخيرة لتفعيل حساب Invroot' : 'One quick step to activate your Invroot account',
      bodyHtml,
      isAr,
    }),
  });
}

/**
 * Welcome email sent once an account is verified — points the user into the app.
 */
export async function sendWelcomeEmail({ to, name, loginLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  const p = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a5573;';
  const li = 'margin:0 0 10px;font-size:14px;line-height:1.6;color:#4a5573;';

  const bodyHtml = isAr ? `
    <p style="${p}">تم تفعيل حسابك بنجاح يا <strong style="color:${BRAND.navy};">${name}</strong> 🎉</p>
    <p style="${p}">كل شيء جاهز الآن. إليك كيف تبدأ خلال دقائق:</p>
    <ul style="padding-inline-start:18px;margin:0 0 18px;">
      <li style="${li}">🏢 أضِف هوية شركتك وشعارك</li>
      <li style="${li}">👥 أضِف أول عميل لك</li>
      <li style="${li}">🧾 أنشئ وأرسل أول فاتورة</li>
    </ul>
    <div style="text-align:center;margin:28px 0;">${emailButton('انتقل إلى لوحة التحكم', loginLink)}</div>
  ` : `
    <p style="${p}">Your account is verified, <strong style="color:${BRAND.navy};">${name}</strong> 🎉</p>
    <p style="${p}">You're all set. Here's how to get value in the next few minutes:</p>
    <ul style="padding-inline-start:18px;margin:0 0 18px;">
      <li style="${li}">🏢 Add your company identity &amp; logo</li>
      <li style="${li}">👥 Add your first client</li>
      <li style="${li}">🧾 Create and send your first invoice</li>
    </ul>
    <div style="text-align:center;margin:28px 0;">${emailButton('Go to my dashboard', loginLink)}</div>
  `;

  return sendEmail({
    to,
    subject: isAr ? '🚀 حسابك جاهز — أهلاً بك في Invroot' : '🚀 You’re all set — welcome to Invroot',
    text: isAr ? `مرحباً ${name}، حسابك جاهز. ابدأ من هنا: ${loginLink}` : `Hi ${name}, your account is ready. Get started: ${loginLink}`,
    html: renderBrandedEmail({
      heading: isAr ? 'أهلاً بك في Invroot 🚀' : 'Welcome to Invroot 🚀',
      intro: isAr ? 'حسابك جاهز للاستخدام' : 'Your account is ready to go',
      bodyHtml,
      isAr,
    }),
  });
}

/**
 * Payment-received confirmation sent to the client after a payment is recorded.
 */
export async function sendPaymentReceivedEmail({ to, clientName, invoiceNumber, amount, currency, method, portalLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  const p = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a5573;';

  const bodyHtml = isAr ? `
    <p style="${p}">مرحباً <strong style="color:${BRAND.navy};">${clientName}</strong>،</p>
    <p style="${p}">شكراً لك! لقد استلمنا دفعتك للفاتورة رقم <strong>${invoiceNumber}</strong>.</p>
    ${amountBox({ label: 'المبلغ المستلم', amount: `${amount} ${currency}`, sub: method ? `طريقة الدفع: ${method}` : '', isAr })}
    ${portalLink ? `<div style="text-align:center;margin:28px 0;">${emailButton('عرض الإيصال', portalLink)}</div>` : ''}
  ` : `
    <p style="${p}">Hello <strong style="color:${BRAND.navy};">${clientName}</strong>,</p>
    <p style="${p}">Thank you! We've received your payment for invoice <strong>#${invoiceNumber}</strong>.</p>
    ${amountBox({ label: 'Amount received', amount: `${amount} ${currency}`, sub: method ? `Method: ${method}` : '', isAr })}
    ${portalLink ? `<div style="text-align:center;margin:28px 0;">${emailButton('View Receipt', portalLink)}</div>` : ''}
  `;

  return sendEmail({
    to,
    subject: isAr ? `✅ تم استلام الدفعة — فاتورة ${invoiceNumber}` : `✅ Payment received — Invoice #${invoiceNumber}`,
    text: isAr
      ? `مرحباً ${clientName}، تم استلام دفعتك بمبلغ ${amount} ${currency} للفاتورة ${invoiceNumber}. شكراً لك.`
      : `Hello ${clientName}, we received your payment of ${amount} ${currency} for invoice #${invoiceNumber}. Thank you.`,
    html: renderBrandedEmail({
      heading: isAr ? 'تم استلام الدفعة ✅' : 'Payment received ✅',
      intro: isAr ? `شكراً على دفعتك للفاتورة ${invoiceNumber}` : `Thanks for your payment on invoice #${invoiceNumber}`,
      bodyHtml,
      isAr,
    }),
  });
}

/**
 * Account-created email for tenants provisioned by a platform admin. Carries the
 * temporary password the owner must change on first sign-in.
 */
export async function sendTenantWelcomeEmail({ to, name, companyName, email, tempPassword, loginLink, lang = 'en' }) {
  const isAr = lang === 'ar';
  const p = 'margin:0 0 16px;font-size:15px;line-height:1.7;color:#4a5573;';
  const cellK = `padding:9px 14px;font-size:12px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;`;
  const cellV = `padding:9px 14px;font-size:15px;font-weight:700;color:${BRAND.navy};font-family:'SFMono-Regular',Consolas,monospace;`;

  const creds = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:22px 0;border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.bg};">
      <tr><td style="${cellK}">${isAr ? 'البريد الإلكتروني' : 'Email'}</td><td style="${cellV}">${email}</td></tr>
      <tr><td style="${cellK}">${isAr ? 'كلمة المرور المؤقتة' : 'Temporary password'}</td><td style="${cellV}">${tempPassword}</td></tr>
    </table>`;

  const bodyHtml = isAr ? `
    <p style="${p}">مرحباً <strong style="color:${BRAND.navy};">${name}</strong>،</p>
    <p style="${p}">تم إنشاء حساب <strong>${companyName}</strong> على منصة <strong>Invroot</strong>. استخدم البيانات التالية لتسجيل الدخول:</p>
    ${creds}
    <div style="text-align:center;margin:28px 0;">${emailButton('تسجيل الدخول', loginLink)}</div>
    <div style="background:#fff8e6;border-inline-start:3px solid ${BRAND.gold};border-radius:10px;padding:14px 18px;font-size:13px;color:#7a5c12;line-height:1.6;">
      🔐 لأسباب أمنية، سيُطلب منك تغيير كلمة المرور المؤقتة فور تسجيل الدخول لأول مرة. لا تشارك هذه الرسالة مع أحد.
    </div>
  ` : `
    <p style="${p}">Hello <strong style="color:${BRAND.navy};">${name}</strong>,</p>
    <p style="${p}">An account for <strong>${companyName}</strong> has been created for you on <strong>Invroot</strong>. Sign in with the credentials below:</p>
    ${creds}
    <div style="text-align:center;margin:28px 0;">${emailButton('Sign in to Invroot', loginLink)}</div>
    <div style="background:#fff8e6;border-inline-start:3px solid ${BRAND.gold};border-radius:10px;padding:14px 18px;font-size:13px;color:#7a5c12;line-height:1.6;">
      🔐 For security, you'll be asked to choose your own password the first time you sign in. Please don't forward this email to anyone.
    </div>
  `;

  return sendEmail({
    to,
    subject: isAr ? `🔑 تم إنشاء حساب ${companyName} على Invroot` : `🔑 Your Invroot account for ${companyName} is ready`,
    text: isAr
      ? `مرحباً ${name}، تم إنشاء حساب ${companyName}. البريد: ${email} — كلمة المرور المؤقتة: ${tempPassword}. سجّل الدخول: ${loginLink}`
      : `Hello ${name}, your Invroot account for ${companyName} is ready. Email: ${email} — temporary password: ${tempPassword}. Sign in: ${loginLink}`,
    html: renderBrandedEmail({
      heading: isAr ? 'حسابك جاهز 🔑' : 'Your account is ready 🔑',
      intro: isAr ? `بيانات الدخول إلى ${companyName}` : `Sign-in details for ${companyName}`,
      bodyHtml,
      isAr,
    }),
  });
}

/**
 * Enterprise enquiry, sent to the sales inboxes (not to the tenant).
 *
 * Enterprise is custom-priced and contract-based, so the upgrade button raises
 * this instead of taking a card. Reply-To is the requester so sales can answer
 * the thread directly.
 */
export async function sendEnterpriseEnquiryEmail({
  to, companyName, contactName, contactEmail, phone, teamSize, message,
  tenantId, currentPlan, usage,
}) {
  const p = 'margin:0 0 14px;font-size:15px;line-height:1.7;color:#4a5573;';
  const k = `padding:8px 14px;font-size:12px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.5px;white-space:nowrap;vertical-align:top;`;
  const v = `padding:8px 14px;font-size:14px;font-weight:600;color:${BRAND.navy};`;

  const row = (label, value) => value
    ? `<tr><td style="${k}">${label}</td><td style="${v}">${value}</td></tr>` : '';

  const usageLine = usage
    ? `${usage.clients?.used ?? '—'} clients · ${usage.invoices?.used ?? '—'} invoices · ${usage.users?.used ?? '—'} users`
    : null;

  const bodyHtml = `
    <p style="${p}"><strong style="color:${BRAND.navy};">${companyName}</strong> has requested Enterprise pricing.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:18px 0;border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.bg};">
      ${row('Company', companyName)}
      ${row('Contact', contactName)}
      ${row('Email', `<a href="mailto:${contactEmail}" style="color:${BRAND.gold};text-decoration:none;">${contactEmail}</a>`)}
      ${row('Phone', phone)}
      ${row('Team size', teamSize)}
      ${row('Current plan', currentPlan)}
      ${row('Current usage', usageLine)}
      ${row('Tenant ID', `#${tenantId}`)}
    </table>
    ${message ? `
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:${BRAND.muted};margin-bottom:6px;">Requirements</div>
      <div style="background:#fff;border:1px solid ${BRAND.border};border-left:3px solid ${BRAND.gold};border-radius:10px;padding:14px 18px;font-size:14px;line-height:1.7;color:#4a5573;white-space:pre-wrap;">${message}</div>
    ` : ''}
    <p style="margin:22px 0 0;font-size:13px;color:${BRAND.muted};">Reply to this email to reach the requester directly.</p>
  `;

  return sendEmail({
    to,
    replyTo: contactEmail,
    subject: `💼 Enterprise enquiry — ${companyName}`,
    text: `Enterprise enquiry from ${companyName}\n\nContact: ${contactName} <${contactEmail}>\nPhone: ${phone || '—'}\nTeam size: ${teamSize || '—'}\nCurrent plan: ${currentPlan}\nTenant: #${tenantId}\n\n${message || '(no additional requirements given)'}`,
    html: renderBrandedEmail({
      heading: 'Enterprise enquiry 💼',
      intro: `${companyName} wants to talk about Enterprise`,
      bodyHtml,
      isAr: false,
    }),
  });
}
