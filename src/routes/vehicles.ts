import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  pmSchedulesTable,
  pmRemindersTable,
  vehicleStatusHistoryTable,
  auditLogTable,
} from "@workspace/db/schema";
import { eq, and, or, like, ilike, inArray, sql } from "drizzle-orm";
import {
  ListVehiclesQueryParams,
  CreateVehicleBody,
  GetVehicleParams,
  UpdateVehicleParams,
  UpdateVehicleBody,
  DeleteVehicleParams,
  UpdateVehicleStatusParams,
  UpdateVehicleStatusBody,
  UpdateVehicleOdometerParams,
  UpdateVehicleOdometerBody,
  GetVehiclePmSchedulesParams,
  UpsertVehiclePmSchedulesParams,
  UpsertVehiclePmSchedulesBody,
  GetVehicleRemindersParams,
  GetVehicleHistoryParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { checkVehiclePmReminders } from "../lib/pm-scheduler.js";

const router: IRouter = Router();
const tenantVehicle = (id: number, companyId: number) =>
  db.select({ id: vehiclesTable.id }).from(vehiclesTable).where(
    and(eq(vehiclesTable.id, id), eq(vehiclesTable.companyId, companyId))
  ).limit(1);

// ── Urgency helpers ─────────────────────────────────────────────────────────

const TODAY_STR = () => new Date().toISOString().split("T")[0];

function getDueSoonDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split("T")[0];
}

function computePmUrgency(vehicle: typeof vehiclesTable.$inferSelect): "overdue" | "due_soon" | "ok" | null {
  const today = TODAY_STR();
  const dueSoon = getDueSoonDate();

  const dates = [
    vehicle.pm1DueDate,
    vehicle.pm2DueDate,
    vehicle.greasingDueDate,
    vehicle.pmcviDueDate,
    vehicle.usAnnualDueDate,
  ].filter(Boolean) as string[];

  const odoPairs: Array<{ due: number | null }> = [
    { due: vehicle.pm1DueOdometer },
    { due: vehicle.pm2DueOdometer },
    { due: vehicle.greasingDueOdometer },
  ];

  // Check overdue first
  for (const d of dates) {
    if (d <= today) return "overdue";
  }
  for (const { due } of odoPairs) {
    if (due !== null && vehicle.currentOdometer >= due) return "overdue";
  }

  // Check due soon
  for (const d of dates) {
    if (d <= dueSoon) return "due_soon";
  }
  for (const { due } of odoPairs) {
    if (due !== null && vehicle.currentOdometer >= due - 5000) return "due_soon";
  }

  return dates.length > 0 || odoPairs.some((p) => p.due !== null) ? "ok" : null;
}

// ── GET /vehicles ────────────────────────────────────────────────────────────

router.get("/vehicles", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListVehiclesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, type, status, urgency } = parsed.data;

  let vehicles = await db.select().from(vehiclesTable)
    .where(eq(vehiclesTable.companyId, req.user!.companyId!)).orderBy(vehiclesTable.unitNumber);

  // In-JS filtering (small table; move to SQL if perf matters)
  if (type) vehicles = vehicles.filter((v) => v.vehicleType === type);
  if (status) vehicles = vehicles.filter((v) => v.status === status);
  if (search) {
    const q = search.toLowerCase();
    vehicles = vehicles.filter(
      (v) =>
        v.unitNumber.toLowerCase().includes(q) ||
        v.vin.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        v.licensePlate.toLowerCase().includes(q)
    );
  }

  const withUrgency = vehicles.map((v) => ({
    ...v,
    pmUrgency: computePmUrgency(v),
  }));

  const filtered =
    urgency
      ? withUrgency.filter((v) => v.pmUrgency === urgency)
      : withUrgency;

  res.json(filtered);
});

// ── POST /vehicles ───────────────────────────────────────────────────────────

router.post("/vehicles", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const parsed = CreateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [vehicle] = await db
      .insert(vehiclesTable)
      .values({
        ...parsed.data,
        currentOdometer: parsed.data.currentOdometer ?? 0,
        companyId: req.user!.companyId!,
      })
      .returning();

    // Log audit
    await db.insert(auditLogTable).values({
      tableName: "vehicles",
      recordId: vehicle.id,
      action: "create",
      changedByUserId: req.user!.id,
      changedByName: req.user!.name,
      metadata: { unitNumber: vehicle.unitNumber },
    });

    // Initial PM check
    await checkVehiclePmReminders(vehicle.id);

    res.status(201).json(vehicle);
  } catch (error: any) {
    if (error.code === '23505') {
      if (error.detail?.includes('unitNumber')) {
        res.status(409).json({ error: "Vehicle unit number already exists" });
      } else if (error.detail?.includes('vin')) {
        res.status(409).json({ error: "Vehicle VIN already in use" });
      } else if (error.detail?.includes('licensePlate')) {
        res.status(409).json({ error: "License plate already registered" });
      } else {
        res.status(409).json({ error: "Vehicle already exists with this information" });
      }
      return;
    }
    req.log.error({ err: error }, "Error creating vehicle");
    res.status(500).json({ error: "Failed to create vehicle" });
  }
});

