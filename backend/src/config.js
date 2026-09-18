import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const jwtSecret = isProduction
  ? required('JWT_SECRET')
  : (process.env.JWT_SECRET || 'dev-only-change-me');

if (isProduction && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:1420',
  'http://tauri.localhost',
  'tauri://localhost',
  ...configuredOrigins,
].filter((origin, index, origins) => origins.indexOf(origin) === index);

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  apiVersion: process.env.API_VERSION || '1',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000),
  dbPoolMax: Number(process.env.PGPOOL_MAX || 20),
  dbIdleTimeoutMs: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30000),
  dbConnectionTimeoutMs: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || 5000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  allowedOrigins,
  storageDir: process.env.STORAGE_DIR,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 500),
  maxJsonMb: Number(process.env.MAX_JSON_MB || 2),
  aiMaxMessageLength: Number(process.env.AI_MAX_MESSAGE_LENGTH || 8000),
  aiMaxToolRounds: Number(process.env.AI_MAX_TOOL_ROUNDS || 5),
};
