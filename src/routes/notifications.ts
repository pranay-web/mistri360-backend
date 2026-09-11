import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userNotificationsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

// ── Get current user's notifications ──────────────────────────────────────────

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const notifications = await db
    .select()
    .from(userNotificationsTable)
    .where(eq(userNotificationsTable.userId, req.user!.id))
    .orderBy(desc(userNotificationsTable.createdAt))
    .limit(50);
  res.json(notifications);
});

// ── Get unread count ──────────────────────────────────────────────────────────

router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const { sql } = await import("drizzle-orm");
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userNotificationsTable)
    .where(and(
      eq(userNotificationsTable.userId, req.user!.id),
      eq(userNotificationsTable.isRead, false)
    ));
  res.json({ count: row?.count ?? 0 });
});

// ── Mark single notification as read ─────────────────────────────────────────

router.post("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [notif] = await db.select().from(userNotificationsTable).where(eq(userNotificationsTable.id, id));
  if (!notif || notif.userId !== req.user!.id) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db
    .update(userNotificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(userNotificationsTable.id, id))
    .returning();
  res.json(updated);
});

// ── Mark all as read ──────────────────────────────────────────────────────────

router.post("/notifications/mark-all-read", requireAuth, async (req, res): Promise<void> => {
  await db
    .update(userNotificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(and(
      eq(userNotificationsTable.userId, req.user!.id),
      eq(userNotificationsTable.isRead, false)
    ));
  res.json({ ok: true });
});

export default router;
