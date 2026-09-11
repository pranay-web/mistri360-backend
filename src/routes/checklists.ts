import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  checklistTemplatesTable,
  checklistItemsTable,
  checklistInstancesTable,
  checklistResponsesTable,
  defectsTable,
  workOrdersTable,
  usersTable,
  auditLogTable,
  vehiclesTable,
} from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router: IRouter = Router();
router.use("/checklists/:instanceId", requireAuth, async (req, res, next) => {
  const id = Number(Array.isArray(req.params.instanceId) ? req.params.instanceId[0] : req.params.instanceId);
  const [instance] = await db.select({ id: checklistInstancesTable.id }).from(checklistInstancesTable)
    .innerJoin(vehiclesTable, eq(checklistInstancesTable.vehicleId, vehiclesTable.id))
    .where(and(eq(checklistInstancesTable.id, id), eq(vehiclesTable.companyId, req.user!.companyId!))).limit(1);
  if (!instance) { res.status(404).json({ error: "Checklist not found" }); return; }
  next();
});
router.use("/work-orders/:id/checklist", requireAuth, async (req, res, next) => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [wo] = await db.select({ id: workOrdersTable.id }).from(workOrdersTable)
    .where(and(eq(workOrdersTable.id, id), eq(workOrdersTable.companyId, req.user!.companyId!))).limit(1);
  if (!wo) { res.status(404).json({ error: "Work order not found" }); return; }
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Map work-order type to checklist type
const WO_TYPE_TO_CHECKLIST: Record<string, "pm1" | "pm2" | "trailer" | "reefer"> = {
  pm1: "pm1",
  pm2: "pm2",
  trailer_maintenance: "trailer",
  reefer_maintenance: "reefer",
};

type ChecklistItemStatus =
  | "pass" | "monitor" | "repair_required" | "major_defect" | "out_of_service" | "n_a";

const DEFECT_STATUSES: ChecklistItemStatus[] = ["repair_required", "major_defect", "out_of_service"];

export async function loadChecklistDetail(instanceId: number) {
  const [instance] = await db
    .select({
      id: checklistInstancesTable.id,
      workOrderId: checklistInstancesTable.workOrderId,
      vehicleId: checklistInstancesTable.vehicleId,
      templateId: checklistInstancesTable.templateId,
      checklistType: checklistInstancesTable.checklistType,
      submittedByUserId: checklistInstancesTable.submittedByUserId,
      submittedAt: checklistInstancesTable.submittedAt,
      isLocked: checklistInstancesTable.isLocked,
      createdAt: checklistInstancesTable.createdAt,
      submittedByName: usersTable.name,
    })
    .from(checklistInstancesTable)
    .leftJoin(usersTable, eq(checklistInstancesTable.submittedByUserId, usersTable.id))
    .where(eq(checklistInstancesTable.id, instanceId));

  if (!instance) return null;

  // Get all template items ordered by sort_order
  const items = await db
    .select()
    .from(checklistItemsTable)
    .where(
      and(
        eq(checklistItemsTable.templateId, instance.templateId),
        eq(checklistItemsTable.active, true)
      )
    )
    .orderBy(checklistItemsTable.sortOrder);

  // Get all responses for this instance
  const responses = await db
    .select({
      id: checklistResponsesTable.id,
      itemId: checklistResponsesTable.itemId,
      status: checklistResponsesTable.status,
      notes: checklistResponsesTable.notes,
      measurement: checklistResponsesTable.measurement,
      photoFileKey: checklistResponsesTable.photoFileKey,
      respondedByUserId: checklistResponsesTable.respondedByUserId,
      respondedAt: checklistResponsesTable.respondedAt,
      respondedByName: usersTable.name,
    })
    .from(checklistResponsesTable)
    .leftJoin(usersTable, eq(checklistResponsesTable.respondedByUserId, usersTable.id))
    .where(eq(checklistResponsesTable.instanceId, instanceId));

  const responsesByItemId = new Map(responses.map((r) => [r.itemId, r]));

  const itemsWithResponses = items.map((item) => {
    const resp = responsesByItemId.get(item.id);
    return {
      itemId: item.id,
      templateId: item.templateId,
      category: item.category,
      itemDescription: item.itemDescription,
      requiresMeasurement: item.requiresMeasurement,
      measurementUnit: item.measurementUnit ?? null,
      sortOrder: item.sortOrder,
      active: item.active,
      responseId: resp?.id ?? null,
      status: resp?.status ?? null,
      notes: resp?.notes ?? null,
      measurement: resp?.measurement ?? null,
      photoFileKey: resp?.photoFileKey ?? null,
      respondedByUserId: resp?.respondedByUserId ?? null,
      respondedByName: resp?.respondedByName ?? null,
      respondedAt: resp?.respondedAt ?? null,
    };
  });

  const completedCount = itemsWithResponses.filter((i) => i.status !== null).length;

  return {
    ...instance,
    items: itemsWithResponses,
    completedCount,
    totalCount: itemsWithResponses.length,
  };
}

// ── GET /work-orders/:id/checklist ────────────────────────────────────────────

router.get("/work-orders/:id/checklist", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const woId = Number(req.params.id);
  if (!woId) { res.status(400).json({ error: "Invalid work order id" }); return; }

  // Load the work order
  const [wo] = await db.select().from(workOrdersTable).where(
    and(eq(workOrdersTable.id, woId), eq(workOrdersTable.companyId, req.user!.companyId!))
  );
  if (!wo) { res.status(404).json({ error: "Work order not found" }); return; }

  const checklistType = WO_TYPE_TO_CHECKLIST[wo.workOrderType];
  if (!checklistType) {
    res.status(422).json({ error: `Work order type '${wo.workOrderType}' does not have a checklist` });
    return;
  }

  // Find or create checklist instance
  const [existing] = await db
    .select()
    .from(checklistInstancesTable)
    .where(eq(checklistInstancesTable.workOrderId, woId))
    .limit(1);

  let instanceId: number;

  if (existing) {
    instanceId = existing.id;
  } else {
    // Find template
    const [tmpl] = await db
      .select()
      .from(checklistTemplatesTable)
      .where(
        and(
          eq(checklistTemplatesTable.checklistType, checklistType),
          eq(checklistTemplatesTable.active, true)
        )
      )
      .limit(1);

    if (!tmpl) {
      res.status(422).json({ error: `No active checklist template found for type '${checklistType}'. Run seed-checklists script.` });
      return;
    }

    const [inst] = await db
      .insert(checklistInstancesTable)
      .values({
        workOrderId: woId,
        vehicleId: wo.vehicleId,
        templateId: tmpl.id,
        checklistType: checklistType as any,
      })
      .returning({ id: checklistInstancesTable.id });

    instanceId = inst.id;

    await db.insert(auditLogTable).values({
      tableName: "checklist_instances",
      recordId: instanceId,
      action: "create",
      changedByUserId: req.user!.id,
      changedByName: req.user!.name,
      newValue: checklistType,
    });
  }

  const detail = await loadChecklistDetail(instanceId);
  res.json(detail);
});

