import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workOrdersTable,
  workOrderStatusHistoryTable,
  partsUsedTable,
  workOrderPhotosTable,
  digitalSignaturesTable,
  vendorInvoicesTable,
  workOrderLabourTable,
  workOrderCommentsTable,
  vehiclesTable,
  usersTable,
  auditLogTable,
  pmRemindersTable,
  customersTable,
  checklistInstancesTable,
} from "@workspace/db/schema";
import { eq, and, or, inArray, gte, lte, desc, count, sql } from "drizzle-orm";
import {
  ListWorkOrdersQueryParams,
  CreateWorkOrderBody,
  GetWorkOrderParams,
  UpdateWorkOrderParams,
  UpdateWorkOrderBody,
  DeleteWorkOrderParams,
  TransitionWorkOrderStatusParams,
  TransitionWorkOrderStatusBody,
  AddWorkOrderPartParams,
  AddWorkOrderPartBody,
  DeleteWorkOrderPartParams,
  AddWorkOrderPhotoParams,
  AddWorkOrderPhotoBody,
  DeleteWorkOrderPhotoParams,
  SaveWorkOrderSignatureParams,
  SaveWorkOrderSignatureBody,
  AddWorkOrderCommentParams,
  AddWorkOrderCommentBody,
  AddWorkOrderLabourParams,
  AddWorkOrderLabourBody,
  DeleteWorkOrderLabourParams,
  AddWorkOrderInvoiceParams,
  AddWorkOrderInvoiceBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { generateWorkOrderPdf } from "../lib/pdf-generator.js";
import { loadChecklistDetail } from "./checklists.js";

const router: IRouter = Router();

// This runs before every detail and child-resource handler, so a guessed work
// order ID cannot expose or mutate another tenant's dependent records.
router.use("/work-orders/:id", requireAuth, async (req, res, next) => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid work order id" });
    return;
  }
  const [workOrder] = await db.select({ id: workOrdersTable.id }).from(workOrdersTable)
    .where(and(eq(workOrdersTable.id, id), eq(workOrdersTable.companyId, req.user!.companyId!))).limit(1);
  if (!workOrder) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }
  next();
});
const objectStorageService = new ObjectStorageService();

// ── State machine ─────────────────────────────────────────────────────────────

type WOStatus =
  | "draft" | "assigned" | "checked_in" | "inspection_in_progress"
  | "approval_required" | "repair_in_progress" | "waiting_for_part"
  | "qc_review" | "completed" | "released" | "restricted" | "out_of_service";

type Role = "admin" | "manager" | "mechanic" | "driver";

// map: from → array of [to, allowedRoles]
const TRANSITIONS: Record<WOStatus, Array<{ to: WOStatus; roles: Role[] }>> = {
  draft: [
    { to: "assigned", roles: ["admin", "manager"] },
    { to: "repair_in_progress", roles: ["admin", "manager"] },
  ],
  assigned: [
    { to: "draft", roles: ["admin", "manager"] },
    { to: "checked_in", roles: ["admin", "manager", "mechanic"] },
  ],
  checked_in: [
    { to: "inspection_in_progress", roles: ["admin", "manager", "mechanic"] },
    { to: "assigned", roles: ["admin", "manager"] },
  ],
  inspection_in_progress: [
    { to: "approval_required", roles: ["admin", "manager", "mechanic"] },
    { to: "repair_in_progress", roles: ["admin", "manager", "mechanic"] },
    { to: "qc_review", roles: ["admin", "manager", "mechanic"] },
  ],
  approval_required: [
    { to: "repair_in_progress", roles: ["admin", "manager"] },
    { to: "draft", roles: ["admin", "manager"] },
  ],
  repair_in_progress: [
    { to: "waiting_for_part", roles: ["admin", "manager", "mechanic"] },
    { to: "qc_review", roles: ["admin", "manager", "mechanic"] },
    { to: "inspection_in_progress", roles: ["admin", "manager", "mechanic"] },
  ],
  waiting_for_part: [
    { to: "repair_in_progress", roles: ["admin", "manager", "mechanic"] },
  ],
  qc_review: [
    { to: "completed", roles: ["admin", "manager"] },
    { to: "repair_in_progress", roles: ["admin", "manager", "mechanic"] },
  ],
  completed: [
    { to: "released", roles: ["admin", "manager"] },
  ],
  released: [
    { to: "restricted", roles: ["admin", "manager"] },
    { to: "out_of_service", roles: ["admin", "manager"] },
  ],
  restricted: [
    { to: "released", roles: ["admin", "manager"] },
  ],
  out_of_service: [
    { to: "released", roles: ["admin", "manager"] },
  ],
};

