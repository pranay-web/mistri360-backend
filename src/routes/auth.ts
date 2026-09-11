import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { companiesTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
} from "../lib/session.js";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  path: "/",
};

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { email, password } = parsed.data;

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  const user = users[0];
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!user.active) {
    res.status(401).json({ error: "Account is inactive" });
    return;
  }

  if (user.role !== "platform_admin") {
    if (!user.companyId) {
      res.status(401).json({ error: "Account is not assigned to a company" });
      return;
    }
    const [company] = await db
      .select({ active: companiesTable.active })
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId))
      .limit(1);
    if (!company?.active) {
      res.status(401).json({ error: "Company access is inactive" });
      return;
    }
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const sessionId = await createSession(user.id);
  res.cookie(SESSION_COOKIE, sessionId, COOKIE_OPTIONS);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    companyId: user.companyId,
  });
});

router.post("/auth/logout", async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (sessionId) {
    await deleteSession(sessionId);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
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
