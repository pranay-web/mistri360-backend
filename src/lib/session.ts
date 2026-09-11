import { db } from "@workspace/db";
import { companiesTable, sessionsTable, usersTable } from "@workspace/db/schema";
import { eq, and, gt } from "drizzle-orm";
import crypto from "crypto";

export const SESSION_COOKIE = "fleet_session";
const SESSION_TTL_DAYS = 7;

export async function createSession(userId: number): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);

  await db.insert(sessionsTable).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return sessionId;
}

export async function getSessionUser(sessionId: string) {
  const rows = await db
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
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        gt(sessionsTable.expiresAt, new Date())
      )
    )
    .limit(1);

  const user = rows[0];
  if (!user || !user.active) return null;
  if (user.role !== "platform_admin" && (!user.companyId || !user.companyActive)) return null;
  return user;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
}
