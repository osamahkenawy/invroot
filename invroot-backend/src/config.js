import 'dotenv/config';

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASS     || '',
    database: process.env.DB_NAME     || 'invroot',
  },

  jwt: {
    secret:    process.env.JWT_SECRET    || 'change-me-in-production',
    /* The access token is short-lived on purpose. It is a bearer credential
       that also sits in localStorage, so its lifetime is the window an
       attacker gets from a single leak. Continuity comes from the refresh
       token instead, which is revocable server-side. */
    expiresIn: process.env.JWT_EXPIRES   || '15m',
  },

  /* ── Sessions ────────────────────────────────────────────────────────
     `refreshDays` is a rolling window: each use pushes it out, so an active
     user is never interrupted. `absoluteDays` is the ceiling that window can
     never cross — without it a session with an open tab would live forever. */
  session: {
    refreshDays:  parseInt(process.env.SESSION_REFRESH_DAYS  || '30'),
    absoluteDays: parseInt(process.env.SESSION_ABSOLUTE_DAYS || '90'),
    /* How long a re-authentication (password re-entry) keeps the session
       alive before the absolute cap applies again. */
    reauthExtendsDays: parseInt(process.env.SESSION_REAUTH_DAYS || '30'),
  },

  smtp: {
    host:   process.env.EMAIL_HOST   || '',
    port:   parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    tls:    process.env.EMAIL_TLS    !== 'false',
    user:   process.env.EMAIL_USER   || '',
    pass:   process.env.EMAIL_PASS   || '',
    from:   process.env.EMAIL_FROM   || 'noreply@invroot.io',
    name:   process.env.EMAIL_NAME   || 'Invroot',
  },

  superAdmin: {
    email:    process.env.SUPER_ADMIN_EMAIL    || 'superadmin@invroot.com',
    password: process.env.SUPER_ADMIN_PASSWORD || '',
    name:     process.env.SUPER_ADMIN_NAME     || 'Platform Administrator',
  },

  stripe: {
    /* This Stripe account is shared with another product, so every object
       Invroot creates is stamped with this namespace and the webhook ignores
       anything that isn't ours. Changing it orphans existing subscriptions. */
    appNamespace:  process.env.STRIPE_APP_NAMESPACE  || 'invroot',
    /* Pinned deliberately: without it Stripe uses the account's default
       version, which can move under us and change payload shapes. */
    apiVersion:    process.env.STRIPE_API_VERSION    || '2024-06-20',
    secretKey:     process.env.STRIPE_SECRET_KEY     || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    /* Paid tiers only — `free` needs no Stripe price. Names match the plans the
       admin portal offers; `professional` is retained as a legacy alias. */
    priceIds: {
      starter:      process.env.STRIPE_PRICE_STARTER      || '',
      growth:       process.env.STRIPE_PRICE_GROWTH       || '',
      professional: process.env.STRIPE_PRICE_PROFESSIONAL || '',
      enterprise:   process.env.STRIPE_PRICE_ENTERPRISE   || '',
    },
  },

  app: {
    url:          process.env.APP_URL          || 'http://localhost:3000',
    frontendUrl:  process.env.FRONTEND_URL     || 'http://localhost:5050',
    apiUrl:       process.env.API_URL          || 'http://localhost:5000',
    uploadDir:    process.env.UPLOAD_DIR       || 'uploads',
    maxFileSize:  parseInt(process.env.MAX_FILE_SIZE_MB || '10') * 1024 * 1024,
    /* Browser origins permitted to call the API. Production hosts go in
       CORS_ORIGINS so moving domains is a config change, not a code change.
       FRONTEND_URL is always trusted — it's where Stripe checkout, email
       verification and payment links send people back to. */
    corsOrigins: [
      ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
      process.env.FRONTEND_URL || 'http://localhost:5050',
      // Local dev origins. A browser can only present these when the app is
      // actually being served from them, so leaving them in costs nothing.
      'http://localhost:5050', 'http://127.0.0.1:5050',
      'http://localhost:3000', 'http://localhost:5173',
    ],
  },

  /* ── File storage ────────────────────────────────────────────────────
     `local` writes to UPLOAD_DIR — the default so development needs no AWS
     account. `s3` is for production, where a container's disk is ephemeral.

     Objects are always private: the bucket should block public access and
     reads are served through GET /api/files/:id, which verifies the caller
     owns the tenant in the key before signing a short-lived URL. */
  storage: {
    driver:          process.env.STORAGE_DRIVER      || 'local',   // local | s3
    bucket:          process.env.S3_BUCKET           || '',
    region:          process.env.S3_REGION           || process.env.AWS_REGION || '',
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID     || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    /* How long a signed read URL stays valid. Short by design — long-lived
       URLs get pasted into chats and outlive the access that produced them. */
    signedUrlTtl:    parseInt(process.env.S3_SIGNED_URL_TTL || '300'),
  },

  /* ── Plans ───────────────────────────────────────────────────────────
     Two commercial tiers:
       starter    — AED 69/month, self-service, bought through Stripe Checkout
       enterprise — custom pricing, sales-led; no Stripe price, the upgrade
                    button raises an enquiry instead of taking a card

     `trial` is the state a new workspace begins in, not something sold.
     `free`, `growth` and `professional` are retired names kept only so tenants
     created under the old scheme keep working; they map onto current tiers.

     -1 means unlimited. `salesLed: true` suppresses Stripe checkout. */
  plans: {
    /* The trial exists to let someone issue one real invoice and see the whole
       flow. `lifetime: true` means that single invoice is counted for the life
       of the account, not per year — otherwise a trial tenant would silently
       get another free invoice every January. */
    /* One client as well as one invoice: the trial is a demonstration, not a
       small free tier. Five clients against a single lifetime invoice only
       ever meant four of them could never be billed. */
    trial:        { label: 'Trial',      maxClients: 1,   maxInvoices: 1,   maxUsers: 1,  monthly: 0, lifetime: true },
    starter:      { label: 'Starter',    maxClients: 200, maxInvoices: 1200, maxUsers: 5, monthly: 69, currency: 'AED' },
    enterprise:   { label: 'Enterprise', maxClients: -1,  maxInvoices: -1,  maxUsers: -1, salesLed: true },

    // Retired — retained so existing rows resolve to sane allowances.
    free:         { label: 'Free (retired)',    maxClients: 5,   maxInvoices: 10,   maxUsers: 1, retired: true },
    growth:       { label: 'Growth (retired)',  maxClients: 500, maxInvoices: 2000, maxUsers: 10, retired: true },
    professional: { label: 'Professional (retired)', maxClients: 500, maxInvoices: 2000, maxUsers: 10, retired: true },
  },
  /* An unrecognised or missing plan falls back to the trial allowance.
     Failing open here would hand out unlimited usage on a typo. */
  defaultPlan: 'trial',

  /* Where Enterprise enquiries go. Both inboxes are notified. */
  sales: {
    inboxes: (process.env.SALES_INBOX || 'info@trasealla.com,support@invroot.com')
      .split(',').map(s => s.trim()).filter(Boolean),
  },
};
