import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Reads PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD from environment
// automatically — no need to pass them explicitly.
export const pool = new Pool({
  max: Number(process.env.PGPOOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || 5000),
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
  process.exit(1);
});
