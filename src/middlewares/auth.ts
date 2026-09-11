import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, getSessionUser } from "../lib/session.js";

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
  const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!sessionId) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const user = await getSessionUser(sessionId);
  if (!user) {
    res.clearCookie(SESSION_COOKIE);
    res.status(401).json({ error: "Session expired or invalid" });
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
