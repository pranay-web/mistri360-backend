import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  pmcviRecordsTable,
  usInspectionRecordsTable,
  roadsideViolationsTable,
  vehiclesTable,
  usersTable,
  auditLogTable,
  userNotificationsTable,
  notificationSentLogTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router: IRouter = Router();
router.use("/vehicles/:id", requireAuth, async (req, res, next) => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [vehicle] = await db.select({ id: vehiclesTable.id }).from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, id), eq(vehiclesTable.companyId, req.user!.companyId!))).limit(1);
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  next();
});
async function tenantRecord(
  table: typeof pmcviRecordsTable | typeof usInspectionRecordsTable | typeof roadsideViolationsTable,
  id: number,
  companyId: number
) {
  return db.select({ id: table.id }).from(table).innerJoin(vehiclesTable, eq(table.vehicleId, vehiclesTable.id))
    .where(and(eq(table.id, id), eq(vehiclesTable.companyId, companyId))).limit(1);
}
for (const [path, table] of [
  ["/pmcvi/:id", pmcviRecordsTable],
  ["/us-inspections/:id", usInspectionRecordsTable],
  ["/roadside-violations/:id", roadsideViolationsTable],
] as const) {
  router.use(path, requireAuth, async (req, res, next) => {
    const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!(await tenantRecord(table, id, req.user!.companyId!))[0]) {
      res.status(404).json({ error: "Compliance record not found" }); return;
    }
    next();
  });
}

// ─── PMCVI ────────────────────────────────────────────────────────────────────

router.get("/vehicles/:id/pmcvi", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const vehicleId = Number(req.params.id);
  const records = await db
    .select({
      id: pmcviRecordsTable.id,
      vehicleId: pmcviRecordsTable.vehicleId,
      inspectionDate: pmcviRecordsTable.inspectionDate,
      expiryDate: pmcviRecordsTable.expiryDate,
      result: pmcviRecordsTable.result,
      inspectionStationName: pmcviRecordsTable.inspectionStationName,
      inspectorName: pmcviRecordsTable.inspectorName,
      certificateNumber: pmcviRecordsTable.certificateNumber,
      driveOnDocumentKey: pmcviRecordsTable.driveOnDocumentKey,
      driveOnUploadedAt: pmcviRecordsTable.driveOnUploadedAt,
      isOfficiallyPassed: pmcviRecordsTable.isOfficiallyPassed,
      repairNotes: pmcviRecordsTable.repairNotes,
      reinspectionDate: pmcviRecordsTable.reinspectionDate,
      createdByName: usersTable.name,
      createdAt: pmcviRecordsTable.createdAt,
      updatedAt: pmcviRecordsTable.updatedAt,
    })
    .from(pmcviRecordsTable)
    .leftJoin(usersTable, eq(pmcviRecordsTable.createdByUserId, usersTable.id))
    .where(eq(pmcviRecordsTable.vehicleId, vehicleId))
    .orderBy(desc(pmcviRecordsTable.inspectionDate));
  res.json(records);
});

router.post("/vehicles/:id/pmcvi", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const vehicleId = Number(req.params.id);
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  const { inspectionDate, expiryDate, result, inspectionStationName, inspectorName, certificateNumber, repairNotes, reinspectionDate } = req.body as {
    inspectionDate: string;
    expiryDate: string;
    result?: string;
    inspectionStationName?: string;
    inspectorName?: string;
    certificateNumber?: string;
    repairNotes?: string;
    reinspectionDate?: string;
  };

  if (!inspectionDate || !expiryDate) {
    res.status(422).json({ error: "inspectionDate and expiryDate are required" }); return;
  }

  const [record] = await db.insert(pmcviRecordsTable).values({
    vehicleId,
    inspectionDate,
    expiryDate,
    result: (result ?? "pending") as any,
    inspectionStationName: inspectionStationName ?? null,
    inspectorName: inspectorName ?? null,
    certificateNumber: certificateNumber ?? null,
    repairNotes: repairNotes ?? null,
    reinspectionDate: reinspectionDate ?? null,
    createdByUserId: req.user!.id,
  }).returning();

  await db.insert(auditLogTable).values({
    tableName: "pmcvi_records",
    recordId: record.id,
    action: "create",
    changedByUserId: req.user!.id,
    changedByName: req.user!.name,
    newValue: result ?? "pending",
  });

  res.status(201).json(record);
});