// ── PATCH /work-orders/:id/checklist/items/:itemId ────────────────────────────

router.patch("/work-orders/:id/checklist/items/:itemId", requireRole("admin", "mechanic"), async (req, res): Promise<void> => {
  const woId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!woId || !itemId) { res.status(400).json({ error: "Invalid id" }); return; }

  const VALID_STATUSES: ChecklistItemStatus[] = [
    "pass", "monitor", "repair_required", "major_defect", "out_of_service", "n_a",
  ];

  const { status, notes, measurement, photoFileKey } = req.body as {
    status?: string;
    notes?: string;
    measurement?: string;
    photoFileKey?: string;
  };

  if (!status || !VALID_STATUSES.includes(status as ChecklistItemStatus)) {
    res.status(422).json({
      error: `status is required and must be one of: ${VALID_STATUSES.join(", ")}`,
    });
    return;
  }

  const validStatus = status as ChecklistItemStatus;

  // Find the instance
  const [instance] = await db
    .select()
    .from(checklistInstancesTable)
    .where(eq(checklistInstancesTable.workOrderId, woId))
    .limit(1);

  if (!instance) { res.status(404).json({ error: "Checklist not found. GET the checklist first to initialize it." }); return; }
  if (instance.isLocked) { res.status(422).json({ error: "Checklist is locked and cannot be modified" }); return; }

  // Verify item belongs to this template
  const [item] = await db
    .select()
    .from(checklistItemsTable)
    .where(and(eq(checklistItemsTable.id, itemId), eq(checklistItemsTable.templateId, instance.templateId)));

  if (!item) { res.status(404).json({ error: "Checklist item not found in this template" }); return; }

  // Validate: major_defect and out_of_service require notes
  if ((validStatus === "major_defect" || validStatus === "out_of_service") && !notes?.trim()) {
    res.status(422).json({ error: `Status '${validStatus}' requires a note describing the issue` });
    return;
  }

  const now = new Date();

  // Upsert the response
  const existing = await db
    .select()
    .from(checklistResponsesTable)
    .where(
      and(
        eq(checklistResponsesTable.instanceId, instance.id),
        eq(checklistResponsesTable.itemId, itemId)
      )
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(checklistResponsesTable)
      .set({
        status: validStatus as any,
        notes: notes ?? existing[0].notes,
        measurement: measurement ?? existing[0].measurement,
        photoFileKey: photoFileKey ?? existing[0].photoFileKey,
        respondedByUserId: req.user!.id,
        updatedAt: now,
      })
      .where(eq(checklistResponsesTable.id, existing[0].id));
  } else {
    await db.insert(checklistResponsesTable).values({
      instanceId: instance.id,
      itemId,
      status: validStatus as any,
      notes: notes ?? null,
      measurement: measurement ?? null,
      photoFileKey: photoFileKey ?? null,
      respondedByUserId: req.user!.id,
      respondedAt: now,
      updatedAt: now,
    });
  }

  // Return the item + response
  const [updatedResp] = await db
    .select({
      id: checklistResponsesTable.id,
      itemId: checklistResponsesTable.itemId,
      status: checklistResponsesTable.status,
      notes: checklistResponsesTable.notes,
      measurement: checklistResponsesTable.measurement,
      photoFileKey: checklistResponsesTable.photoFileKey,
      respondedByUserId: checklistResponsesTable.respondedByUserId,
      respondedAt: checklistResponsesTable.respondedAt,
      respondedByName: usersTable.name,
    })
    .from(checklistResponsesTable)
    .leftJoin(usersTable, eq(checklistResponsesTable.respondedByUserId, usersTable.id))
    .where(
      and(
        eq(checklistResponsesTable.instanceId, instance.id),
        eq(checklistResponsesTable.itemId, itemId)
      )
    );

  res.json({
    itemId: item.id,
    templateId: item.templateId,
    category: item.category,
    itemDescription: item.itemDescription,
    requiresMeasurement: item.requiresMeasurement,
    measurementUnit: item.measurementUnit ?? null,
    sortOrder: item.sortOrder,
    active: item.active,
    responseId: updatedResp.id,
    status: updatedResp.status,
    notes: updatedResp.notes,
    measurement: updatedResp.measurement,
    photoFileKey: updatedResp.photoFileKey,
    respondedByUserId: updatedResp.respondedByUserId,
    respondedByName: updatedResp.respondedByName,
    respondedAt: updatedResp.respondedAt,
  });
});

