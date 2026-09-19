const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

// Resolve db path from env directly, without loading config/index which might trigger imports
const rootDir = path.resolve(__dirname, '../..');
const dbFile = path.resolve(rootDir, process.env.DATABASE_PATH || './storage/database.sqlite');

console.log('--- Database Reset Starting ---');
if (fs.existsSync(dbFile)) {
  console.log(`Deleting existing database file: ${dbFile}`);
  try {
    fs.unlinkSync(dbFile);
    console.log('✓ Database file deleted successfully.');
  } catch (err) {
    console.error(`❌ Failed to delete database file: ${err.message}`);
    process.exit(1);
  }
}

// Now we can safely import everything else!
const runMigrations = require('./migrate');
const seed = require('./seeds/dev_seed');

async function resetDb() {
  try {
    await runMigrations();
    await seed();
    console.log('--- Database Reset & Seed Completed Successfully ---');
  } catch (err) {
    console.error('❌ Database reset failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  resetDb()
    .then(() => {
      const dbHelper = require('./index');
      dbHelper.db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Reset crashed:', err);
      process.exit(1);
    });
}

module.exports = resetDb;