router.patch("/pmcvi/:id", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(pmcviRecordsTable).where(eq(pmcviRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Record not found" }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  const fields = ["inspectionDate", "expiryDate", "result", "inspectionStationName", "inspectorName", "certificateNumber", "repairNotes", "reinspectionDate"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  // Cannot mark officially passed without DriveON document
  if (updates.result === "pass" && !existing.driveOnDocumentKey) {
    res.status(422).json({ error: "Cannot mark as passed: DriveON certificate must be uploaded first" }); return;
  }

  const [updated] = await db.update(pmcviRecordsTable).set(updates).where(eq(pmcviRecordsTable.id, id)).returning();

  await db.insert(auditLogTable).values({
    tableName: "pmcvi_records",
    recordId: id,
    action: "update",
    changedByUserId: req.user!.id,
    changedByName: req.user!.name,
  });

  res.json(updated);
});

router.post("/pmcvi/:id/drive-on-upload", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(pmcviRecordsTable).where(eq(pmcviRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Record not found" }); return; }

  const { fileKey } = req.body as { fileKey: string };
  if (!fileKey) { res.status(422).json({ error: "fileKey is required" }); return; }

  const [updated] = await db.update(pmcviRecordsTable)
    .set({ driveOnDocumentKey: fileKey, driveOnUploadedAt: new Date(), driveOnUploadedByUserId: req.user!.id, updatedAt: new Date() })
    .where(eq(pmcviRecordsTable.id, id))
    .returning();

  await db.insert(auditLogTable).values({
    tableName: "pmcvi_records",
    recordId: id,
    action: "document_uploaded",
    changedByUserId: req.user!.id,
    changedByName: req.user!.name,
    newValue: "drive_on_certificate",
  });

  res.json(updated);
});

router.post("/pmcvi/:id/mark-passed", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(pmcviRecordsTable).where(eq(pmcviRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Record not found" }); return; }

  if (!existing.driveOnDocumentKey) {
    res.status(422).json({ error: "DriveON certificate must be uploaded before marking as officially passed" }); return;
  }

  const [updated] = await db.update(pmcviRecordsTable)
    .set({ result: "pass", isOfficiallyPassed: true, updatedAt: new Date() })
    .where(eq(pmcviRecordsTable.id, id))
    .returning();

  await db.insert(auditLogTable).values({
    tableName: "pmcvi_records",
    recordId: id,
    action: "status_change",
    changedByUserId: req.user!.id,
    changedByName: req.user!.name,
    oldValue: "pending",
    newValue: "officially_passed",
  });

  res.json(updated);
});

// ─── US Annual Inspections ────────────────────────────────────────────────────

router.get("/vehicles/:id/us-inspections", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const vehicleId = Number(req.params.id);
  const records = await db
    .select({
      id: usInspectionRecordsTable.id,
      vehicleId: usInspectionRecordsTable.vehicleId,
      inspectionDate: usInspectionRecordsTable.inspectionDate,
      expiryDate: usInspectionRecordsTable.expiryDate,
      inspectorName: usInspectionRecordsTable.inspectorName,
      inspectorId: usInspectionRecordsTable.inspectorId,
      brakeInspectorName: usInspectionRecordsTable.brakeInspectorName,
      brakeInspectorId: usInspectionRecordsTable.brakeInspectorId,
      reportFileKey: usInspectionRecordsTable.reportFileKey,
      result: usInspectionRecordsTable.result,
      notes: usInspectionRecordsTable.notes,
      createdByName: usersTable.name,
      createdAt: usInspectionRecordsTable.createdAt,
    })
    .from(usInspectionRecordsTable)
    .leftJoin(usersTable, eq(usInspectionRecordsTable.createdByUserId, usersTable.id))
    .where(eq(usInspectionRecordsTable.vehicleId, vehicleId))
    .orderBy(desc(usInspectionRecordsTable.inspectionDate));
  res.json(records);
});

router.post("/vehicles/:id/us-inspections", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const vehicleId = Number(req.params.id);
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  const { inspectionDate, expiryDate, inspectorName, inspectorId, brakeInspectorName, brakeInspectorId, reportFileKey, result, notes } = req.body as {
    inspectionDate: string;
    expiryDate: string;
    inspectorName?: string;
    inspectorId?: string;
    brakeInspectorName?: string;
    brakeInspectorId?: string;
    reportFileKey?: string;
    result?: string;
    notes?: string;
  };

  if (!inspectionDate || !expiryDate) {
    res.status(422).json({ error: "inspectionDate and expiryDate are required" }); return;
  }

  const [record] = await db.insert(usInspectionRecordsTable).values({
    vehicleId,
    inspectionDate,
    expiryDate,
    inspectorName: inspectorName ?? null,
    inspectorId: inspectorId ?? null,
    brakeInspectorName: brakeInspectorName ?? null,
    brakeInspectorId: brakeInspectorId ?? null,
    reportFileKey: reportFileKey ?? null,
    result: result ?? "pass",
    notes: notes ?? null,
    createdByUserId: req.user!.id,
  }).returning();

  res.status(201).json(record);
});

router.patch("/us-inspections/:id", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(usInspectionRecordsTable).where(eq(usInspectionRecordsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Record not found" }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  const fields = ["inspectionDate", "expiryDate", "inspectorName", "inspectorId", "brakeInspectorName", "brakeInspectorId", "reportFileKey", "result", "notes"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  const [updated] = await db.update(usInspectionRecordsTable).set(updates).where(eq(usInspectionRecordsTable.id, id)).returning();
  res.json(updated);
});

// ─── Roadside Violations ──────────────────────────────────────────────────────

router.get("/vehicles/:id/roadside-violations", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const vehicleId = Number(req.params.id);
  const records = await db
    .select({
      id: roadsideViolationsTable.id,
      vehicleId: roadsideViolationsTable.vehicleId,
      inspectionDate: roadsideViolationsTable.inspectionDate,
      inspectionLocation: roadsideViolationsTable.inspectionLocation,
      violationCode: roadsideViolationsTable.violationCode,
      violationDescription: roadsideViolationsTable.violationDescription,
      severity: roadsideViolationsTable.severity,
      correctiveAction: roadsideViolationsTable.correctiveAction,
      repairDocumentKey: roadsideViolationsTable.repairDocumentKey,
      resolved: roadsideViolationsTable.resolved,
      resolvedAt: roadsideViolationsTable.resolvedAt,
      resolvedByName: usersTable.name,
      createdAt: roadsideViolationsTable.createdAt,
    })
    .from(roadsideViolationsTable)
    .leftJoin(usersTable, eq(roadsideViolationsTable.resolvedByUserId, usersTable.id))
    .where(eq(roadsideViolationsTable.vehicleId, vehicleId))
    .orderBy(desc(roadsideViolationsTable.inspectionDate));
  res.json(records);
});

router.post("/vehicles/:id/roadside-violations", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const vehicleId = Number(req.params.id);
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  const { inspectionDate, inspectionLocation, violationCode, violationDescription, severity, correctiveAction } = req.body as {
    inspectionDate: string;
    inspectionLocation?: string;
    violationCode?: string;
    violationDescription: string;
    severity?: string;
    correctiveAction?: string;
  };

  if (!inspectionDate || !violationDescription) {
    res.status(422).json({ error: "inspectionDate and violationDescription are required" }); return;
  }

  const [record] = await db.insert(roadsideViolationsTable).values({
    vehicleId,
    inspectionDate,
    inspectionLocation: inspectionLocation ?? null,
    violationCode: violationCode ?? null,
    violationDescription,
    severity: severity ?? "minor",
    correctiveAction: correctiveAction ?? null,
  }).returning();

  res.status(201).json(record);
});

