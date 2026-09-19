const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const config = require('./server/config');
const apiRoutes = require('./server/routes');

const app = express();

// Trust proxy if running behind Nginx reverse proxy in production
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Session middleware configuration
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.isProduction ? 'auto' : false, // Auto-detect secure HTTPS in production, allow HTTP fallback
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: config.env,
    storage: {
      database: fs.existsSync(config.databasePath) ? 'initialized' : 'missing',
      backups: fs.existsSync(config.backupDir) ? 'accessible' : 'inaccessible',
      uploads: fs.existsSync(config.uploadsDir) ? 'accessible' : 'inaccessible',
      exports: fs.existsSync(config.exportsDir) ? 'accessible' : 'inaccessible'
    }
  });
});

// Mount API routes
app.use('/api', apiRoutes);

// Serve static assets from public/ folder
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to serve the single page app (SPA) React frontend
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send('Bookstore Manager Modernized API is running. Client build is pending.');
  }
});

const { scheduleAutoBackups } = require('./server/modules/admin/backupScheduler');
const { scheduleInvoiceTrashCleanup } = require('./server/modules/invoices/invoiceTrashScheduler');
const runMigrations = require('./server/db/migrate');

// Start the server if this file is run directly
if (require.main === module) {
  const port = config.port;
  runMigrations()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server is running on port ${port} in ${config.env} mode`);
        // Start automated daily backup scheduler (triggers daily at 2:00 AM)
        scheduleAutoBackups();
        scheduleInvoiceTrashCleanup();
      });
    })
    .catch((err) => {
      console.error('Failed to run database migrations, server startup aborted:', err);
      process.exit(1);
    });
}

module.exports = app;