// ── GET /vehicles/:id ────────────────────────────────────────────────────────

router.get("/vehicles/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  res.json(vehicle);
});

// ── PATCH /vehicles/:id ──────────────────────────────────────────────────────

router.patch("/vehicles/:id", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const params = UpdateVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)));

  if (!existing) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // Validate odometer never decreases (prevent rollback vulnerability)
  if (parsed.data.currentOdometer !== undefined && parsed.data.currentOdometer !== null) {
    if (parsed.data.currentOdometer < existing.currentOdometer) {
      res.status(422).json({ error: `Odometer cannot decrease. Current: ${existing.currentOdometer}km, Attempted: ${parsed.data.currentOdometer}km` });
      return;
    }
  }

  try {
    const [updated] = await db
      .update(vehiclesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)))
      .returning();

    // Audit changed fields
    for (const [field, newVal] of Object.entries(parsed.data)) {
      const oldVal = existing[field as keyof typeof existing];
      if (String(oldVal) !== String(newVal)) {
        await db.insert(auditLogTable).values({
          tableName: "vehicles",
          recordId: updated.id,
          action: "update",
          changedByUserId: req.user!.id,
          changedByName: req.user!.name,
          fieldName: field,
          oldValue: String(oldVal ?? ""),
          newValue: String(newVal ?? ""),
        });
      }
    }

    await checkVehiclePmReminders(updated.id);

    res.json(updated);
  } catch (error: any) {
    if (error.code === '23505') {
      if (error.detail?.includes('unitNumber')) {
        res.status(409).json({ error: "Vehicle unit number already exists" });
      } else if (error.detail?.includes('vin')) {
        res.status(409).json({ error: "Vehicle VIN already in use" });
      } else if (error.detail?.includes('licensePlate')) {
        res.status(409).json({ error: "License plate already registered" });
      } else {
        res.status(409).json({ error: "Vehicle already exists with this information" });
      }
      return;
    }
    req.log.error({ err: error }, "Error updating vehicle");
    res.status(500).json({ error: "Failed to update vehicle" });
  }
});

// ── DELETE /vehicles/:id ─────────────────────────────────────────────────────

router.delete("/vehicles/:id", requireAuth, requireRole("admin"), async (req, res): Promise<void> => {
  const params = DeleteVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)));

  if (!existing) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  try {
    // Soft delete: mark as inactive instead of hard delete to preserve foreign key references
    const [updated] = await db
      .update(vehiclesTable)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(vehiclesTable.id, params.data.id))
      .returning();

    await db.insert(auditLogTable).values({
      tableName: "vehicles",
      recordId: params.data.id,
      action: "delete",
      changedByUserId: req.user!.id,
      changedByName: req.user!.name,
      metadata: { softDelete: true, reason: "Vehicle deactivated" } as any,
    });

    res.json({ success: true, message: "Vehicle deactivated and archived" });
  } catch (error: any) {
    if (error.code === '23503') {
      res.status(409).json({
        error: "Cannot delete vehicle with active maintenance records. Vehicle has been deactivated instead."
      });
      return;
    }
    req.log.error({ err: error }, "Error deleting vehicle");
    res.status(500).json({ error: "Failed to delete vehicle" });
  }
});

// ── PATCH /vehicles/:id/status ───────────────────────────────────────────────

router.patch("/vehicles/:id/status", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const params = UpdateVehicleStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateVehicleStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)));

  if (!existing) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const [updated] = await db
    .update(vehiclesTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)))
    .returning();

  // Record status history
  await db.insert(vehicleStatusHistoryTable).values({
    vehicleId: updated.id,
    fromStatus: existing.status,
    toStatus: parsed.data.status as typeof updated.status,
    reason: parsed.data.reason ?? null,
    changedByUserId: req.user!.id,
  });

  // Audit log
  await db.insert(auditLogTable).values({
    tableName: "vehicles",
    recordId: updated.id,
    action: "status_change",
    changedByUserId: req.user!.id,
    changedByName: req.user!.name,
    fieldName: "status",
    oldValue: existing.status,
    newValue: parsed.data.status,
  });

  res.json(updated);
});

// ── POST /vehicles/:id/odometer ──────────────────────────────────────────────