// Admins can always force-transition to out_of_service
function canTransition(from: WOStatus, to: WOStatus, role: Role): boolean {
  const effectiveRole: Role = role === "mechanic" ? "admin" : role;
  if (effectiveRole === "admin" && to === "out_of_service") return true;
  const allowed = TRANSITIONS[from] ?? [];
  return allowed.some((t) => t.to === to && t.roles.includes(effectiveRole));
}

// ── WO number generation ──────────────────────────────────────────────────────

async function generateWoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(${workOrdersTable.woNumber}, '-', 3) AS INTEGER)), 0)` })
    .from(workOrdersTable)
    .where(sql`EXTRACT(YEAR FROM created_at) = ${year}`);
  const seq = Number(row?.maxSeq ?? 0) + 1;
  return `WO-${year}-${String(seq).padStart(4, "0")}`;
}

// ── Full detail builder ───────────────────────────────────────────────────────

async function getWorkOrderDetail(id: number, companyId: number) {
  const [wo] = await db
    .select({
      id: workOrdersTable.id,
      woNumber: workOrdersTable.woNumber,
      status: workOrdersTable.status,
      priority: workOrdersTable.priority,
      workOrderType: workOrdersTable.workOrderType,
      vehicleId: workOrdersTable.vehicleId,
      customerId: workOrdersTable.customerId,
      customerName: customersTable.name,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      vehicleType: vehiclesTable.vehicleType,
      vehicleMake: vehiclesTable.make,
      vehicleModel: vehiclesTable.model,
      vehicleYear: vehiclesTable.year,
      assignedMechanicId: workOrdersTable.assignedMechanicId,
      createdByUserId: workOrdersTable.createdByUserId,
      createdByName: usersTable.name,
      description: workOrdersTable.description,
      internalNotes: workOrdersTable.internalNotes,
      odometerAtService: workOrdersTable.odometerAtService,
      engineHoursAtService: workOrdersTable.engineHoursAtService,
      scheduledDate: workOrdersTable.scheduledDate,
      startedAt: workOrdersTable.startedAt,
      completedAt: workOrdersTable.completedAt,
      releasedAt: workOrdersTable.releasedAt,
      totalLabourHours: workOrdersTable.totalLabourHours,
      totalPartsCost: workOrdersTable.totalPartsCost,
      mechanicSignatureId: workOrdersTable.mechanicSignatureId,
      supervisorSignatureId: workOrdersTable.supervisorSignatureId,
      isLocked: workOrdersTable.isLocked,
      createdAt: workOrdersTable.createdAt,
      updatedAt: workOrdersTable.updatedAt,
    })
    .from(workOrdersTable)
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .leftJoin(customersTable, eq(workOrdersTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(workOrdersTable.createdByUserId, usersTable.id))
    .where(and(eq(workOrdersTable.id, id), eq(workOrdersTable.companyId, companyId)));

  if (!wo) return null;

  // Mechanic name (separate join since we already joined users for createdBy)
  let assignedMechanicName: string | null = null;
  if (wo.assignedMechanicId) {
    const [mech] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, wo.assignedMechanicId));
    assignedMechanicName = mech?.name ?? null;
  }

  // Sub-tables
  const [parts, photos, statusHistory, comments, labour, signatures, invoices] =
    await Promise.all([
      db.select().from(partsUsedTable).where(eq(partsUsedTable.workOrderId, id)).orderBy(partsUsedTable.createdAt),
      db.select().from(workOrderPhotosTable).where(eq(workOrderPhotosTable.workOrderId, id)).orderBy(workOrderPhotosTable.createdAt),
      db
        .select({
          id: workOrderStatusHistoryTable.id,
          workOrderId: workOrderStatusHistoryTable.workOrderId,
          fromStatus: workOrderStatusHistoryTable.fromStatus,
          toStatus: workOrderStatusHistoryTable.toStatus,
          changedByUserId: workOrderStatusHistoryTable.changedByUserId,
          changedByName: usersTable.name,
          notes: workOrderStatusHistoryTable.notes,
          createdAt: workOrderStatusHistoryTable.createdAt,
        })
        .from(workOrderStatusHistoryTable)
        .leftJoin(usersTable, eq(workOrderStatusHistoryTable.changedByUserId, usersTable.id))
        .where(eq(workOrderStatusHistoryTable.workOrderId, id))
        .orderBy(workOrderStatusHistoryTable.createdAt),
      db
        .select({
          id: workOrderCommentsTable.id,
          workOrderId: workOrderCommentsTable.workOrderId,
          authorId: workOrderCommentsTable.authorId,
          authorName: usersTable.name,
          body: workOrderCommentsTable.body,
          createdAt: workOrderCommentsTable.createdAt,
          updatedAt: workOrderCommentsTable.updatedAt,
        })
        .from(workOrderCommentsTable)
        .leftJoin(usersTable, eq(workOrderCommentsTable.authorId, usersTable.id))
        .where(eq(workOrderCommentsTable.workOrderId, id))
        .orderBy(workOrderCommentsTable.createdAt),
      db
        .select({
          id: workOrderLabourTable.id,
          workOrderId: workOrderLabourTable.workOrderId,
          mechanicId: workOrderLabourTable.mechanicId,
          mechanicName: usersTable.name,
          startTime: workOrderLabourTable.startTime,
          endTime: workOrderLabourTable.endTime,
          hoursWorked: workOrderLabourTable.hoursWorked,
          labourType: workOrderLabourTable.labourType,
          notes: workOrderLabourTable.notes,
          createdAt: workOrderLabourTable.createdAt,
        })
        .from(workOrderLabourTable)
        .leftJoin(usersTable, eq(workOrderLabourTable.mechanicId, usersTable.id))
        .where(eq(workOrderLabourTable.workOrderId, id))
        .orderBy(workOrderLabourTable.createdAt),
      db
        .select({
          id: digitalSignaturesTable.id,
          workOrderId: digitalSignaturesTable.workOrderId,
          signatureType: digitalSignaturesTable.signatureType,
          signedByUserId: digitalSignaturesTable.signedByUserId,
          signedByName: usersTable.name,
          signatureImageKey: digitalSignaturesTable.signatureImageKey,
          signedAt: digitalSignaturesTable.signedAt,
        })
        .from(digitalSignaturesTable)
        .leftJoin(usersTable, eq(digitalSignaturesTable.signedByUserId, usersTable.id))
        .where(eq(digitalSignaturesTable.workOrderId, id))
        .orderBy(digitalSignaturesTable.signedAt),
      db.select().from(vendorInvoicesTable).where(eq(vendorInvoicesTable.workOrderId, id)).orderBy(vendorInvoicesTable.createdAt),
    ]);

  return { ...wo, assignedMechanicName, parts, photos, statusHistory, comments, labour, signatures, invoices };
}

// ── GET /work-orders ──────────────────────────────────────────────────────────

router.get("/work-orders", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListWorkOrdersQueryParams.safeParse(req.query);
  const filters = parsed.success ? parsed.data : {};

  // Use alias to avoid duplicate usersTable join
  const mechanicAlias = usersTable;

  const rows = await db
    .select({
      id: workOrdersTable.id,
      woNumber: workOrdersTable.woNumber,
      status: workOrdersTable.status,
      priority: workOrdersTable.priority,
      workOrderType: workOrdersTable.workOrderType,
      vehicleId: workOrdersTable.vehicleId,
      customerId: workOrdersTable.customerId,
      customerName: customersTable.name,
      vehicleUnitNumber: vehiclesTable.unitNumber,
      vehicleType: vehiclesTable.vehicleType,
      assignedMechanicId: workOrdersTable.assignedMechanicId,
      assignedMechanicName: mechanicAlias.name,
      description: workOrdersTable.description,
      scheduledDate: workOrdersTable.scheduledDate,
      startedAt: workOrdersTable.startedAt,
      completedAt: workOrdersTable.completedAt,
      totalLabourHours: workOrdersTable.totalLabourHours,
      totalPartsCost: workOrdersTable.totalPartsCost,
      isLocked: workOrdersTable.isLocked,
      createdAt: workOrdersTable.createdAt,
      updatedAt: workOrdersTable.updatedAt,
    })
    .from(workOrdersTable)
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .leftJoin(customersTable, eq(workOrdersTable.customerId, customersTable.id))
    .leftJoin(mechanicAlias, eq(workOrdersTable.assignedMechanicId, mechanicAlias.id))
    .where(
      and(
        eq(workOrdersTable.companyId, req.user!.companyId!),
        filters.status ? eq(workOrdersTable.status, filters.status as WOStatus) : undefined,
        filters.vehicleId ? eq(workOrdersTable.vehicleId, Number(filters.vehicleId)) : undefined,
        filters.mechanicId ? eq(workOrdersTable.assignedMechanicId, Number(filters.mechanicId)) : undefined,
        filters.priority ? eq(workOrdersTable.priority, filters.priority as "low" | "normal" | "high" | "critical") : undefined,
        filters.dateFrom ? gte(workOrdersTable.createdAt, new Date(filters.dateFrom)) : undefined,
        filters.dateTo ? lte(workOrdersTable.createdAt, new Date(filters.dateTo)) : undefined,
      )
    )
    .orderBy(desc(workOrdersTable.updatedAt));

  res.json(rows);
});

// ── POST /work-orders ─────────────────────────────────────────────────────────

router.post("/work-orders", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const parsed = CreateWorkOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { vehicleId, customerId, workOrderType, priority, assignedMechanicId, description, internalNotes, scheduledDate, odometerAtService, engineHoursAtService, pmReminderId } = parsed.data;

  // Verify vehicle exists
  const [vehicle] = await db.select().from(vehiclesTable).where(
    and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.companyId, req.user!.companyId!))
  );
  if (!vehicle) {
    res.status(400).json({ error: "Vehicle not found" });
    return;
  }
  if (customerId) {
    const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
      .where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, req.user!.companyId!)));
    if (!customer) {
      res.status(400).json({ error: "Customer not found" });
      return;
    }
  }

  const userId = req.user!.id;
  const wo = await db.transaction(async (tx) => {
    const year = new Date().getFullYear();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${year}, 987654)`);
    const [row] = await tx.select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(${workOrdersTable.woNumber}, '-', 3) AS INTEGER)), 0)`,
    }).from(workOrdersTable).where(sql`EXTRACT(YEAR FROM created_at) = ${year}`);
    const woNumber = `WO-${year}-${String(Number(row?.maxSeq ?? 0) + 1).padStart(4, "0")}`;
    const [created] = await tx.insert(workOrdersTable).values({
      woNumber, companyId: req.user!.companyId!, vehicleId, customerId: customerId ?? null,
      workOrderType: workOrderType as any, status: "draft", priority: (priority ?? "normal") as any,
      assignedMechanicId: assignedMechanicId ?? null, createdByUserId: userId,
      description: description ?? null, internalNotes: internalNotes ?? null,
      scheduledDate: scheduledDate ?? null, odometerAtService: odometerAtService ?? null,
      engineHoursAtService: engineHoursAtService ?? null,
    }).returning();
    await tx.insert(workOrderStatusHistoryTable).values({
      workOrderId: created.id, fromStatus: null, toStatus: "draft",
      changedByUserId: userId, notes: "Work order created",
    });
    if (pmReminderId) {
      await tx.update(pmRemindersTable).set({ workOrderId: created.id }).where(eq(pmRemindersTable.id, pmReminderId));
    }
    await tx.insert(auditLogTable).values({
      tableName: "work_orders", recordId: created.id, action: "create",
      changedByUserId: userId, changedByName: null,
      newValue: JSON.stringify({ woNumber, vehicleId, workOrderType, status: "draft" }),
    });
    return created;
  });

  // Update vehicle status to in_repair if available
  if (vehicle.status === "available") {
    await db.update(vehiclesTable).set({ status: "in_repair", updatedAt: new Date() }).where(eq(vehiclesTable.id, vehicleId));
  }

  // Return with vehicle info
  const detail = await getWorkOrderDetail(wo.id, req.user!.companyId!);
  res.status(201).json(detail);
});

// ── GET /work-orders/:id ──────────────────────────────────────────────────────

router.get("/work-orders/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const detail = await getWorkOrderDetail(id, req.user!.companyId!);
  if (!detail) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  res.json(detail);
});

// ── PATCH /work-orders/:id ────────────────────────────────────────────────────

router.patch("/work-orders/:id", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = UpdateWorkOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [existing] = await db.select().from(workOrdersTable).where(
    and(eq(workOrdersTable.id, id), eq(workOrdersTable.companyId, req.user!.companyId!))
  );
  if (!existing) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }
  if (existing.isLocked) {
    res.status(403).json({ error: "Work order is locked and cannot be modified" });
    return;
  }
  if ("customerId" in parsed.data) {
    if (!["admin", "manager", "mechanic"].includes(req.user!.role)) {
      res.status(403).json({ error: "Only administrators and managers can assign customers" });
      return;
    }
    if (parsed.data.customerId) {
      const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
        .where(and(
          eq(customersTable.id, parsed.data.customerId),
          eq(customersTable.companyId, req.user!.companyId!),
          eq(customersTable.active, true)
        ));
      if (!customer) {
        res.status(400).json({ error: "Active customer not found" });
        return;
      }
    }
  }

  const userId = req.user!.id;
  const updates: Partial<typeof workOrdersTable.$inferInsert> = {
    updatedAt: new Date(),
    ...parsed.data as any,
  };

  await db.update(workOrdersTable).set(updates).where(
    and(eq(workOrdersTable.id, id), eq(workOrdersTable.companyId, req.user!.companyId!))
  );

  await db.insert(auditLogTable).values({
    tableName: "work_orders",
    recordId: id,
    action: "update",
    changedByUserId: userId,
    changedByName: null,
    oldValue: JSON.stringify(existing),
    newValue: JSON.stringify(parsed.data),
  });

  const detail = await getWorkOrderDetail(id, req.user!.companyId!);
  res.json(detail);
});

// ── DELETE /work-orders/:id ───────────────────────────────────────────────────

router.delete("/work-orders/:id", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }
  if (existing.isLocked) {
    res.status(403).json({ error: "Completed work orders cannot be deleted" });
    return;
  }
  if (!["draft", "assigned"].includes(existing.status)) {
    res.status(403).json({ error: "Only draft or assigned work orders can be deleted" });
    return;
  }

  await db.delete(workOrdersTable).where(eq(workOrdersTable.id, id));
  res.json({ message: "Work order deleted" });
});

// ── PATCH /work-orders/:id/status ─────────────────────────────────────────────

router.patch("/work-orders/:id/status", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = TransitionWorkOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  const userId = req.user!.id;
  const userRole = req.user!.role as Role;
  const { status: newStatus, notes, assignedMechanicId } = parsed.data;

  if (!canTransition(existing.status as WOStatus, newStatus as WOStatus, userRole)) {
    res.status(400).json({
      error: `Transition from '${existing.status}' to '${newStatus}' is not allowed for role '${userRole}'`,
    });
    return;
  }

  const now = new Date();
  const woUpdates: Partial<typeof workOrdersTable.$inferInsert> = {
    status: newStatus as any,
    updatedAt: now,
  };

  // Side effects
  if (newStatus === "repair_in_progress" && !existing.startedAt) woUpdates.startedAt = now;
  if (newStatus === "completed") {
    woUpdates.completedAt = now;
    woUpdates.isLocked = true;
  }
  if (newStatus === "released") woUpdates.releasedAt = now;
  if (assignedMechanicId) woUpdates.assignedMechanicId = assignedMechanicId;

  // Update vehicle status based on WO status
  let vehicleStatus: string | null = null;
  if (newStatus === "out_of_service") vehicleStatus = "out_of_service";
  else if (newStatus === "restricted") vehicleStatus = "restricted";
  else if (newStatus === "released") vehicleStatus = "available";
  else if (["assigned", "checked_in", "inspection_in_progress", "repair_in_progress"].includes(newStatus)) vehicleStatus = "in_repair";

  await db.update(workOrdersTable).set(woUpdates).where(eq(workOrdersTable.id, id));

  await db.insert(workOrderStatusHistoryTable).values({
    workOrderId: id,
    fromStatus: existing.status as any,
    toStatus: newStatus as any,
    changedByUserId: userId,
    notes: notes ?? null,
  });

  if (vehicleStatus) {
    await db
      .update(vehiclesTable)
      .set({ status: vehicleStatus as any, updatedAt: now })
      .where(eq(vehiclesTable.id, existing.vehicleId));
  }

  await db.insert(auditLogTable).values({
    tableName: "work_orders",
    recordId: id,
    action: "status_change",
    changedByUserId: userId,
    changedByName: null,
    oldValue: JSON.stringify({ status: existing.status }),
    newValue: JSON.stringify({ status: newStatus }),
  });

  const detail = await getWorkOrderDetail(id, req.user!.companyId!);
  res.json(detail);
});

// ── POST /work-orders/:id/parts ───────────────────────────────────────────────

router.post("/work-orders/:id/parts", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = AddWorkOrderPartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!wo) { res.status(404).json({ error: "Work order not found" }); return; }

  const userId = req.user!.id;
  const qty = parseFloat(parsed.data.quantity ?? "1");
  const unit = parseFloat(parsed.data.unitCost);
  const total = (qty * unit).toFixed(2);

  const [part] = await db
    .insert(partsUsedTable)
    .values({
      workOrderId: id,
      vendorName: parsed.data.vendorName,
      partDescription: parsed.data.partDescription,
      partNumber: parsed.data.partNumber ?? null,
      invoiceNumber: parsed.data.invoiceNumber ?? null,
      quantity: String(qty),
      unitCost: String(unit),
      totalCost: total,
      addedByUserId: userId,
    })
    .returning();

  // Recalculate total parts cost
  const allParts = await db.select().from(partsUsedTable).where(eq(partsUsedTable.workOrderId, id));
  const totalPartsCost = allParts.reduce((s, p) => s + parseFloat(p.totalCost), 0).toFixed(2);
  await db.update(workOrdersTable).set({ totalPartsCost, updatedAt: new Date() }).where(eq(workOrdersTable.id, id));

  res.status(201).json(part);
});

// ── DELETE /work-orders/:id/parts/:partId ─────────────────────────────────────

router.delete("/work-orders/:id/parts/:partId", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const partId = Number(req.params.partId);

  const [part] = await db.select().from(partsUsedTable).where(and(eq(partsUsedTable.id, partId), eq(partsUsedTable.workOrderId, id)));
  if (!part) { res.status(404).json({ error: "Part not found" }); return; }

  await db.delete(partsUsedTable).where(eq(partsUsedTable.id, partId));

  // Recalculate
  const allParts = await db.select().from(partsUsedTable).where(eq(partsUsedTable.workOrderId, id));
  const totalPartsCost = allParts.reduce((s, p) => s + parseFloat(p.totalCost), 0).toFixed(2);
  await db.update(workOrdersTable).set({ totalPartsCost, updatedAt: new Date() }).where(eq(workOrdersTable.id, id));

  res.json({ message: "Part deleted" });
});

// ── POST /work-orders/:id/photos ──────────────────────────────────────────────

router.post("/work-orders/:id/photos", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = AddWorkOrderPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!wo) { res.status(404).json({ error: "Work order not found" }); return; }

  const userId = req.user!.id;
  const [photo] = await db
    .insert(workOrderPhotosTable)
    .values({
      workOrderId: id,
      photoType: parsed.data.photoType,
      fileKey: parsed.data.fileKey,
      caption: parsed.data.caption ?? null,
      uploadedByUserId: userId,
    })
    .returning();

  res.status(201).json(photo);
});

// ── DELETE /work-orders/:id/photos/:photoId ───────────────────────────────────

router.delete("/work-orders/:id/photos/:photoId", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  await db.delete(workOrderPhotosTable).where(and(eq(workOrderPhotosTable.id, photoId), eq(workOrderPhotosTable.workOrderId, id)));
  res.json({ message: "Photo deleted" });
});

// ── POST /work-orders/:id/signature ───────────────────────────────────────────

router.post("/work-orders/:id/signature", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = SaveWorkOrderSignatureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!wo) { res.status(404).json({ error: "Work order not found" }); return; }

  const userId = req.user!.id;
  const { signatureType, signatureData } = parsed.data;

  // Convert base64 data URI to buffer and upload to object storage
  const base64 = signatureData.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");

  // Get a presigned PUT URL from the sidecar-authenticated storage service
  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

  // Upload directly to the presigned URL — uses the same sidecar auth path as client uploads
  const uploadResponse = await fetch(uploadURL, {
    method: "PUT",
    body: buffer,
    headers: { "Content-Type": "image/png" },
  });
  if (!uploadResponse.ok) {
    res.status(500).json({ error: "Failed to upload signature to object storage" });
    return;
  }

  const [sig] = await db
    .insert(digitalSignaturesTable)
    .values({
      workOrderId: id,
      signatureType,
      signedByUserId: userId,
      signatureImageKey: objectPath,
    })
    .returning();

  // Update WO with signature id
  if (signatureType === "mechanic") {
    await db.update(workOrdersTable).set({ mechanicSignatureId: sig.id, updatedAt: new Date() }).where(eq(workOrdersTable.id, id));
  } else if (signatureType === "supervisor") {
    await db.update(workOrdersTable).set({ supervisorSignatureId: sig.id, updatedAt: new Date() }).where(eq(workOrdersTable.id, id));
  }

  const [sigWithName] = await db
    .select({
      id: digitalSignaturesTable.id,
      workOrderId: digitalSignaturesTable.workOrderId,
      signatureType: digitalSignaturesTable.signatureType,
      signedByUserId: digitalSignaturesTable.signedByUserId,
      signedByName: usersTable.name,
      signatureImageKey: digitalSignaturesTable.signatureImageKey,
      signedAt: digitalSignaturesTable.signedAt,
    })
    .from(digitalSignaturesTable)
    .leftJoin(usersTable, eq(digitalSignaturesTable.signedByUserId, usersTable.id))
    .where(eq(digitalSignaturesTable.id, sig.id));

  res.status(201).json(sigWithName);
});

// ── POST /work-orders/:id/comments ────────────────────────────────────────────

router.post("/work-orders/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = AddWorkOrderCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = req.user!.id;
  const [comment] = await db
    .insert(workOrderCommentsTable)
    .values({ workOrderId: id, authorId: userId, body: parsed.data.body })
    .returning();

  const [commentWithName] = await db
    .select({
      id: workOrderCommentsTable.id,
      workOrderId: workOrderCommentsTable.workOrderId,
      authorId: workOrderCommentsTable.authorId,
      authorName: usersTable.name,
      body: workOrderCommentsTable.body,
      createdAt: workOrderCommentsTable.createdAt,
      updatedAt: workOrderCommentsTable.updatedAt,
    })
    .from(workOrderCommentsTable)
    .leftJoin(usersTable, eq(workOrderCommentsTable.authorId, usersTable.id))
    .where(eq(workOrderCommentsTable.id, comment.id));

  res.status(201).json(commentWithName);
});

// ── POST /work-orders/:id/labour ──────────────────────────────────────────────

router.post("/work-orders/:id/labour", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = AddWorkOrderLabourBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = req.user!.id;
  const mechanicId = parsed.data.mechanicId ?? userId;

  const [entry] = await db
    .insert(workOrderLabourTable)
    .values({
      workOrderId: id,
      mechanicId,
      startTime: new Date(parsed.data.startTime),
      endTime: parsed.data.endTime ? new Date(parsed.data.endTime) : null,
      hoursWorked: parsed.data.hoursWorked ?? null,
      labourType: parsed.data.labourType ?? "regular",
      notes: parsed.data.notes ?? null,
    })
    .returning();

  // Recalculate total labour hours
  const allLabour = await db.select().from(workOrderLabourTable).where(eq(workOrderLabourTable.workOrderId, id));
  const totalLabourHours = allLabour.reduce((s, l) => s + parseFloat(l.hoursWorked ?? "0"), 0).toFixed(2);
  await db.update(workOrdersTable).set({ totalLabourHours, updatedAt: new Date() }).where(eq(workOrdersTable.id, id));

  const [entryWithName] = await db
    .select({
      id: workOrderLabourTable.id,
      workOrderId: workOrderLabourTable.workOrderId,
      mechanicId: workOrderLabourTable.mechanicId,
      mechanicName: usersTable.name,
      startTime: workOrderLabourTable.startTime,
      endTime: workOrderLabourTable.endTime,
      hoursWorked: workOrderLabourTable.hoursWorked,
      labourType: workOrderLabourTable.labourType,
      notes: workOrderLabourTable.notes,
      createdAt: workOrderLabourTable.createdAt,
    })
    .from(workOrderLabourTable)
    .leftJoin(usersTable, eq(workOrderLabourTable.mechanicId, usersTable.id))
    .where(eq(workOrderLabourTable.id, entry.id));

  res.status(201).json(entryWithName);
});

// ── DELETE /work-orders/:id/labour/:labourId ──────────────────────────────────

router.delete("/work-orders/:id/labour/:labourId", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const labourId = Number(req.params.labourId);
  await db.delete(workOrderLabourTable).where(and(eq(workOrderLabourTable.id, labourId), eq(workOrderLabourTable.workOrderId, id)));

  // Recalculate
  const allLabour = await db.select().from(workOrderLabourTable).where(eq(workOrderLabourTable.workOrderId, id));
  const totalLabourHours = allLabour.reduce((s, l) => s + parseFloat(l.hoursWorked ?? "0"), 0).toFixed(2);
  await db.update(workOrdersTable).set({ totalLabourHours, updatedAt: new Date() }).where(eq(workOrdersTable.id, id));

  res.json({ message: "Labour entry deleted" });
});

// ── POST /work-orders/:id/invoices ────────────────────────────────────────────

router.post("/work-orders/:id/invoices", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = AddWorkOrderInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const userId = req.user!.id;
  const [invoice] = await db
    .insert(vendorInvoicesTable)
    .values({
      workOrderId: id,
      vendorName: parsed.data.vendorName,
      invoiceNumber: parsed.data.invoiceNumber,
      invoiceDate: parsed.data.invoiceDate ?? null,
      totalAmount: parsed.data.totalAmount,
      fileKey: parsed.data.fileKey ?? null,
      notes: parsed.data.notes ?? null,
      addedByUserId: userId,
    })
    .returning();

  res.status(201).json(invoice);
});

// ── GET /work-orders/:id/pdf ──────────────────────────────────────────────────

router.get("/work-orders/:id/pdf", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const detail = await getWorkOrderDetail(id, req.user!.companyId!);
  if (!detail) {
    res.status(404).json({ error: "Work order not found" });
    return;
  }

  const [instance] = await db
    .select({ id: checklistInstancesTable.id })
    .from(checklistInstancesTable)
    .where(eq(checklistInstancesTable.workOrderId, id))
    .limit(1);
  const checklist = instance ? await loadChecklistDetail(instance.id) : null;

  generateWorkOrderPdf(
    { ...detail, checklist } as any,
    res,
    req.user!.companyName ?? "Company Workspace"
  );
});

// ── GET /fleet/work-order-alerts ──────────────────────────────────────────────

router.get("/fleet/work-order-alerts", requireAuth, async (_req, res): Promise<void> => {
  const [approvals, qc, waiting] = await Promise.all([
    db.select({ cnt: count() }).from(workOrdersTable).where(eq(workOrdersTable.status, "approval_required")),
    db.select({ cnt: count() }).from(workOrdersTable).where(eq(workOrdersTable.status, "qc_review")),
    db.select({ cnt: count() }).from(workOrdersTable).where(eq(workOrdersTable.status, "waiting_for_part")),
  ]);

  res.json({
    pendingApprovals: approvals[0]?.cnt ?? 0,
    pendingQcReviews: qc[0]?.cnt ?? 0,
    waitingForParts: waiting[0]?.cnt ?? 0,
  });
});

export default router;
