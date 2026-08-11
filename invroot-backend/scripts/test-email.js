// SMTP connectivity + branded-template send test.
// Usage: node scripts/test-email.js [recipient@example.com] [which]
//   which = all | verify | invoice | reminder | reset   (default: verify)
import { config } from '../src/config.js';
import {
  sendVerificationEmail, sendPasswordResetEmail,
  sendInvoiceEmail, sendPaymentReminder,
} from '../src/lib/email.js';
import nodemailer from 'nodemailer';

const to = process.argv[2] || config.smtp.user;
const which = (process.argv[3] || 'verify').toLowerCase();

console.log('SMTP:', { host: config.smtp.host, port: config.smtp.port, user: config.smtp.user, from: config.smtp.from });
console.log('Frontend URL for links:', config.app.frontendUrl);

// Verify connectivity once.
const opts = { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
  auth: { user: config.smtp.user, pass: config.smtp.pass }, connectionTimeout: 15000 };
if (config.smtp.secure) opts.tls = { rejectUnauthorized: false };
else if (config.smtp.tls) { opts.requireTLS = true; opts.tls = { rejectUnauthorized: false }; }
try {
  await nodemailer.createTransport(opts).verify();
  console.log('✅ SMTP verify() succeeded');
} catch (err) { console.error('❌ SMTP verify() failed:', err.message); process.exit(1); }

const link = `${config.app.frontendUrl}/verify-email?token=SAMPLE1234567890abcdef`;
const resetLink = `${config.app.frontendUrl}/reset-password?token=SAMPLE1234567890abcdef`;
const portalLink = `${config.app.frontendUrl}/portal/invoices/INV-1042`;

const jobs = {
  verify:   () => sendVerificationEmail({ to, name: 'Ahmed Ali', verifyLink: link }),
  reset:    () => sendPasswordResetEmail({ to, name: 'Ahmed Ali', resetLink }),
  invoice:  () => sendInvoiceEmail({ to, clientName: 'Ahmed Ali', invoiceNumber: 'INV-1042',
              dueDate: '2026-08-15', totalAmount: '4,750.00', currency: 'AED', portalLink }),
  reminder: () => sendPaymentReminder({ to, clientName: 'Ahmed Ali', invoiceNumber: 'INV-1042',
              amount: '4,750.00', currency: 'AED', dueDate: '2026-07-20', portalLink, daysOverdue: 8 }),
};

const list = which === 'all' ? Object.keys(jobs) : [which];
for (const name of list) {
  if (!jobs[name]) { console.warn(`skip unknown template: ${name}`); continue; }
  const info = await jobs[name]();
  console.log(`✅ sent [${name}] → ${to} — messageId:`, info.messageId);
}
process.exit(0);
