import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  workOrdersTable,
  partsUsedTable,
  usersTable,
  defectsTable,
  pmcviRecordsTable,
  usInspectionRecordsTable,
  roadsideViolationsTable,
} from "@workspace/db/schema";
import { eq, and, count, sql, gte, lte, desc, asc, isNotNull, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const router: IRouter = Router();

let reportBrandLogo: Buffer | null | undefined;
function getReportBrandLogo() {
  if (reportBrandLogo !== undefined) return reportBrandLogo;
  try { reportBrandLogo = readFileSync(join(__dirname, "assets", "mistri360-logo.png")); }
  catch { reportBrandLogo = null; }
  return reportBrandLogo;
}

// Reject tenant-external report filters rather than silently accepting guessed IDs.
router.use("/reports", requireAuth, async (req, res, next) => {
  const rawVehicleId = req.query.vehicleId;
  const rawMechanicId = req.query.mechanicId;
  const vehicleId = rawVehicleId == null ? null : Number(Array.isArray(rawVehicleId) ? rawVehicleId[0] : rawVehicleId);
  const mechanicId = rawMechanicId == null ? null : Number(Array.isArray(rawMechanicId) ? rawMechanicId[0] : rawMechanicId);
  if ((vehicleId !== null && (!Number.isInteger(vehicleId) || vehicleId <= 0)) ||
      (mechanicId !== null && (!Number.isInteger(mechanicId) || mechanicId <= 0))) {
    res.status(400).json({ error: "Invalid report filter" });
    return;
  }
  if (vehicleId !== null) {
    const [vehicle] = await db.select({ id: vehiclesTable.id }).from(vehiclesTable)
      .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.companyId, req.user!.companyId!))).limit(1);
    if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  }
  if (mechanicId !== null) {
    const [mechanic] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, mechanicId), eq(usersTable.companyId, req.user!.companyId!))).limit(1);
    if (!mechanic) { res.status(404).json({ error: "Mechanic not found" }); return; }
  }
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDateRange(query: any): { from: string; to: string } {
  const now = new Date();
  return {
    from: (query.from as string) ?? new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split("T")[0],
    to: (query.to as string) ?? now.toISOString().split("T")[0],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA FUNCTIONS — called by both JSON routes and PDF/Excel routes directly
// ══════════════════════════════════════════════════════════════════════════════

async function fetchMaintenanceHistory(params: {
  from: string; to: string; companyId: number; vehicleId?: number | null; effectiveMechanicId?: number | null;
}) {
  const conditions: any[] = [
    eq(workOrdersTable.companyId, params.companyId),
    gte(workOrdersTable.createdAt, new Date(params.from)),
    lte(workOrdersTable.createdAt, new Date(params.to + "T23:59:59")),
  ];
  if (params.vehicleId) conditions.push(eq(workOrdersTable.vehicleId, params.vehicleId));
  if (params.effectiveMechanicId) conditions.push(eq(workOrdersTable.assignedMechanicId, params.effectiveMechanicId));

  return db
    .select({
      id: workOrdersTable.id,
      woNumber: workOrdersTable.woNumber,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      vehicleMake: vehiclesTable.make,
      vehicleModel: vehiclesTable.model,
      workOrderType: workOrdersTable.workOrderType,
      status: workOrdersTable.status,
      priority: workOrdersTable.priority,
      mechanicName: usersTable.name,
      odometerAtService: workOrdersTable.odometerAtService,
      scheduledDate: workOrdersTable.scheduledDate,
      startedAt: workOrdersTable.startedAt,
      completedAt: workOrdersTable.completedAt,
      totalLabourHours: workOrdersTable.totalLabourHours,
      totalPartsCost: workOrdersTable.totalPartsCost,
      createdAt: workOrdersTable.createdAt,
    })
    .from(workOrdersTable)
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .leftJoin(usersTable, eq(workOrdersTable.assignedMechanicId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(workOrdersTable.createdAt));
}

async function fetchPmCompliance(companyId: number) {
  const today = new Date().toISOString().split("T")[0];
  const vehicles = await db
    .select({
      id: vehiclesTable.id,
      unitNumber: vehiclesTable.unitNumber,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      vehicleType: vehiclesTable.vehicleType,
      status: vehiclesTable.status,
      pm1DueDate: vehiclesTable.pm1DueDate,
      pm2DueDate: vehiclesTable.pm2DueDate,
      currentOdometer: vehiclesTable.currentOdometer,
    })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.companyId, companyId))
    .orderBy(vehiclesTable.unitNumber);

  const [lastPm1, lastPm2] = await Promise.all([
    db.select({ vehicleId: workOrdersTable.vehicleId, completedAt: sql<string>`MAX(${workOrdersTable.completedAt})` })
      .from(workOrdersTable)
      .where(and(eq(workOrdersTable.companyId, companyId), eq(workOrdersTable.workOrderType, "pm1"), eq(workOrdersTable.status, "completed")))
      .groupBy(workOrdersTable.vehicleId),
    db.select({ vehicleId: workOrdersTable.vehicleId, completedAt: sql<string>`MAX(${workOrdersTable.completedAt})` })
      .from(workOrdersTable)
      .where(and(eq(workOrdersTable.companyId, companyId), eq(workOrdersTable.workOrderType, "pm2"), eq(workOrdersTable.status, "completed")))
      .groupBy(workOrdersTable.vehicleId),
  ]);

  const pm1Map = Object.fromEntries(lastPm1.map((r) => [r.vehicleId, r.completedAt]));
  const pm2Map = Object.fromEntries(lastPm2.map((r) => [r.vehicleId, r.completedAt]));

  const rows = vehicles.map((v) => {
    const pm1Days = v.pm1DueDate ? Math.round((new Date(v.pm1DueDate).getTime() - Date.now()) / 86_400_000) : null;
    const pm2Days = v.pm2DueDate ? Math.round((new Date(v.pm2DueDate).getTime() - Date.now()) / 86_400_000) : null;
    const pm1Status = pm1Days === null ? "no_schedule" : pm1Days < 0 ? "overdue" : pm1Days <= 14 ? "due_soon" : "ok";
    const pm2Status = pm2Days === null ? "no_schedule" : pm2Days < 0 ? "overdue" : pm2Days <= 14 ? "due_soon" : "ok";
    return {
      vehicleId: v.id, unitNumber: v.unitNumber, make: v.make, model: v.model,
      type: v.vehicleType, vehicleStatus: v.status, currentOdometer: v.currentOdometer,
      pm1DueDate: v.pm1DueDate, pm1Status, pm1DaysUntilDue: pm1Days, lastPm1Completed: pm1Map[v.id] ?? null,
      pm2DueDate: v.pm2DueDate, pm2Status, pm2DaysUntilDue: pm2Days, lastPm2Completed: pm2Map[v.id] ?? null,
    };
  });

  const compliantCount = rows.filter((r) => r.pm1Status === "ok" || r.pm1Status === "due_soon").length;
  return {
    rows,
    summary: {
      total: rows.length,
      compliant: compliantCount,
      pm1Overdue: rows.filter((r) => r.pm1Status === "overdue").length,
      pm2Overdue: rows.filter((r) => r.pm2Status === "overdue").length,
      complianceRate: rows.length > 0 ? Math.round((compliantCount / rows.length) * 100) : 0,
    },
  };
}

async function fetchOpenDefects(companyId: number, vehicleId?: number | null) {
  const conditions: any[] = [eq(vehiclesTable.companyId, companyId), inArray(defectsTable.status, ["open", "assigned", "restricted"])];
  if (vehicleId) conditions.push(eq(defectsTable.vehicleId, vehicleId));
  return db
    .select({
      id: defectsTable.id,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      vehicleMake: vehiclesTable.make,
      vehicleModel: vehiclesTable.model,
      source: defectsTable.source,
      severity: defectsTable.severity,
      status: defectsTable.status,
      description: defectsTable.description,
      location: defectsTable.location,
      reportedByName: usersTable.name,
      odometerAtReport: defectsTable.odometerAtReport,
      createdAt: defectsTable.createdAt,
      agedays: sql<number>`EXTRACT(DAY FROM NOW() - ${defectsTable.createdAt})::int`,
    })
    .from(defectsTable)
    .leftJoin(vehiclesTable, eq(defectsTable.vehicleId, vehiclesTable.id))
    .leftJoin(usersTable, eq(defectsTable.reportedByUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(defectsTable.severity), asc(defectsTable.createdAt));
}

async function fetchOutOfService(companyId: number, from: string, to: string) {
  return db
    .select({
      id: defectsTable.id,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      vehicleMake: vehiclesTable.make,
      vehicleModel: vehiclesTable.model,
      description: defectsTable.description,
      location: defectsTable.location,
      status: defectsTable.status,
      reportedByName: usersTable.name,
      resolutionNotes: defectsTable.resolutionNotes,
      repairedAt: defectsTable.repairedAt,
      createdAt: defectsTable.createdAt,
      downtimeDays: sql<number>`CASE WHEN ${defectsTable.repairedAt} IS NOT NULL THEN EXTRACT(DAY FROM ${defectsTable.repairedAt} - ${defectsTable.createdAt})::int ELSE EXTRACT(DAY FROM NOW() - ${defectsTable.createdAt})::int END`,
    })
    .from(defectsTable)
    .leftJoin(vehiclesTable, eq(defectsTable.vehicleId, vehiclesTable.id))
    .leftJoin(usersTable, eq(defectsTable.reportedByUserId, usersTable.id))
    .where(and(
      eq(vehiclesTable.companyId, companyId),
      eq(defectsTable.severity, "out_of_service"),
      gte(defectsTable.createdAt, new Date(from)),
      lte(defectsTable.createdAt, new Date(to + "T23:59:59")),
    ))
    .orderBy(desc(defectsTable.createdAt));
}

async function fetchMechanicProductivity(companyId: number, from: string, to: string) {
  const rows = await db
    .select({
      mechanicId: workOrdersTable.assignedMechanicId,
      mechanicName: usersTable.name,
      jobsCompleted: count(),
      totalLabourHours: sql<string>`COALESCE(SUM(CAST(${workOrdersTable.totalLabourHours} AS NUMERIC)), 0)`,
      avgLabourHoursPerJob: sql<string>`COALESCE(AVG(CAST(${workOrdersTable.totalLabourHours} AS NUMERIC)), 0)`,
      totalPartsCost: sql<string>`COALESCE(SUM(CAST(${workOrdersTable.totalPartsCost} AS NUMERIC)), 0)`,
      breakdownJobs: sql<number>`COUNT(*) FILTER (WHERE ${workOrdersTable.workOrderType} = 'breakdown')::int`,
      pm1Jobs: sql<number>`COUNT(*) FILTER (WHERE ${workOrdersTable.workOrderType} = 'pm1')::int`,
      pm2Jobs: sql<number>`COUNT(*) FILTER (WHERE ${workOrdersTable.workOrderType} = 'pm2')::int`,
    })
    .from(workOrdersTable)
    .leftJoin(usersTable, eq(workOrdersTable.assignedMechanicId, usersTable.id))
    .where(and(
      eq(workOrdersTable.companyId, companyId),
      eq(workOrdersTable.status, "completed"),
      isNotNull(workOrdersTable.assignedMechanicId),
      gte(workOrdersTable.createdAt, new Date(from)),
      lte(workOrdersTable.createdAt, new Date(to + "T23:59:59")),
    ))
    .groupBy(workOrdersTable.assignedMechanicId, usersTable.name)
    .orderBy(desc(count()));

  return rows.map((r) => ({
    mechanicId: r.mechanicId,
    mechanicName: r.mechanicName ?? "Unknown",
    jobsCompleted: Number(r.jobsCompleted),
    totalLabourHours: parseFloat(r.totalLabourHours ?? "0"),
    avgLabourHoursPerJob: parseFloat(r.avgLabourHoursPerJob ?? "0"),
    totalPartsCost: parseFloat(r.totalPartsCost ?? "0"),
    breakdownJobs: Number(r.breakdownJobs),
    pm1Jobs: Number(r.pm1Jobs),
    pm2Jobs: Number(r.pm2Jobs),
  }));
}

async function fetchMaintenanceCost(companyId: number, from: string, to: string, vehicleId?: number | null) {
  const conditions: any[] = [
    eq(workOrdersTable.companyId, companyId),
    gte(workOrdersTable.createdAt, new Date(from)),
    lte(workOrdersTable.createdAt, new Date(to + "T23:59:59")),
    eq(workOrdersTable.status, "completed"),
  ];
  if (vehicleId) conditions.push(eq(workOrdersTable.vehicleId, vehicleId));

  const rows = await db
    .select({
      vehicleId: workOrdersTable.vehicleId,
      unitNumber: vehiclesTable.unitNumber,
      make: vehiclesTable.make,
      workOrderType: workOrdersTable.workOrderType,
      jobCount: count(),
      totalLabourHours: sql<string>`COALESCE(SUM(CAST(${workOrdersTable.totalLabourHours} AS NUMERIC)), 0)`,
      totalPartsCost: sql<string>`COALESCE(SUM(CAST(${workOrdersTable.totalPartsCost} AS NUMERIC)), 0)`,
      estimatedLabourCost: sql<string>`COALESCE(SUM(CAST(${workOrdersTable.totalLabourHours} AS NUMERIC) * 85), 0)`,
    })
    .from(workOrdersTable)
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .where(and(...conditions))
    .groupBy(workOrdersTable.vehicleId, vehiclesTable.unitNumber, vehiclesTable.make, workOrdersTable.workOrderType)
    .orderBy(vehiclesTable.unitNumber);

  return rows.map((r) => ({
    vehicleId: r.vehicleId,
    unitNumber: r.unitNumber ?? "—",
    make: r.make ?? "—",
    workOrderType: r.workOrderType,
    jobCount: Number(r.jobCount),
    totalLabourHours: parseFloat(r.totalLabourHours ?? "0"),
    totalPartsCost: parseFloat(r.totalPartsCost ?? "0"),
    estimatedLabourCost: parseFloat(r.estimatedLabourCost ?? "0"),
    totalCost: parseFloat(r.totalPartsCost ?? "0") + parseFloat(r.estimatedLabourCost ?? "0"),
  }));
}

async function fetchRoadsideViolations(companyId: number, from: string, to: string, vehicleId?: number | null) {
  const conditions: any[] = [
    eq(vehiclesTable.companyId, companyId),
    gte(roadsideViolationsTable.createdAt, new Date(from)),
    lte(roadsideViolationsTable.createdAt, new Date(to + "T23:59:59")),
  ];
  if (vehicleId) conditions.push(eq(roadsideViolationsTable.vehicleId, vehicleId));

  return db
    .select({
      id: roadsideViolationsTable.id,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      vehicleMake: vehiclesTable.make,
      vehicleModel: vehiclesTable.model,
      inspectionDate: roadsideViolationsTable.inspectionDate,
      inspectionLocation: roadsideViolationsTable.inspectionLocation,
      violationCode: roadsideViolationsTable.violationCode,
      violationDescription: roadsideViolationsTable.violationDescription,
      severity: roadsideViolationsTable.severity,
      correctiveAction: roadsideViolationsTable.correctiveAction,
      resolved: roadsideViolationsTable.resolved,
      resolvedAt: roadsideViolationsTable.resolvedAt,
      createdAt: roadsideViolationsTable.createdAt,
    })
    .from(roadsideViolationsTable)
    .leftJoin(vehiclesTable, eq(roadsideViolationsTable.vehicleId, vehiclesTable.id))
    .where(and(...conditions))
    .orderBy(desc(roadsideViolationsTable.inspectionDate));
}

async function fetchInspectionExpiry(companyId: number) {
  const vehicles = await db
    .select({
      id: vehiclesTable.id, unitNumber: vehiclesTable.unitNumber,
      make: vehiclesTable.make, model: vehiclesTable.model, status: vehiclesTable.status,
    })
    .from(vehiclesTable).where(eq(vehiclesTable.companyId, companyId)).orderBy(vehiclesTable.unitNumber);

  const latestPmcvi = await db
    .select({
      vehicleId: pmcviRecordsTable.vehicleId,
      expiryDate: sql<string>`MAX(${pmcviRecordsTable.expiryDate})`,
      isOfficiallyPassed: sql<boolean>`(array_agg(${pmcviRecordsTable.isOfficiallyPassed} ORDER BY ${pmcviRecordsTable.expiryDate} DESC))[1]`,
    })
    .from(pmcviRecordsTable).innerJoin(vehiclesTable, eq(pmcviRecordsTable.vehicleId, vehiclesTable.id))
    .where(eq(vehiclesTable.companyId, companyId)).groupBy(pmcviRecordsTable.vehicleId);

  const pmcviMap = Object.fromEntries(latestPmcvi.map((r) => [r.vehicleId, r]));

  return vehicles.map((v) => {
    const pmcvi = pmcviMap[v.id];
    const pmcviDays = pmcvi?.expiryDate ? Math.round((new Date(pmcvi.expiryDate).getTime() - Date.now()) / 86_400_000) : null;
    const pmcviStatus = pmcviDays === null ? "no_record" : pmcviDays < 0 ? "expired" : pmcviDays <= 30 ? "expiring_soon" : "valid";
    return {
      vehicleId: v.id, unitNumber: v.unitNumber, make: v.make, model: v.model, vehicleStatus: v.status,
      pmcviExpiryDate: pmcvi?.expiryDate ?? null, pmcviDaysRemaining: pmcviDays,
      pmcviStatus, pmcviOfficiallyPassed: pmcvi?.isOfficiallyPassed ?? null,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// JSON ROUTES
// ══════════════════════════════════════════════════════════════════════════════

router.get("/reports/maintenance-history", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const { from, to } = parseDateRange(req.query);
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : null;
  const mechanicId = req.query.mechanicId ? Number(req.query.mechanicId) : null;
  const effectiveMechanicId = req.user!.role === "mechanic" ? req.user!.id : mechanicId;
  res.json(await fetchMaintenanceHistory({ from, to, companyId: req.user!.companyId!, vehicleId, effectiveMechanicId }));
});

router.get("/reports/pm-compliance", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  res.json(await fetchPmCompliance(req.user!.companyId!));
});

router.get("/reports/open-defects", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : null;
  res.json(await fetchOpenDefects(req.user!.companyId!, vehicleId));
});

router.get("/reports/out-of-service", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const { from, to } = parseDateRange(req.query);
  res.json(await fetchOutOfService(req.user!.companyId!, from, to));
});

router.get("/reports/mechanic-productivity", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const { from, to } = parseDateRange(req.query);
  res.json(await fetchMechanicProductivity(req.user!.companyId!, from, to));
});

router.get("/reports/maintenance-cost", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const { from, to } = parseDateRange(req.query);
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : null;
  res.json(await fetchMaintenanceCost(req.user!.companyId!, from, to, vehicleId));
});

