const fs = require('fs');
const path = require('path');
const dbHelper = require('./index');

const migrationsDir = path.join(__dirname, 'migrations');

async function runMigrations() {
  // 1. Ensure migrations tracking table exists
  await dbHelper.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // 2. Read migration files
  if (!fs.existsSync(migrationsDir)) {
    return;
  }
  
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();
  
  // 3. Get executed migrations
  const executedRows = await dbHelper.all('SELECT name FROM _migrations');
  const executedSet = new Set(executedRows.map(r => r.name));
  
  let migratedCount = 0;
  
  for (const file of files) {
    if (executedSet.has(file)) {
      continue;
    }
    
    console.log(`Running database migration: ${file}...`);
    const sqlPath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute SQL content
    try {
      await dbHelper.exec('PRAGMA foreign_keys = OFF;');
      await dbHelper.exec('BEGIN TRANSACTION;');
      await dbHelper.exec(sqlContent);
      const foreignKeyErrors = await dbHelper.all('PRAGMA foreign_key_check;');
      if (foreignKeyErrors.length > 0) {
        throw new Error(`Foreign key check failed during ${file}: ${JSON.stringify(foreignKeyErrors)}`);
      }
      await dbHelper.run('INSERT INTO _migrations (name) VALUES (?)', [file]);
      await dbHelper.exec('COMMIT;');
      await dbHelper.exec('PRAGMA foreign_keys = ON;');
      console.log(`✓ Migration ${file} executed successfully.`);
      migratedCount++;
    } catch (err) {
      try {
        await dbHelper.exec('ROLLBACK;');
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      await dbHelper.exec('PRAGMA foreign_keys = ON;');
      console.error(`❌ Migration ${file} failed:`, err);
      process.exit(1);
    }
  }
  
  if (migratedCount > 0) {
    console.log(`--- Migration finished: ${migratedCount} new migration(s) executed ---`);
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      dbHelper.db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Migration crashed:', err);
      process.exit(1);
    });
}

module.exports = runMigrations;
