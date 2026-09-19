const sqlite3 = require('sqlite3').verbose();
const config = require('../config');

console.log(`Connecting to SQLite database at: ${config.databasePath}`);

let activeDb = new sqlite3.Database(config.databasePath, (err) => {
  if (err) {
    console.log('❌ Error opening SQLite database:', err);
  } else {
    console.log('✅ SQLite database connected successfully');
    // Enable foreign keys
    activeDb.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
      if (pragmaErr) {
        console.log('Failed to enable PRAGMA foreign_keys:', pragmaErr);
      } else {
        console.log('✅ Enabled PRAGMA foreign_keys');
      }
    });
  }
});

// Promise wrappers
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    activeDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    activeDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    activeDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const exec = (sql) => {
  return new Promise((resolve, reject) => {
    activeDb.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const fs = require('fs');

/**
 * Safely restores the active database from a backup SQLite file.
 * Closes the active connection, copies the backup file, and reopens it.
 */
const restoreDatabase = (backupPath) => {
  return new Promise((resolve, reject) => {
    activeDb.close((err) => {
      if (err) {
        console.log('Error closing database before restore:', err);
        return reject(err);
      }
      try {
        fs.copyFileSync(backupPath, config.databasePath);
        // Reopen database connection
        activeDb = new sqlite3.Database(config.databasePath, (openErr) => {
          if (openErr) {
            console.log('Error reopening database after restore:', openErr);
            return reject(openErr);
          }
          activeDb.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
            if (pragmaErr) console.log('Failed to enable PRAGMA foreign_keys after restore:', pragmaErr);
            // Update the exported db reference
            module.exports.db = activeDb;
            resolve();
          });
        });
      } catch (copyErr) {
        // Fallback: try to reopen the original database
        activeDb = new sqlite3.Database(config.databasePath, () => {
          module.exports.db = activeDb;
        });
        reject(copyErr);
      }
    });
  });
};

module.exports = {
  db: activeDb,
  run,
  get,
  all,
  exec,
  restoreDatabase
};
