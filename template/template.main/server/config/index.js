const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables from .env file at the project root
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// Root directory of the application
const rootDir = path.resolve(__dirname, '../..');

const databasePath = path.resolve(rootDir, process.env.DATABASE_PATH || './storage/database.sqlite');
const backupDir = path.resolve(rootDir, process.env.BACKUP_DIR || './storage/backups');
const exportsDir = path.resolve(rootDir, process.env.EXPORTS_DIR || './storage/exports');
const uploadsDir = path.resolve(rootDir, process.env.UPLOADS_DIR || './storage/uploads');

// Security check: ensure storage paths are not inside the public/ or client/ folders
const publicDir = path.resolve(rootDir, './public');
const clientDir = path.resolve(rootDir, './client');

const checkSafety = (filePath, name) => {
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath.startsWith(publicDir)) {
    throw new Error(`Security Violation: Storage path '${name}' (${resolvedPath}) must not be inside public/ directory`);
  }
  if (resolvedPath.startsWith(clientDir)) {
    throw new Error(`Security Violation: Storage path '${name}' (${resolvedPath}) must not be inside client/ directory`);
  }
};

checkSafety(databasePath, 'DATABASE_PATH');
checkSafety(backupDir, 'BACKUP_DIR');
checkSafety(exportsDir, 'EXPORTS_DIR');
checkSafety(uploadsDir, 'UPLOADS_DIR');

// Storage safety: automatically ensure storage directories exist
const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

ensureDirExists(path.dirname(databasePath));
ensureDirExists(backupDir);
ensureDirExists(exportsDir);
ensureDirExists(uploadsDir);

const config = {
  env: nodeEnv,
  isProduction: isProd,
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || (isProd 
    ? (() => { throw new Error('SESSION_SECRET is required in production environment'); })()
    : 'insecure_development_session_secret'),
  databasePath,
  backupDir,
  exportsDir,
  uploadsDir,
  currency: 'EGP',
  timezone: 'Africa/Cairo',
};

module.exports = config;