// ── POST /work-orders/:id/checklist/submit ────────────────────────────────────

router.post("/work-orders/:id/checklist/submit", requireRole("admin", "mechanic"), async (req, res): Promise<void> => {
  const woId = Number(req.params.id);
  if (!woId) { res.status(400).json({ error: "Invalid work order id" }); return; }

  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, woId));
  if (!wo) { res.status(404).json({ error: "Work order not found" }); return; }

  const [instance] = await db
    .select()
    .from(checklistInstancesTable)
    .where(eq(checklistInstancesTable.workOrderId, woId))
    .limit(1);

  if (!instance) { res.status(404).json({ error: "No checklist found for this work order" }); return; }
  if (instance.isLocked) { res.status(422).json({ error: "Checklist is already submitted" }); return; }

  // Load full detail to check completeness
  const detail = await loadChecklistDetail(instance.id);
  if (!detail) { res.status(500).json({ error: "Could not load checklist" }); return; }

  const unanswered = detail.items.filter((i) => i.status === null);
  if (unanswered.length > 0) {
    res.status(422).json({
      error: `${unanswered.length} item(s) still require a response before submitting`,
      unanswered: unanswered.map((i) => ({ itemId: i.itemId, description: i.itemDescription })),
    });
    return;
  }

  // Lock the checklist
  const now = new Date();
  await db
    .update(checklistInstancesTable)
    .set({ isLocked: true, submittedByUserId: req.user!.id, submittedAt: now })
    .where(eq(checklistInstancesTable.id, instance.id));

  // Auto-create defects for flagged items
  const defectItems = detail.items.filter(
    (i) => i.status && DEFECT_STATUSES.includes(i.status as ChecklistItemStatus)
  );

  let defectsCreated = 0;
  for (const item of defectItems) {
    const severity =
      item.status === "out_of_service"
        ? "out_of_service"
        : item.status === "major_defect"
        ? "major"
        : "minor";

    await db.insert(defectsTable).values({
      vehicleId: instance.vehicleId,
      reportedByUserId: req.user!.id,
      source: "checklist",
      severity: severity as any,
      status: "open",
      description: `[${item.category}] ${item.itemDescription}${item.notes ? ` — ${item.notes}` : ""}`,
      location: item.category,
      workOrderId: woId,
      checklistInstanceId: instance.id,
      checklistItemId: item.itemId,
      odometerAtReport: wo.odometerAtService ?? null,
    });
    defectsCreated++;
  }

  // Audit log
  await db.insert(auditLogTable).values({
    tableName: "checklist_instances",
    recordId: instance.id,
    action: "status_change",
    changedByUserId: req.user!.id,
    changedByName: req.user!.name,
    oldValue: "open",
    newValue: "submitted",
    metadata: { defectsCreated, workOrderId: woId } as any,
  });

  res.json({ instanceId: instance.id, defectsCreated });
});

