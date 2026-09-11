import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  defectsTable,
  defectPhotosTable,
  usersTable,
  vehiclesTable,
  workOrdersTable,
  workOrderStatusHistoryTable,
  auditLogTable,
  userNotificationsTable,
} from "@workspace/db/schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";

async function generateWoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ cnt: count() })
    .from(workOrdersTable)
    .where(sql`EXTRACT(YEAR FROM created_at) = ${year}`);
  const seq = (row?.cnt ?? 0) + 1;
  return `WO-${year}-${String(seq).padStart(4, "0")}`;
}

const router: IRouter = Router();
router.use("/defects/:id", requireAuth, async (req, res, next) => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [defect] = await db.select({ id: defectsTable.id }).from(defectsTable)
    .innerJoin(vehiclesTable, eq(defectsTable.vehicleId, vehiclesTable.id))
    .where(and(eq(defectsTable.id, id), eq(vehiclesTable.companyId, req.user!.companyId!))).limit(1);
  if (!defect) { res.status(404).json({ error: "Defect not found" }); return; }
  next();
});

// ── List defects ──────────────────────────────────────────────────────────────

router.get("/defects", requireAuth, async (req, res): Promise<void> => {
  const { vehicleId, status, severity, source, limit = "50", offset = "0" } =
    req.query as Record<string, string>;

  const user = req.user!;
  const conds: any[] = [eq(vehiclesTable.companyId, user.companyId!)];

  // Drivers only see their own submitted defects
  if (user.role === "driver") {
    conds.push(eq(defectsTable.reportedByUserId, user.id));
  }

  if (vehicleId) conds.push(eq(defectsTable.vehicleId, Number(vehicleId)));
  if (status) conds.push(eq(defectsTable.status, status as any));
  if (severity) conds.push(eq(defectsTable.severity, severity as any));
  if (source) conds.push(eq(defectsTable.source, source as any));

  const rows = await db
    .select({
      id: defectsTable.id,
      vehicleId: defectsTable.vehicleId,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      reportedByUserId: defectsTable.reportedByUserId,
      reportedByName: usersTable.name,
      source: defectsTable.source,
      severity: defectsTable.severity,
      status: defectsTable.status,
      description: defectsTable.description,
      location: defectsTable.location,
      odometerAtReport: defectsTable.odometerAtReport,
      workOrderId: defectsTable.workOrderId,
      woNumber: workOrdersTable.woNumber,
      repairedAt: defectsTable.repairedAt,
      resolutionNotes: defectsTable.resolutionNotes,
      createdAt: defectsTable.createdAt,
    })
    .from(defectsTable)
    .leftJoin(vehiclesTable, eq(defectsTable.vehicleId, vehiclesTable.id))
    .leftJoin(usersTable, eq(defectsTable.reportedByUserId, usersTable.id))
    .leftJoin(workOrdersTable, eq(defectsTable.workOrderId, workOrdersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(defectsTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  // Attach photo counts
  const results = await Promise.all(
    rows.map(async (row) => {
      const [{ photoCount }] = await db
        .select({ photoCount: sql<number>`count(*)::int` })
        .from(defectPhotosTable)
        .where(eq(defectPhotosTable.defectId, row.id));
      return { ...row, photoCount };
    })
  );

  res.json(results);
});

// ── Get single defect ─────────────────────────────────────────────────────────

router.get("/defects/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [defect] = await db
    .select({
      id: defectsTable.id,
      vehicleId: defectsTable.vehicleId,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      reportedByUserId: defectsTable.reportedByUserId,
      reportedByName: usersTable.name,
      source: defectsTable.source,
      severity: defectsTable.severity,
      status: defectsTable.status,
      description: defectsTable.description,
      location: defectsTable.location,
      odometerAtReport: defectsTable.odometerAtReport,
      workOrderId: defectsTable.workOrderId,
      woNumber: workOrdersTable.woNumber,
      repairedByUserId: defectsTable.repairedByUserId,
      repairedAt: defectsTable.repairedAt,
      resolutionNotes: defectsTable.resolutionNotes,
      checklistInstanceId: defectsTable.checklistInstanceId,
      checklistItemId: defectsTable.checklistItemId,
      createdAt: defectsTable.createdAt,
      updatedAt: defectsTable.updatedAt,
    })
    .from(defectsTable)
    .leftJoin(vehiclesTable, eq(defectsTable.vehicleId, vehiclesTable.id))
    .leftJoin(usersTable, eq(defectsTable.reportedByUserId, usersTable.id))
    .leftJoin(workOrdersTable, eq(defectsTable.workOrderId, workOrdersTable.id))
    .where(eq(defectsTable.id, id));

  if (!defect) { res.status(404).json({ error: "Defect not found" }); return; }

  // Drivers can only see their own defects
  if (req.user!.role === "driver" && defect.reportedByUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const photos = await db
    .select()
    .from(defectPhotosTable)
    .where(eq(defectPhotosTable.defectId, id))
    .orderBy(defectPhotosTable.createdAt);

  res.json({ ...defect, photos });
});

// ── Submit defect (all authenticated users) ───────────────────────────────────

router.post("/defects", requireAuth, async (req, res): Promise<void> => {
  const {
    vehicleId,
    description,
    severity,
    location,
    odometerAtReport,
    photoFileKeys,
  } = req.body as {
    vehicleId: number;
    description: string;
    severity: "minor" | "major" | "out_of_service";
    location?: string;
    odometerAtReport?: number;
    photoFileKeys?: string[];
  };

  if (!vehicleId || !description || !severity) {
    res.status(422).json({ error: "vehicleId, description, and severity are required" });
    return;
  }

  const VALID_SEVERITIES = ["minor", "major", "out_of_service"];
  if (!VALID_SEVERITIES.includes(severity)) {
    res.status(422).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(", ")}` });
    return;
  }

  const [vehicle] = await db
    .select({ id: vehiclesTable.id, unitNumber: vehiclesTable.unitNumber, status: vehiclesTable.status })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.companyId, req.user!.companyId!)));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  const [defect] = await db
    .insert(defectsTable)
    .values({
      vehicleId,
      reportedByUserId: req.user!.id,
      source: "driver_report",
      severity: severity as any,
      status: "open",
      description,
      location: location ?? null,
      odometerAtReport: odometerAtReport ?? null,
    })
    .returning();

  // Insert photos
  if (photoFileKeys?.length) {
    for (const fileKey of photoFileKeys.slice(0, 5)) {
      await db.insert(defectPhotosTable).values({
        defectId: defect.id,
        fileKey,
        uploadedByUserId: req.user!.id,
      });
    }
  }

  await db.insert(auditLogTable).values({
    tableName: "defects",
    recordId: defect.id,
    action: "create",
    changedByUserId: req.user!.id,
    changedByName: req.user!.name,
    newValue: severity,
    metadata: { vehicleId, vehicleUnitNumber: vehicle.unitNumber } as any,
  });

  // Notify managers/admins about new defect
  const managers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.companyId, req.user!.companyId!),
      sql`${usersTable.role} in ('admin','manager')`
    ));

  const severityLabel = severity === "out_of_service" ? "Out of Service" : severity.charAt(0).toUpperCase() + severity.slice(1);
  for (const mgr of managers) {
    await db.insert(userNotificationsTable).values({
      userId: mgr.id,
      notificationType: "defect_new",
      title: `New ${severityLabel} Defect — ${vehicle.unitNumber}`,
      body: description.slice(0, 120),
      relatedTableName: "defects",
      relatedRecordId: defect.id,
    });
  }

  res.status(201).json({ ...defect, photos: [], photoCount: photoFileKeys?.length ?? 0 });
});

// ── Update defect (manager/mechanic/admin) ────────────────────────────────────

router.patch("/defects/:id", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(defectsTable).where(eq(defectsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Defect not found" }); return; }

  const {
    status,
    workOrderId,
    resolutionNotes,
    severity,
  } = req.body as {
    status?: string;
    workOrderId?: number | null;
    resolutionNotes?: string;
    severity?: string;
  };

  const VALID_STATUSES = ["open", "assigned", "repaired", "deferred", "restricted", "out_of_service"];
  if (status && !VALID_STATUSES.includes(status)) {
    res.status(422).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    return;
  }

  const now = new Date();
  const updates: Record<string, any> = { updatedAt: now };
  if (status) updates.status = status;
  if (workOrderId !== undefined) updates.workOrderId = workOrderId;
  if (resolutionNotes !== undefined) updates.resolutionNotes = resolutionNotes;
  if (severity) updates.severity = severity;
  if (status === "repaired") {
    updates.repairedByUserId = req.user!.id;
    updates.repairedAt = now;
  }

  // Auto-create a driver_defect work order when status → "assigned" and none exists yet
  let autoCreatedWo: { id: number; woNumber: string } | null = null;
  if (status === "assigned" && !existing.workOrderId) {
    const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, existing.vehicleId));
    if (vehicle) {
      const woNumber = await generateWoNumber();
      const [wo] = await db
        .insert(workOrdersTable)
        .values({
          woNumber,
          companyId: req.user!.companyId!,
          vehicleId: existing.vehicleId,
          workOrderType: "driver_defect" as any,
          status: "assigned" as any,
          priority: existing.severity === "out_of_service" ? "critical" : existing.severity === "major" ? "high" : "normal" as any,
          createdByUserId: req.user!.id,
          description: existing.description,
          internalNotes: `Auto-created from defect DEF-${String(id).padStart(4, "0")}`,
        })
        .returning();

      await db.insert(workOrderStatusHistoryTable).values({
        workOrderId: wo.id,
        fromStatus: null,
        toStatus: "assigned",
        changedByUserId: req.user!.id,
        notes: `Created from defect DEF-${String(id).padStart(4, "0")}`,
      });

      await db.insert(auditLogTable).values({
        tableName: "work_orders",
        recordId: wo.id,
        action: "create",
        changedByUserId: req.user!.id,
        changedByName: req.user!.name,
        newValue: JSON.stringify({ woNumber, vehicleId: existing.vehicleId, workOrderType: "driver_defect", status: "assigned" }),
      });

      // Update vehicle status to in_repair if available
      if (vehicle.status === "available") {
        await db.update(vehiclesTable).set({ status: "in_repair", updatedAt: now }).where(eq(vehiclesTable.id, existing.vehicleId));
      }

      updates.workOrderId = wo.id;
      autoCreatedWo = { id: wo.id, woNumber };
    }
  }

  const [updated] = await db
    .update(defectsTable)
    .set(updates)
    .where(eq(defectsTable.id, id))
    .returning();

  if (status && status !== existing.status) {
    await db.insert(auditLogTable).values({
      tableName: "defects",
      recordId: id,
      action: "status_change",
      changedByUserId: req.user!.id,
      changedByName: req.user!.name,
      oldValue: existing.status,
      newValue: status,
    });

    // Notify the defect reporter of status change
    if (existing.reportedByUserId) {
      await db.insert(userNotificationsTable).values({
        userId: existing.reportedByUserId,
        notificationType: "defect_status_change",
        title: `Defect #${id} status updated to ${status}`,
        body: resolutionNotes ?? null,
        relatedTableName: "defects",
        relatedRecordId: id,
      });
    }
  }

  res.json({ ...updated, autoCreatedWo });
});

// ── Add photo to existing defect ──────────────────────────────────────────────

router.post("/defects/:id/photos", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [defect] = await db.select().from(defectsTable).where(eq(defectsTable.id, id));
  if (!defect) { res.status(404).json({ error: "Defect not found" }); return; }

  // Drivers can only add photos to their own defects
  if (req.user!.role === "driver" && defect.reportedByUserId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { fileKey, caption } = req.body as { fileKey: string; caption?: string };
  if (!fileKey) { res.status(422).json({ error: "fileKey is required" }); return; }

  const [photo] = await db
    .insert(defectPhotosTable)
    .values({ defectId: id, fileKey, caption: caption ?? null, uploadedByUserId: req.user!.id })
    .returning();

  res.status(201).json(photo);
});

export default router;
