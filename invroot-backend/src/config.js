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
    expiresIn: process.env.JWT_EXPIRES   || '7d',
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

  stripe: {
    secretKey:     process.env.STRIPE_SECRET_KEY     || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    priceIds: {
      starter:     process.env.STRIPE_PRICE_STARTER     || '',
      professional: process.env.STRIPE_PRICE_PROFESSIONAL || '',
      enterprise:  process.env.STRIPE_PRICE_ENTERPRISE  || '',
    },
  },

  app: {
    url:          process.env.APP_URL          || 'http://localhost:3000',
    apiUrl:       process.env.API_URL          || 'http://localhost:5000',
    uploadDir:    process.env.UPLOAD_DIR       || 'uploads',
    maxFileSize:  parseInt(process.env.MAX_FILE_SIZE_MB || '10') * 1024 * 1024,
  },

  plans: {
    starter:      { maxClients: 50,  maxInvoices: 200, maxUsers: 2 },
    professional: { maxClients: 500, maxInvoices: 2000, maxUsers: 10 },
    enterprise:   { maxClients: -1,  maxInvoices: -1,   maxUsers: -1 },
  },
};
