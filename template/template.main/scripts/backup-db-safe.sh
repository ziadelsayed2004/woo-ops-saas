#!/bin/bash

# --- Database Safe Backup Script ---
# This script performs a transaction-safe backup of the SQLite database using sqlite3 CLI.
# It also prunes backups older than 30 days.

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default paths
DATABASE_PATH="./storage/database.sqlite"
BACKUP_DIR="./storage/backups"

# Parse values from .env if it exists
if [ -f "$PROJECT_ROOT/.env" ]; then
  # Extract lines starting with DATABASE_PATH or BACKUP_DIR
  ENV_DB_PATH=$(grep -E "^DATABASE_PATH=" "$PROJECT_ROOT/.env" | cut -d'=' -f2- | tr -d '\r' | tr -d '"' | tr -d "'")
  ENV_BACKUP_DIR=$(grep -E "^BACKUP_DIR=" "$PROJECT_ROOT/.env" | cut -d'=' -f2- | tr -d '\r' | tr -d '"' | tr -d "'")
  
  if [ -n "$ENV_DB_PATH" ]; then
    DATABASE_PATH="$ENV_DB_PATH"
  fi
  if [ -n "$ENV_BACKUP_DIR" ]; then
    BACKUP_DIR="$ENV_BACKUP_DIR"
  fi
fi

# Resolve relative paths to absolute paths
if [[ "$DATABASE_PATH" != /* ]]; then
  DATABASE_PATH="${PROJECT_ROOT}/${DATABASE_PATH}"
fi
if [[ "$BACKUP_DIR" != /* ]]; then
  BACKUP_DIR="${PROJECT_ROOT}/${BACKUP_DIR}"
fi

# Ensure database file exists
if [ ! -f "$DATABASE_PATH" ]; then
  echo "[$(date)] ❌ Error: Database file not found at $DATABASE_PATH" >&2
  exit 1
fi

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Generate timestamp and backup filename
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sqlite"

echo "[$(date)] ⏳ Starting database backup..."
echo "Source: $DATABASE_PATH"
echo "Destination: $BACKUP_FILE"

# Check if sqlite3 is installed
if command -v sqlite3 >/dev/null 2>&1; then
  # Perform safe backup using SQLite .backup command
  sqlite3 "$DATABASE_PATH" ".backup '$BACKUP_FILE'"
  BACKUP_STATUS=$?
else
  # Fallback to file copy if sqlite3 CLI is not available (not recommended for production)
  echo "[$(date)] ⚠️ Warning: sqlite3 CLI not found. Falling back to copy operation..."
  cp "$DATABASE_PATH" "$BACKUP_FILE"
  BACKUP_STATUS=$?
fi

if [ $BACKUP_STATUS -eq 0 ]; then
  echo "[$(date)] ✅ Success: Backup created successfully at $BACKUP_FILE"
  
  # Prune backups older than 30 days
  echo "[$(date)] ⏳ Cleaning up backups older than 30 days in $BACKUP_DIR..."
  find "$BACKUP_DIR" -name "backup_*.sqlite" -type f -mtime +30 -exec rm -f {} \;
  echo "[$(date)] ✅ Cleanup complete."
else
  echo "[$(date)] ❌ Error: Database backup failed." >&2
  exit 1
fi
