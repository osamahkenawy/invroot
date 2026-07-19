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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app = express();

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
app.use('/api/auth/login',          authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

/* ── CORS ─────────────────────────────────────────────── */
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      config.app.url,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
    ];
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

/* ── Static uploads ───────────────────────────────────── */
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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

/* ── Health check ─────────────────────────────────────── */
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

/* ── 404 handler ──────────────────────────────────────── */
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

/* ── Global error handler ─────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
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
