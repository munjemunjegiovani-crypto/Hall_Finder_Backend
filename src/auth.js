import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

export const signToken = (user) => jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '14d' });

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    schoolId: u.school_id,
    department: u.department,
    level: u.level,
    language: u.language,
    theme: u.theme,
    reminderMinutes: u.reminder_minutes,
    notifyPush: !!u.notify_push,
    notifyEmail: !!u.notify_email,
    accessibleRoutes: !!u.accessible_routes,
    onboarded: !!u.onboarded,
  };
}

/** Attaches req.user when a valid Bearer token is sent. Never rejects by itself. */
export function authenticate(db) {
  return (req, _res, next) => {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(h.slice(7), SECRET);
        req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id) || null;
      } catch {
        req.user = null;
      }
    }
    next();
  };
}

export const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'unauthorized', message: 'Please sign in.' });

export const requireRole = (...roles) => (req, res, next) =>
  !req.user
    ? res.status(401).json({ error: 'unauthorized', message: 'Please sign in.' })
    : roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'forbidden', message: 'You do not have access to this.' });

// Tiny in-memory limiter for login attempts (per IP + email).
const attempts = new Map();
export function loginLimiter(req, res, next) {
  const key = `${req.ip}|${String(req.body?.email || '').toLowerCase()}`;
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (rec.length >= 12) return res.status(429).json({ error: 'too_many', message: 'Too many attempts. Try again in a few minutes.' });
  rec.push(now);
  attempts.set(key, rec);
  next();
}
