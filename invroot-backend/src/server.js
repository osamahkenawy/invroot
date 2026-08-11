import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDatabase } from './lib/database.js';
import { startScheduledJobs } from './lib/scheduled-jobs.js';
import { sanitizeBody } from './middleware/sanitize.js';
import { failure } from './lib/api-error.js';

// Routes
import authRoutes         from './routes/auth.js';
import companyRoutes      from './routes/company.js';
import clientRoutes       from './routes/clients.js';
import catalogRoutes      from './routes/catalog.js';
import invoiceRoutes      from './routes/invoices.js';
import quoteRoutes        from './routes/quotes.js';
import paymentRoutes      from './routes/payments.js';
import receiptRoutes      from './routes/receipts.js';
import creditNoteRoutes   from './routes/credit-notes.js';
import recurringRoutes    from './routes/recurring.js';
import taxRoutes          from './routes/tax.js';
import reminderRoutes     from './routes/reminders.js';
import reportRoutes       from './routes/reports.js';
import settingsRoutes     from './routes/settings.js';
import integrationRoutes  from './routes/integrations.js';
import auditRoutes        from './routes/audit.js';
import clientPortalRoutes from './routes/client-portal.js';
import webhookRoutes      from './routes/webhooks.js';
import uploadRoutes       from './routes/uploads.js';
import superAdminRoutes   from './routes/super-admin.js';
import tenantsRoutes      from './routes/tenants.js';
import stripeRoutes       from './routes/stripe.js';
import expenseRoutes      from './routes/expenses.js';
import bankingRoutes      from './routes/banking.js';
import timeTrackingRoutes from './routes/time-tracking.js';
import notificationRoutes from './routes/notifications.js';
import publicRoutes       from './routes/public.js';
import billingRoutes      from './routes/billing.js';
import fileRoutes         from './routes/files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app = express();

/* In production this sits behind exactly one Nginx hop, which terminates TLS
   and forwards over loopback. Without trusting that hop Express reads the
   socket instead of X-Forwarded-For, so `req.ip` is 127.0.0.1 for EVERY
   caller: the rate limiters above then key every visitor to one bucket — one
   noisy client would lock out the whole tenant base — and login_history
   records the proxy's address for every sign-in, which is exactly the field
   you would reach for after a breach.

   `1`, not `true`: trusting the whole chain would let a caller forge
   X-Forwarded-For and pick their own rate-limit bucket. */
app.set('trust proxy', 1);

/* ── Security ─────────────────────────────────────────── */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

/* ── Rate limiting ────────────────────────────────────── */
const isDev = (process.env.NODE_ENV || 'development') === 'development';

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 20,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: () => isDev,
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
/* Re-authentication takes a password, so it is a brute-force target exactly
   like login and gets the same throttle. */
app.use('/api/auth/reauthenticate',  authLimiter);
/* Coupon validation answers "is this a real code?". Unthrottled it is a free
   oracle for guessing them, so it gets a tighter budget than general traffic. */
app.use('/api/billing/validate-coupon', rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isDev ? 500 : 20,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
}));
/* Refresh is not password-guessable, but an unbounded rotation endpoint is
   still worth a ceiling — a broken client retry loop would otherwise hammer it. */
app.use('/api/auth/refresh',         rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 500 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev,
}));

/* ── CORS ─────────────────────────────────────────────── */
app.use(cors({
  origin: (origin, cb) => {
    // Driven by CORS_ORIGINS + FRONTEND_URL — see config.app.corsOrigins.
    const allowed = [config.app.url, ...config.app.corsOrigins];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

/* ── Body parsing ─────────────────────────────────────── */
// Stripe webhook needs raw body — mount BEFORE express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());
app.use(sanitizeBody);

/* ── Static uploads (legacy, brand assets only) ────────
   This mount has no authentication, so it is restricted to the folders whose
   contents are meant to be public anyway — a logo, stamp or signature is
   rendered into invoice PDFs that clients receive.

   `documents/` and `avatars/` are deliberately NOT exposed here: they hold
   payment proofs, expense receipts and client photos. Those are served by
   GET /api/files/:id, which checks tenant ownership first. Serving the whole
   uploads/ tree statically made all of them world-readable by URL. */
const PUBLIC_ASSET_DIRS = ['logos', 'stamps', 'signatures'];
for (const dir of PUBLIC_ASSET_DIRS) {
  app.use(`/uploads/${dir}`, express.static(path.join(__dirname, '..', 'uploads', dir)));
}

/* Brand assets written by the storage layer live under uploads/tenants/<id>/,
   alongside avatars/ and documents/ — which must NOT be public. So the tenant
   tree is gated on an explicit allowlist of folders rather than mounted whole.
   Anything else under it 404s and is only reachable via GET /api/files/:id. */
const PUBLIC_KEY_RE = new RegExp(`^/\\d+/(${PUBLIC_ASSET_DIRS.join('|')})/[A-Za-z0-9._-]+$`);
app.use(
  '/uploads/tenants',
  (req, res, next) => (PUBLIC_KEY_RE.test(req.path) ? next() : res.status(404).end()),
  express.static(path.join(__dirname, '..', 'uploads', 'tenants'))
);

/* ── API Routes ───────────────────────────────────────── */
app.use('/api/auth',          authRoutes);
app.use('/api/company',       companyRoutes);
app.use('/api/clients',       clientRoutes);
app.use('/api/catalog',       catalogRoutes);
app.use('/api/invoices',      invoiceRoutes);
app.use('/api/quotes',        quoteRoutes);
app.use('/api/payments',      paymentRoutes);
app.use('/api/receipts',      receiptRoutes);
app.use('/api/credit-notes',  creditNoteRoutes);
app.use('/api/recurring',     recurringRoutes);
app.use('/api/tax',           taxRoutes);
app.use('/api/reminders',     reminderRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/integrations',  integrationRoutes);
app.use('/api/audit',         auditRoutes);
app.use('/api/client-portal', clientPortalRoutes);
app.use('/api/webhooks',      webhookRoutes);
app.use('/api/uploads',       uploadRoutes);
app.use('/api/super-admin',   superAdminRoutes);
app.use('/api/tenants',       tenantsRoutes);
app.use('/api/stripe',        stripeRoutes);
app.use('/api/expenses',      expenseRoutes);
app.use('/api/banking',       bankingRoutes);
app.use('/api/time-tracking', timeTrackingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/public',        publicRoutes);
app.use('/api/billing',       billingRoutes);
app.use('/api/files',         fileRoutes);

/* ── Health check ─────────────────────────────────────── */
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

/* ── 404 handler ──────────────────────────────────────── */
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

/* ── Global error handler ─────────────────────────────── */
app.use((err, req, res, _next) => {
  /* Errors raised by middleware (notably multer, which rejects a file before
     any route runs) never reach a route's try/catch, so they land here.
     failure() maps them the same way route errors are mapped — an upload of the
     wrong type is a 400 with a readable message, not a 500. */
  failure(res, err, { context: 'unhandled' });
});

/* ── Bootstrap ────────────────────────────────────────── */
(async () => {
  try {
    await initDatabase();
    startScheduledJobs();
    app.listen(config.port, () => {
      console.log(`✅ Invroot API running on port ${config.port} [${config.nodeEnv}]`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();

export default app;