router.patch("/roadside-violations/:id", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(roadsideViolationsTable).where(eq(roadsideViolationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Record not found" }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  const fields = ["inspectionDate", "inspectionLocation", "violationCode", "violationDescription", "severity", "correctiveAction", "repairDocumentKey"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (req.body.resolved === true && !existing.resolved) {
    updates.resolved = true;
    updates.resolvedAt = new Date();
    updates.resolvedByUserId = req.user!.id;
  }

  const [updated] = await db.update(roadsideViolationsTable).set(updates).where(eq(roadsideViolationsTable.id, id)).returning();
  res.json(updated);
});

// ─── PMCVI Reminder check (fires at page load, no cron needed) ────────────────

router.post("/compliance/check-pmcvi-reminders", requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const REMINDER_THRESHOLDS = [90, 60, 30, 14, 7];

  // Normalize today to midnight UTC to prevent timezone drift
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]; // "YYYY-MM-DD"
  const todayMs = new Date(todayStr + "T00:00:00.000Z").getTime();

  const records = await db
    .select({
      id: pmcviRecordsTable.id,
      vehicleId: pmcviRecordsTable.vehicleId,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      expiryDate: pmcviRecordsTable.expiryDate,
      isOfficiallyPassed: pmcviRecordsTable.isOfficiallyPassed,
    })
    .from(pmcviRecordsTable)
    .leftJoin(vehiclesTable, eq(pmcviRecordsTable.vehicleId, vehiclesTable.id))
    .where(eq(vehiclesTable.companyId, req.user!.companyId!));

  // Get all managers + admins
  const managers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.companyId, req.user!.companyId!), sql`${usersTable.role} in ('admin','manager')`));

  let remindersCreated = 0;

  for (const record of records) {
    if (!record.expiryDate) continue;
    // Normalize expiryDate to midnight UTC as well
    const expiryDateStr = typeof record.expiryDate === 'string'
      ? record.expiryDate.split("T")[0]  // Extract YYYY-MM-DD from ISO string
      : record.expiryDate.toISOString().split("T")[0];
    const expiryDateMs = new Date(expiryDateStr + "T00:00:00.000Z").getTime();
    const daysLeft = Math.round((expiryDateMs - todayMs) / (1000 * 60 * 60 * 24));

    for (const threshold of REMINDER_THRESHOLDS) {
      if (daysLeft <= threshold && daysLeft >= 0) {
        // Check if we already sent this threshold this year
        const [alreadySent] = await db
          .select()
          .from(notificationSentLogTable)
          .where(
            and(
              eq(notificationSentLogTable.notificationType, `pmcvi_expiry_${threshold}`),
              eq(notificationSentLogTable.relatedRecordId, record.id)
            )
          )
          .limit(1);

        if (!alreadySent) {
          for (const mgr of managers) {
            await db.insert(userNotificationsTable).values({
              userId: mgr.id,
              notificationType: "pmcvi_expiry",
              title: `PMCVI Expiring in ${daysLeft} days — ${record.vehicleUnitNumber ?? record.vehicleId}`,
              body: `PMCVI expires on ${record.expiryDate}. ${record.isOfficiallyPassed ? "" : "DriveON certificate not yet uploaded."}`,
              relatedTableName: "pmcvi_records",
              relatedRecordId: record.id,
            });
          }
          await db.insert(notificationSentLogTable).values({
            notificationType: `pmcvi_expiry_${threshold}`,
            channel: "in_app",
            relatedTableName: "pmcvi_records",
            relatedRecordId: record.id,
          });
          remindersCreated++;
        }
        break; // Only fire most urgent threshold
      }
    }
  }

  res.json({ remindersCreated });
});

export default router;
