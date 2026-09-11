import crypto from 'node:crypto';

const buckets = new Map();

function cleanup(now) {
  if (buckets.size < 5000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[A-Za-z0-9._:-]{8,100}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function rateLimit({ windowMs, max, keyGenerator = (req) => req.ip || 'unknown', message = 'Too many requests. Try again later.' }) {
  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);
    const key = keyGenerator(req);
    const existing = buckets.get(key);
    const entry = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;
    entry.count += 1;
    buckets.set(key, entry);

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    }
    next();
  };
}

export function loginRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => `${req.ip || 'unknown'}:${String(req.body?.username || '').trim().toLowerCase()}`,
    message: 'Too many login attempts. Try again in a few minutes.',
  });
}

export function apiRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    keyGenerator: (req) => req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip || 'unknown'}`,
  });
}

export function requestTimeout(timeoutMs) {
  return (req, res, next) => {
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        res.status(408).json({
          error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out', request_id: req.requestId },
        });
      }
      req.destroy();
    });
    next();
  };
}
