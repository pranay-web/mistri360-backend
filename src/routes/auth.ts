import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { companiesTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import { generateToken } from "../lib/jwt.js";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import rateLimit from "express-rate-limit";

const JWT_COOKIE = "fleet_token";

const router: IRouter = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: false,
  sameSite: "lax" as const,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  path: "/",
};

// ── Rate limiting: max 10 login attempts per 15 minutes per IP ──────────────
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
  validate: { xForwardedForHeader: false, ip: false },
});

// ── Account lockout: track failed attempts per email (in-memory) ────────────
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface FailedAttempt {
  count: number;
  lastAttempt: number;
  lockedUntil: number | null;
}

const failedAttempts = new Map<string, FailedAttempt>();

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedAttempts) {
    if (now - entry.lastAttempt > LOCKOUT_DURATION_MS * 2) {
      failedAttempts.delete(key);
    }
  }
}, 30 * 60 * 1000);

function checkAccountLockout(email: string): string | null {
  const entry = failedAttempts.get(email);
  if (!entry) return null;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const remainingMs = entry.lockedUntil - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    return `Account is temporarily locked. Try again in ${remainingMin} minute(s).`;
  }
  // Lock expired — reset
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    failedAttempts.delete(email);
  }
  return null;
}

function recordFailedAttempt(email: string): void {
  const entry = failedAttempts.get(email) ?? { count: 0, lastAttempt: 0, lockedUntil: null };
  entry.count += 1;
  entry.lastAttempt = Date.now();
  if (entry.count >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  failedAttempts.set(email, entry);
}

function clearFailedAttempts(email: string): void {
  failedAttempts.delete(email);
}

// ── Sanitize input: strip HTML tags ─────────────────────────────────────────
function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

router.post("/auth/login", loginRateLimiter, async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ error: parsed.error.message }, "Login: invalid request body");
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const email = stripHtml(parsed.data.email).toLowerCase().trim();
  const { password } = parsed.data;
  const ip = req.ip;

  const lockoutMsg = checkAccountLockout(email);
  if (lockoutMsg) {
    logger.warn({ email, ip }, "Login: account locked due to failed attempts");
    res.status(429).json({ error: lockoutMsg });
    return;
  }

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  const user = users[0];
  if (!user) {
    recordFailedAttempt(email);
    logger.warn({ email, ip }, "Login failed: user not found");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!user.active) {
    logger.warn({ userId: user.id, email, ip }, "Login failed: account inactive");
    res.status(401).json({ error: "Account is inactive" });
    return;
  }

  if (user.role !== "platform_admin") {
    if (!user.companyId) {
      logger.warn({ userId: user.id, email, ip }, "Login failed: user not assigned to company");
      res.status(401).json({ error: "Account is not assigned to a company" });
      return;
    }
    const [company] = await db
      .select({ active: companiesTable.active })
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId))
      .limit(1);
    if (!company?.active) {
      logger.warn({ userId: user.id, email, ip }, "Login failed: company inactive");
      res.status(401).json({ error: "Company access is inactive" });
      return;
    }
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    recordFailedAttempt(email);
    logger.warn({ email, ip, attempt: failedAttempts.get(email)?.count }, "Login failed: invalid password");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  clearFailedAttempts(email);
  logger.info({ userId: user.id, email, ip }, "Login successful");

  const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });
  res.cookie(JWT_COOKIE, token, COOKIE_OPTIONS);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    companyId: user.companyId,
  });
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie(JWT_COOKIE, { path: "/" });
  res.json({ message: "Logged out" });
});

router.get("/auth/me", requireAuth, (req, res) => {
  const u = req.user!;
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    companyId: u.companyId,
    companyName: u.companyName,
    companySlug: u.companySlug,
  });
});

export default router;

