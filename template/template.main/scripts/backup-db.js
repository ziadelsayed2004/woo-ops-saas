const fs = require('fs');
const path = require('path');
const config = require('../server/config');

function runBackup() {
  console.log('--- Database Backup Service ---');
  try {
    const dbFile = config.databasePath;
    const backupDir = config.backupDir;

    console.log(`Source Database: ${dbFile}`);
    console.log(`Backup Directory: ${backupDir}`);

    if (!fs.existsSync(dbFile)) {
      console.error(`Error: Source database file does not exist at: ${dbFile}`);
      process.exit(1);
    }

    // Ensure the backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Generate dynamic timestamped backup file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup_${timestamp}.sqlite`;
    const backupPath = path.join(backupDir, backupFileName);

    // Copy SQLite database file
    fs.copyFileSync(dbFile, backupPath);
    console.log(`✅ Success: Backup created at ${backupPath}`);
  } catch (err) {
    console.error('❌ Error: Database backup failed:', err);
    process.exit(1);
  }
}

runBackup();
