import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  workOrdersTable,
  partsUsedTable,
  pmcviRecordsTable,
  usInspectionRecordsTable,
  defectsTable,
} from "@workspace/db/schema";
import { eq, and, count, sql, gte, lte, desc, max, isNotNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router: IRouter = Router();

// ── GET /dashboard/fleet-status ───────────────────────────────────────────────
// Returns vehicle counts per status (for bar chart)

router.get("/dashboard/fleet-status", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select({ status: vehiclesTable.status, count: count() })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.companyId, req.user!.companyId!))
    .groupBy(vehiclesTable.status);

  res.json(rows.map((r) => ({ status: r.status, count: Number(r.count) })));
});

// ── GET /dashboard/pm-compliance ──────────────────────────────────────────────
// Returns PM compliance summary for donut chart

router.get("/dashboard/pm-compliance", requireAuth, async (req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];

  const [total, pm1Overdue, pm2Overdue, pm1Ok, pm2Ok] = await Promise.all([
    db.select({ count: count() }).from(vehiclesTable).where(eq(vehiclesTable.companyId, req.user!.companyId!)),
    db.select({ count: count() }).from(vehiclesTable).where(
      and(eq(vehiclesTable.companyId, req.user!.companyId!), isNotNull(vehiclesTable.pm1DueDate), lte(vehiclesTable.pm1DueDate, today))
    ),
    db.select({ count: count() }).from(vehiclesTable).where(
      and(eq(vehiclesTable.companyId, req.user!.companyId!), isNotNull(vehiclesTable.pm2DueDate), lte(vehiclesTable.pm2DueDate, today))
    ),
    db.select({ count: count() }).from(vehiclesTable).where(
      and(eq(vehiclesTable.companyId, req.user!.companyId!), isNotNull(vehiclesTable.pm1DueDate), sql`${vehiclesTable.pm1DueDate} > ${today}`)
    ),
    db.select({ count: count() }).from(vehiclesTable).where(
      and(eq(vehiclesTable.companyId, req.user!.companyId!), isNotNull(vehiclesTable.pm2DueDate), sql`${vehiclesTable.pm2DueDate} > ${today}`)
    ),
  ]);

  const totalN = Number(total[0]?.count ?? 0);
  const pm1OverdueN = Number(pm1Overdue[0]?.count ?? 0);
  const pm2OverdueN = Number(pm2Overdue[0]?.count ?? 0);
  const pm1OkN = Number(pm1Ok[0]?.count ?? 0);
  const pm2OkN = Number(pm2Ok[0]?.count ?? 0);
  const noPm = totalN - pm1OkN - pm1OverdueN;

  res.json({
    total: totalN,
    pm1Overdue: pm1OverdueN,
    pm2Overdue: pm2OverdueN,
    compliant: pm1OkN + pm2OkN,
    noSchedule: noPm > 0 ? noPm : 0,
    slices: [
      { name: "PM1 Overdue", value: pm1OverdueN, color: "#DC2626" },
      { name: "PM2 Overdue", value: pm2OverdueN, color: "#F97316" },
      { name: "Compliant", value: Math.max(0, totalN - pm1OverdueN - pm2OverdueN), color: "#22C55E" },
    ],
  });
});

// ── GET /dashboard/vehicle-urgency ────────────────────────────────────────────
// Returns all vehicles sorted by most urgent PM/inspection date

router.get("/dashboard/vehicle-urgency", requireAuth, async (req, res): Promise<void> => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const vehicles = await db
    .select({
      id: vehiclesTable.id,
      unitNumber: vehiclesTable.unitNumber,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      status: vehiclesTable.status,
      pm1DueDate: vehiclesTable.pm1DueDate,
      pm2DueDate: vehiclesTable.pm2DueDate,
      pmcviDueDate: vehiclesTable.pmcviDueDate,
    })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.companyId, req.user!.companyId!))
    .orderBy(vehiclesTable.unitNumber);

  const result = vehicles.map((v) => {
    const dates = [v.pm1DueDate, v.pm2DueDate, v.pmcviDueDate].filter(Boolean);
    const daysArr = dates.map((d) => Math.round((new Date(d!).getTime() - today.getTime()) / 86_400_000));
    const minDays = daysArr.length > 0 ? Math.min(...daysArr) : null;

    let urgency: "critical" | "warning" | "ok" = "ok";
    if (minDays !== null) {
      if (minDays < 0) urgency = "critical";
      else if (minDays <= 30) urgency = "warning";
    }

    // Also critical if status is oos/restricted
    if (v.status === "out_of_service") urgency = "critical";
    else if (v.status === "restricted" && urgency !== "critical") urgency = "warning";

    return {
      id: v.id,
      unitNumber: v.unitNumber,
      make: v.make,
      model: v.model,
      status: v.status,
      pm1DueDate: v.pm1DueDate,
      pm2DueDate: v.pm2DueDate,
      pmcviDueDate: v.pmcviDueDate,
      minDaysUntilDue: minDays,
      urgency,
    };
  });

  // Sort: critical first, then warning, then ok, within each by minDays asc
  result.sort((a, b) => {
    const order = { critical: 0, warning: 1, ok: 2 };
    if (order[a.urgency] !== order[b.urgency]) return order[a.urgency] - order[b.urgency];
    if (a.minDaysUntilDue === null) return 1;
    if (b.minDaysUntilDue === null) return -1;
    return a.minDaysUntilDue - b.minDaysUntilDue;
  });

  res.json(result);
});

// ── GET /dashboard/summary-extended ──────────────────────────────────────────
// Extended summary including breakdowns + cost MTD

router.get("/dashboard/summary-extended", requireAuth, async (req, res): Promise<void> => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Start of current month
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];

  // 30 days ago
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

  const [breakdowns30d, costMtdParts, costMtdLabour] = await Promise.all([
    db.select({ count: count() }).from(workOrdersTable).where(
      and(
        eq(workOrdersTable.companyId, req.user!.companyId!),
        eq(workOrdersTable.workOrderType, "breakdown"),
        gte(workOrdersTable.createdAt, thirtyDaysAgo)
      )
    ),
    db.select({ total: sql<string>`COALESCE(SUM(total_cost), 0)` }).from(partsUsedTable)
      .leftJoin(workOrdersTable, eq(partsUsedTable.workOrderId, workOrdersTable.id))
      .where(and(eq(workOrdersTable.companyId, req.user!.companyId!), gte(workOrdersTable.createdAt, new Date(monthStart)))),
    db.select({ total: sql<string>`COALESCE(SUM(CAST(total_labour_hours AS NUMERIC) * 85), 0)` })
      .from(workOrdersTable)
      .where(
        and(
          eq(workOrdersTable.companyId, req.user!.companyId!),
          gte(workOrdersTable.createdAt, new Date(monthStart)),
          eq(workOrdersTable.status, "completed")
        )
      ),
  ]);

  res.json({
    breakdowns30Days: Number(breakdowns30d[0]?.count ?? 0),
    costMtd: Math.round((parseFloat(costMtdParts[0]?.total ?? "0") + parseFloat(costMtdLabour[0]?.total ?? "0")) * 100) / 100,
  });
});

export default router;
