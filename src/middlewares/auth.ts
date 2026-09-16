import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { companiesTable, usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "../lib/jwt.js";

const JWT_COOKIE = "fleet_token";

export type AuthenticatedUser = {
  id: number;
  name: string;
  email: string;
  role: "platform_admin" | "admin" | "manager" | "mechanic" | "driver";
  phone: string | null;
  active: boolean;
  companyId: number | null;
  companyName: string | null;
  companySlug: string | null;
  companyActive: boolean | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.[JWT_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.clearCookie(JWT_COOKIE);
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      phone: usersTable.phone,
      active: usersTable.active,
      companyId: usersTable.companyId,
      companyName: companiesTable.name,
      companySlug: companiesTable.slug,
      companyActive: companiesTable.active,
    })
    .from(usersTable)
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  const user = users[0];
  if (!user || !user.active) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  if (user.role !== "platform_admin" && (!user.companyId || !user.companyActive)) {
    res.status(401).json({ error: "Company access is inactive" });
    return;
  }

  req.user = user as AuthenticatedUser;
  next();
}

export function requireRole(...roles: AuthenticatedUser["role"][]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    await requireAuth(req, res, async () => {
      const userRole = req.user?.role;
      const hasRole = userRole
        ? roles.includes(userRole) || (userRole === "mechanic" && roles.includes("admin"))
        : false;
      if (!hasRole) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    });
  };
}

/** Use for tenant-facing routes. Platform staff have no implicit company context. */
export function requireOperationalAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  return requireAuth(req, res, () => {
    if (
      !req.user ||
      req.user.role === "platform_admin" ||
      req.user.companyId === null
    ) {
      res.status(403).json({ error: "A company account is required" });
      return;
    }
    next();
  });
}

export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  return requireAuth(req, res, () => {
    if (!req.user || req.user.role !== "platform_admin") {
      res.status(403).json({ error: "Platform administrator access required" });
      return;
    }
    next();
  });
}
