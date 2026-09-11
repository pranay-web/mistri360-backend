import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  defectsTable,
  pmcviRecordsTable,
  usInspectionRecordsTable,
  pmRemindersTable,
} from "@workspace/db/schema";
import { eq, and, count, lte, gte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import {
  DismissReminderParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/fleet/summary", requireAuth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  const thirtyDaysStr = in30Days.toISOString().split("T")[0];

  const [
    totalResult,
    availableResult,
    inRepairResult,
    oosResult,
    restrictedResult,
    overduePm1Result,
    overduePm2Result,
    openDefectsResult,
    pmcvi30Result,
    usAnnual30Result,
  ] = await Promise.all([
    db.select({ count: count() }).from(vehiclesTable).where(eq(vehiclesTable.companyId, req.user!.companyId!)),
    db
      .select({ count: count() })
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.companyId, req.user!.companyId!), eq(vehiclesTable.status, "available"))),
    db
      .select({ count: count() })
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.companyId, req.user!.companyId!), eq(vehiclesTable.status, "in_repair"))),
    db
      .select({ count: count() })
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.companyId, req.user!.companyId!), eq(vehiclesTable.status, "out_of_service"))),
    db
      .select({ count: count() })
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.companyId, req.user!.companyId!), eq(vehiclesTable.status, "restricted"))),
    db
      .select({ count: count() })
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.companyId, req.user!.companyId!),
          sql`${vehiclesTable.pm1DueDate} IS NOT NULL`,
          lte(vehiclesTable.pm1DueDate, today)
        )
      ),
    db
      .select({ count: count() })
      .from(vehiclesTable)
      .where(
        and(
          eq(vehiclesTable.companyId, req.user!.companyId!),
          sql`${vehiclesTable.pm2DueDate} IS NOT NULL`,
          lte(vehiclesTable.pm2DueDate, today)
        )
      ),
    db
      .select({ count: count() })
      .from(defectsTable)
      .where(
        sql`${defectsTable.status} IN ('open', 'assigned') AND ${defectsTable.vehicleId} IN (SELECT id FROM vehicles WHERE company_id = ${req.user!.companyId!})`
      ),
    db
      .select({ count: count() })
      .from(pmcviRecordsTable)
      .where(
        and(
          sql`${pmcviRecordsTable.vehicleId} IN (SELECT id FROM vehicles WHERE company_id = ${req.user!.companyId!})`,
          gte(pmcviRecordsTable.expiryDate, today),
          lte(pmcviRecordsTable.expiryDate, thirtyDaysStr)
        )
      ),
    db
      .select({ count: count() })
      .from(usInspectionRecordsTable)
      .where(
        and(
          sql`${usInspectionRecordsTable.vehicleId} IN (SELECT id FROM vehicles WHERE company_id = ${req.user!.companyId!})`,
          gte(usInspectionRecordsTable.expiryDate, today),
          lte(usInspectionRecordsTable.expiryDate, thirtyDaysStr)
        )
      ),
  ]);

  res.json({
    totalVehicles: Number(totalResult[0]?.count ?? 0),
    available: Number(availableResult[0]?.count ?? 0),
    inRepair: Number(inRepairResult[0]?.count ?? 0),
    outOfService: Number(oosResult[0]?.count ?? 0),
    restricted: Number(restrictedResult[0]?.count ?? 0),
    overduepm1: Number(overduePm1Result[0]?.count ?? 0),
    overduepm2: Number(overduePm2Result[0]?.count ?? 0),
    openDefects: Number(openDefectsResult[0]?.count ?? 0),
    upcomingPmcvi30Days: Number(pmcvi30Result[0]?.count ?? 0),
    upcomingUsAnnual30Days: Number(usAnnual30Result[0]?.count ?? 0),
  });
});

// ── GET /fleet/type-summary ───────────────────────────────────────────────────
// Returns separate status counts for trucks vs trailers (dry van + reefer)

router.get("/fleet/type-summary", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      vehicleType: vehiclesTable.vehicleType,
      status: vehiclesTable.status,
      cnt: count(),
    })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.companyId, req.user!.companyId!))
    .groupBy(vehiclesTable.vehicleType, vehiclesTable.status);

  type Bucket = { total: number; available: number; inRepair: number; outOfService: number; restricted: number };
  const empty = (): Bucket => ({ total: 0, available: 0, inRepair: 0, outOfService: 0, restricted: 0 });
  const trucks  = empty();
  const trailers = empty();

  for (const r of rows) {
    const n = Number(r.cnt);
    const isTruck   = r.vehicleType === "truck";
    const isTrailer = r.vehicleType === "trailer" || r.vehicleType === "reefer_trailer";
    const bucket = isTruck ? trucks : isTrailer ? trailers : null;
    if (!bucket) continue;
    bucket.total += n;
    if (r.status === "available")       bucket.available    += n;
    else if (r.status === "in_repair")  bucket.inRepair     += n;
    else if (r.status === "out_of_service") bucket.outOfService += n;
    else if (r.status === "restricted") bucket.restricted   += n;
  }

  res.json({ trucks, trailers });
});

// ── GET /fleet/reminders ──────────────────────────────────────────────────────

router.get("/fleet/reminders", requireAuth, async (req, res): Promise<void> => {
  const reminders = await db
    .select({
      id: pmRemindersTable.id,
      vehicleId: pmRemindersTable.vehicleId,
      unitNumber: vehiclesTable.unitNumber,
      pmType: pmRemindersTable.pmType,
      triggerType: pmRemindersTable.triggerType,
      dueDate: pmRemindersTable.dueDate,
      dueOdometer: pmRemindersTable.dueOdometer,
      dismissed: pmRemindersTable.dismissed,
      workOrderId: pmRemindersTable.workOrderId,
      createdAt: pmRemindersTable.createdAt,
    })
    .from(pmRemindersTable)
    .leftJoin(vehiclesTable, eq(pmRemindersTable.vehicleId, vehiclesTable.id))
    .where(and(eq(pmRemindersTable.dismissed, false), eq(vehiclesTable.companyId, req.user!.companyId!)))
    .orderBy(pmRemindersTable.createdAt);

  res.json(reminders);
});

// ── POST /fleet/reminders/:id/dismiss ────────────────────────────────────────

router.post("/fleet/reminders/:id/dismiss", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const parsed = DismissReminderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(pmRemindersTable)
    .set({ dismissed: true })
    .where(sql`${pmRemindersTable.id} = ${parsed.data.id} AND ${pmRemindersTable.vehicleId} IN (SELECT id FROM vehicles WHERE company_id = ${req.user!.companyId!})`)
    .returning({ id: pmRemindersTable.id });

  if (!updated) {
    res.status(404).json({ error: "Reminder not found" });
    return;
  }

  res.json({ message: "Reminder dismissed" });
});

export default router;
