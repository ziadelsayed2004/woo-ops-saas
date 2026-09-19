const fs = require('fs');
const path = require('path');
const config = require('../../config');

let lastBackupDate = '';

function scheduleAutoBackups() {
  console.log('⏳ Automated Daily Backup Scheduler started (triggers daily at 2:00 AM)...');
  
  // Run check every 30 seconds
  globalThis.setInterval(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const dateString = now.toISOString().slice(0, 10); // YYYY-MM-DD

    if (currentHour === 2 && currentMin === 0 && lastBackupDate !== dateString) {
      console.log('⏰ Auto Backup Scheduler: It is 2:00 AM, triggering database backup...');
      try {
        const dbFile = config.databasePath;
        const backupDir = config.backupDir;

        if (fs.existsSync(dbFile)) {
          if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
          }

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupFileName = `backup_${timestamp}.sqlite`;
          const backupPath = path.join(backupDir, backupFileName);

          fs.copyFileSync(dbFile, backupPath);
          console.log(`✅ Auto Backup Success: Database backed up to ${backupFileName}`);
          lastBackupDate = dateString;
        } else {
          console.error('❌ Auto Backup Error: Source database file not found.');
        }
      } catch (err) {
        console.error('❌ Auto Backup Failure:', err);
      }
    }
  }, 30000);
}

module.exports = {
  scheduleAutoBackups
};
