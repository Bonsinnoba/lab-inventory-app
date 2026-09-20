import { API_BASE, API_TIMEOUT_MS } from '../lib/config';
import { getToken, removeToken, removeStoredUser } from './auth';

const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Client', 'LabOS-Desktop');

  const method = (init.method || 'GET').toUpperCase();
  const maxAttempts = RETRYABLE_METHODS.has(method) ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const signal = init.signal;
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal });
      if (response.status === 401 && path !== '/auth/login' && path !== '/auth/register') {
        removeToken();
        removeStoredUser();
        window.dispatchEvent(new Event('labos:auth-expired'));
      }
      if (response.status >= 500 && attempt < maxAttempts && RETRYABLE_METHODS.has(method)) {
        await sleep(250 * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) throw error;
      await sleep(250 * attempt);
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('API request failed');
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = API_BASE.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  // Backend responses may already contain the public /api prefix. Avoid
  // producing URLs such as /api/api/media-downloads/....
  if (normalizedPath === '/api' || normalizedPath.startsWith('/api/')) {
    return base.endsWith('/api') ? `${base.slice(0, -4)}${normalizedPath}` : `${base}${normalizedPath}`;
  }
  return `${base}${normalizedPath}`;
}

export async function getApiErrorMessage(response: Response, fallback = 'Request failed'): Promise<string> {
  try {
    const body = await response.clone().json();
    const error = body?.error;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
    if (typeof body?.message === 'string' && body.message.trim()) return body.message;
    if (Array.isArray(body?.errors)) {
      const messages = body.errors.map((e: any) => typeof e === 'string' ? e : e?.message).filter(Boolean);
      if (messages.length) return messages.join(', ');
    }
  } catch { /* non-JSON response */ }
  return `${response.status ? `HTTP ${response.status}: ` : ''}${fallback}`;
}

export function normalizeClientError(error: unknown, fallback = 'Request failed'): Error {
  if (error instanceof Error && error.message && error.message !== '[object Object]') return error;
  if (typeof error === 'string' && error.trim()) return new Error(error);
  if (error && typeof error === 'object') {
    const e: any = error;
    const message = e.message || e.error?.message || e.error;
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}