router.post("/vehicles/:id/odometer", requireAuth, requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const params = UpdateVehicleOdometerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateVehicleOdometerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)));

  if (!existing) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // Validate readings are non-negative and non-decreasing
  if (parsed.data.odometer !== undefined) {
    if (parsed.data.odometer < 0) {
      res.status(400).json({ error: "Odometer cannot be negative" });
      return;
    }
    if (parsed.data.odometer < existing.currentOdometer) {
      res.status(400).json({ error: `Odometer cannot be less than current reading (${existing.currentOdometer} km)` });
      return;
    }
  }
  if (parsed.data.engineHours !== undefined && existing.engineHours !== null) {
    const newHours = parseFloat(parsed.data.engineHours);
    const currentHours = parseFloat(existing.engineHours);
    if (isNaN(newHours) || newHours < 0) {
      res.status(400).json({ error: "Engine hours must be a non-negative number" });
      return;
    }
    if (newHours < currentHours) {
      res.status(400).json({ error: `Engine hours cannot be less than current reading (${currentHours})` });
      return;
    }
  }
  if (parsed.data.reeferHours !== undefined && existing.reeferHours !== null) {
    const newHours = parseFloat(parsed.data.reeferHours);
    const currentHours = parseFloat(existing.reeferHours);
    if (isNaN(newHours) || newHours < 0) {
      res.status(400).json({ error: "Reefer hours must be a non-negative number" });
      return;
    }
    if (newHours < currentHours) {
      res.status(400).json({ error: `Reefer hours cannot be less than current reading (${currentHours})` });
      return;
    }
  }

  const updates: Partial<typeof vehiclesTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.odometer !== undefined) updates.currentOdometer = parsed.data.odometer;
  if (parsed.data.engineHours !== undefined) updates.engineHours = parsed.data.engineHours;
  if (parsed.data.reeferHours !== undefined) updates.reeferHours = parsed.data.reeferHours;

  const [updated] = await db
    .update(vehiclesTable)
    .set(updates)
    .where(and(eq(vehiclesTable.id, params.data.id), eq(vehiclesTable.companyId, req.user!.companyId!)))
    .returning();

  // Run PM checks after odometer update
  await checkVehiclePmReminders(updated.id);

  res.json(updated);
});

// ── GET /vehicles/:id/pm-schedules ──────────────────────────────────────────

router.get("/vehicles/:id/pm-schedules", requireAuth, async (req, res): Promise<void> => {
  const params = GetVehiclePmSchedulesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await tenantVehicle(params.data.id, req.user!.companyId!))[0]) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const schedules = await db
    .select()
    .from(pmSchedulesTable)
    .where(eq(pmSchedulesTable.vehicleId, params.data.id));

  res.json(schedules);
});

// ── PUT /vehicles/:id/pm-schedules ──────────────────────────────────────────

router.put("/vehicles/:id/pm-schedules", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const params = UpsertVehiclePmSchedulesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpsertVehiclePmSchedulesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const vehicleId = params.data.id;

  // Verify vehicle exists
  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.companyId, req.user!.companyId!)));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // Upsert each schedule entry
  const results = [];
  for (const entry of parsed.data.schedules) {
    const [upserted] = await db
      .insert(pmSchedulesTable)
      .values({ vehicleId, ...entry })
      .onConflictDoUpdate({
        target: [pmSchedulesTable.vehicleId, pmSchedulesTable.pmType],
        set: {
          intervalKm: entry.intervalKm ?? null,
          intervalEngineHours: entry.intervalEngineHours ?? null,
          intervalReeferHours: entry.intervalReeferHours ?? null,
          intervalDays: entry.intervalDays ?? null,
        },
      })
      .returning();
    results.push(upserted);
  }

  await checkVehiclePmReminders(vehicleId);

  res.json(results);
});

// ── GET /vehicles/:id/reminders ──────────────────────────────────────────────

router.get("/vehicles/:id/reminders", requireAuth, async (req, res): Promise<void> => {
  const params = GetVehicleRemindersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await tenantVehicle(params.data.id, req.user!.companyId!))[0]) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const reminders = await db
    .select()
    .from(pmRemindersTable)
    .where(eq(pmRemindersTable.vehicleId, params.data.id))
    .orderBy(pmRemindersTable.createdAt);

  res.json(reminders);
});

// ── GET /vehicles/:id/history ────────────────────────────────────────────────

router.get("/vehicles/:id/history", requireAuth, async (req, res): Promise<void> => {
  const params = GetVehicleHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await tenantVehicle(params.data.id, req.user!.companyId!))[0]) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const { usersTable } = await import("@workspace/db/schema");

  const history = await db
    .select({
      id: vehicleStatusHistoryTable.id,
      vehicleId: vehicleStatusHistoryTable.vehicleId,
      fromStatus: vehicleStatusHistoryTable.fromStatus,
      toStatus: vehicleStatusHistoryTable.toStatus,
      reason: vehicleStatusHistoryTable.reason,
      changedByName: usersTable.name,
      createdAt: vehicleStatusHistoryTable.createdAt,
    })
    .from(vehicleStatusHistoryTable)
    .leftJoin(usersTable, eq(vehicleStatusHistoryTable.changedByUserId, usersTable.id))
    .where(eq(vehicleStatusHistoryTable.vehicleId, params.data.id))
    .orderBy(vehicleStatusHistoryTable.createdAt);

  res.json(history);
});

export default router;
