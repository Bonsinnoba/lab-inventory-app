// API configuration is environment-driven so the same client can target
// localhost during development, a lab server on the LAN, or a production
// HTTPS endpoint without changing application source code.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(/\/$/, '');
export const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);
export const APP_ENV = import.meta.env.MODE || 'development';