// ── GET /checklists ───────────────────────────────────────────────────────────

router.get("/checklists", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const { workOrderId, checklistType, locked } = req.query as Record<string, string>;

  const conditions: any[] = [eq(vehiclesTable.companyId, req.user!.companyId!)];
  if (workOrderId) conditions.push(eq(checklistInstancesTable.workOrderId, Number(workOrderId)));
  if (checklistType) conditions.push(eq(checklistInstancesTable.checklistType, checklistType as any));
  if (locked !== undefined) conditions.push(eq(checklistInstancesTable.isLocked, locked === "true"));

  const instances = await db
    .select({
      id: checklistInstancesTable.id,
      workOrderId: checklistInstancesTable.workOrderId,
      checklistType: checklistInstancesTable.checklistType,
      isLocked: checklistInstancesTable.isLocked,
      submittedAt: checklistInstancesTable.submittedAt,
      createdAt: checklistInstancesTable.createdAt,
      submittedByName: usersTable.name,
      woNumber: workOrdersTable.woNumber,
      vehicleUnitNumber: vehiclesTable.unitNumber,
    })
    .from(checklistInstancesTable)
    .leftJoin(usersTable, eq(checklistInstancesTable.submittedByUserId, usersTable.id))
    .leftJoin(workOrdersTable, eq(checklistInstancesTable.workOrderId, workOrdersTable.id))
    .leftJoin(vehiclesTable, eq(checklistInstancesTable.vehicleId, vehiclesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(checklistInstancesTable.createdAt);

  // Attach completion counts via subquery for each
  const results = await Promise.all(
    instances.map(async (inst) => {
      const [counts] = await db
        .select({
          totalCount: sql<number>`count(*)::int`,
          completedCount: sql<number>`count(*) filter (where ${checklistResponsesTable.status} is not null)::int`,
          defectCount: sql<number>`count(*) filter (where ${checklistResponsesTable.status} in ('repair_required','major_defect','out_of_service'))::int`,
        })
        .from(checklistItemsTable)
        .leftJoin(
          checklistResponsesTable,
          and(
            eq(checklistResponsesTable.itemId, checklistItemsTable.id),
            eq(checklistResponsesTable.instanceId, inst.id)
          )
        )
        .where(
          and(
            eq(checklistItemsTable.active, true),
            // need template join
            sql`${checklistItemsTable.templateId} = (select template_id from checklist_instances where id = ${inst.id})`
          )
        );
      return { ...inst, ...counts };
    })
  );

  res.json(results);
});

// ── GET /checklists/:instanceId ───────────────────────────────────────────────

router.get("/checklists/:instanceId", requireRole("admin", "manager", "mechanic"), async (req, res): Promise<void> => {
  const instanceId = Number(req.params.instanceId);
  if (!instanceId) { res.status(400).json({ error: "Invalid instance id" }); return; }

  const detail = await loadChecklistDetail(instanceId);
  if (!detail) { res.status(404).json({ error: "Checklist not found" }); return; }

  res.json(detail);
});

export default router;