router.get("/reports/roadside-violations", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const { from, to } = parseDateRange(req.query);
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : null;
  res.json(await fetchRoadsideViolations(req.user!.companyId!, from, to, vehicleId));
});

router.get("/reports/inspection-expiry", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  res.json(await fetchInspectionExpiry(req.user!.companyId!));
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARED: resolve report data by type (no HTTP round-trip)
// ══════════════════════════════════════════════════════════════════════════════

const REPORT_TITLES: Record<string, string> = {
  "maintenance-history": "Vehicle Maintenance History",
  "pm-compliance": "PM Compliance Report",
  "open-defects": "Open Defect Report",
  "out-of-service": "Out-of-Service Report",
  "mechanic-productivity": "Mechanic Productivity Report",
  "maintenance-cost": "Maintenance Cost Report",
  "roadside-violations": "Roadside Violations Report",
  "inspection-expiry": "PMCVI Expiry Report",
};

async function resolveReportData(type: string, query: any, user: { id: number; role: string; companyId: number | null }): Promise<any[]> {
  const { from, to } = parseDateRange(query);
  const vehicleId = query.vehicleId ? Number(query.vehicleId) : null;

  switch (type) {
    case "maintenance-history": {
      const effectiveMechanicId = user.role === "mechanic" ? user.id : (query.mechanicId ? Number(query.mechanicId) : null);
      return fetchMaintenanceHistory({ from, to, companyId: user.companyId!, vehicleId, effectiveMechanicId });
    }
    case "pm-compliance": {
      const result = await fetchPmCompliance(user.companyId!);
      return result.rows;
    }
    case "open-defects":
      return fetchOpenDefects(user.companyId!, vehicleId);
    case "out-of-service":
      return fetchOutOfService(user.companyId!, from, to);
    case "mechanic-productivity":
      return fetchMechanicProductivity(user.companyId!, from, to);
    case "maintenance-cost":
      return fetchMaintenanceCost(user.companyId!, from, to, vehicleId);
    case "roadside-violations":
      return fetchRoadsideViolations(user.companyId!, from, to, vehicleId);
    case "inspection-expiry":
      return fetchInspectionExpiry(user.companyId!);
    default:
      throw new Error(`Unknown report type: ${type}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF EXPORT
// ══════════════════════════════════════════════════════════════════════════════

router.get("/reports/:type/pdf", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const type = Array.isArray(req.params.type) ? req.params.type[0] : req.params.type;
  const reportTitle = REPORT_TITLES[type];
  if (!reportTitle) { res.status(400).json({ error: "Unknown report type" }); return; }

  let reportData: any[];
  try {
    reportData = await resolveReportData(type, req.query, req.user!);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch report data" });
    return;
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-report.pdf"`);

  const doc = new PDFDocument({ margin: 50, size: "LETTER", layout: "landscape", bufferPages: true });
  doc.pipe(res);

  const W = doc.page.width - 100;

  const companyName = req.user!.companyName ?? "Company Workspace";
  const brandLogo = getReportBrandLogo();
  if (brandLogo) doc.image(brandLogo, 50, 49, { fit: [134, 34], valign: "center" });
  else {
    doc.fillColor("#58B936").fontSize(15).font("Helvetica-Bold").text("mistri360", 50, 58);
  }
  doc.fillColor("#334155").fontSize(9).font("Helvetica-Bold").text(companyName, 0, 49, { align: "right" });
  doc.fillColor("#94A3B8").fontSize(7).font("Helvetica").text("FLEET MAINTENANCE REPORT", 0, 65, { align: "right" });
  doc.fillColor("#0F172A").fontSize(20).font("Helvetica-Bold").text(reportTitle, 50, 92);
  doc.fillColor("#64748B").fontSize(8).font("Helvetica")
    .text(`Generated ${new Date().toLocaleString()}   •   ${reportData.length.toLocaleString()} records`, 50, 119);
  doc.moveTo(50, 137).lineTo(50 + W, 137).strokeColor("#CBD5E1").lineWidth(0.75).stroke();

  let y = 151;

  if (reportData.length === 0) {
    doc.fontSize(12).fillColor("#555").text("No data for this report.", 50, y);
  } else {
    const keys = Object.keys(reportData[0]).slice(0, 10);
    const colW = Math.floor(W / keys.length);

    // Column headers
    doc.rect(50, y, W, 20).fill("#E8EDF5");
    doc.fontSize(7).font("Helvetica-Bold").fillColor("#334155");
    keys.forEach((k, i) => {
      doc.text(
        k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(),
        50 + i * colW + 4, y + 6, { width: colW - 8, ellipsis: true }
      );
    });
    y += 22;

    // Data rows
    doc.font("Helvetica").fontSize(7);
    reportData.slice(0, 500).forEach((row, idx) => {
      if (y > doc.page.height - 60) { doc.addPage({ layout: "landscape" }); y = 50; }
      doc.rect(50, y, W, 17).fill(idx % 2 === 0 ? "#FFFFFF" : "#F8FAFC");
      doc.fillColor("#334155");
      keys.forEach((k, i) => {
        const val = row[k] ?? "—";
        const str = val instanceof Date ? val.toISOString().split("T")[0] : typeof val === "object" ? JSON.stringify(val) : String(val);
        doc.text(str.slice(0, 40), 50 + i * colW + 4, y + 5, { width: colW - 8, ellipsis: true });
      });
      y += 17;
    });
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.moveTo(50, doc.page.height - 35).lineTo(50 + W, doc.page.height - 35).strokeColor("#CBD5E1").lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor("#64748B")
      .text(`${companyName}   •   ${reportTitle}`, 50, doc.page.height - 27, { width: W / 2, align: "left" })
      .text(`CONFIDENTIAL   •   Page ${i + 1} of ${range.count}`, 50 + W / 2, doc.page.height - 27, { width: W / 2, align: "right" });
  }

  doc.end();
});

// ══════════════════════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ══════════════════════════════════════════════════════════════════════════════

router.get("/reports/:type/xlsx", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const type = Array.isArray(req.params.type) ? req.params.type[0] : req.params.type;
  const reportTitle = REPORT_TITLES[type];
  if (!reportTitle) { res.status(400).json({ error: "Unknown report type" }); return; }

  let reportData: any[];
  try {
    reportData = await resolveReportData(type, req.query, req.user!);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch report data" });
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const companyName = req.user!.companyName ?? "Company Workspace";
  workbook.creator = "mistri360 — A Trevion Technologies Product";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(reportTitle.slice(0, 31));

  sheet.mergeCells("A1:J1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = `mistri360 — ${companyName} — ${reportTitle}`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF1A3068" } };

  sheet.mergeCells("A2:J2");
  const subCell = sheet.getCell("A2");
  subCell.value = `Generated: ${new Date().toLocaleString()}   |   Records: ${reportData.length}`;
  subCell.font = { size: 9, color: { argb: "FF666666" } };

  if (reportData.length > 0) {
    const keys = Object.keys(reportData[0]);
    const headerRow = sheet.getRow(4);
    keys.forEach((k, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3068" } };
      cell.alignment = { horizontal: "center" };
    });

    reportData.forEach((row, rowIdx) => {
      const dataRow = sheet.getRow(5 + rowIdx);
      keys.forEach((k, i) => {
        const val = row[k];
        const cell = dataRow.getCell(i + 1);
        if (val === null || val === undefined) cell.value = "—";
        else if (typeof val === "number") cell.value = val;
        else if (val instanceof Date) cell.value = val.toISOString().split("T")[0];
        else cell.value = String(val);
        if (rowIdx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
      });
    });

    keys.forEach((k, i) => {
      const col = sheet.getColumn(i + 1);
      col.width = Math.min(40, Math.max(k.length + 4, ...reportData.slice(0, 100).map((r) => String(r[k] ?? "").length)));
    });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

export default router;
