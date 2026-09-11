import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { customersTable, workOrdersTable } from "@workspace/db/schema";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router: IRouter = Router();

const customerInput = z.object({
  customerCode: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  province: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(30).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().optional(),
});

router.get("/customers", requireAuth, async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const companyId = req.user!.companyId!;
  const where = search
    ? and(
        eq(customersTable.companyId, companyId),
        or(
          ilike(customersTable.name, `%${search}%`),
          ilike(customersTable.customerCode, `%${search}%`),
          ilike(customersTable.contactName, `%${search}%`)
        )
      )
    : eq(customersTable.companyId, companyId);

  const rows = await db
    .select({
      id: customersTable.id,
      customerCode: customersTable.customerCode,
      name: customersTable.name,
      contactName: customersTable.contactName,
      email: customersTable.email,
      phone: customersTable.phone,
      addressLine1: customersTable.addressLine1,
      city: customersTable.city,
      province: customersTable.province,
      postalCode: customersTable.postalCode,
      notes: customersTable.notes,
      active: customersTable.active,
      createdAt: customersTable.createdAt,
      updatedAt: customersTable.updatedAt,
      workOrderCount: count(workOrdersTable.id),
    })
    .from(customersTable)
    .leftJoin(workOrdersTable, eq(workOrdersTable.customerId, customersTable.id))
    .where(where)
    .groupBy(customersTable.id)
    .orderBy(asc(customersTable.name));
  res.json(rows);
});

router.post("/customers", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const parsed = customerInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid customer details" });
    return;
  }
  try {
    const [created] = await db.insert(customersTable).values({
      ...parsed.data,
      customerCode: parsed.data.customerCode.toUpperCase(),
      companyId: req.user!.companyId!,
    }).returning();
    res.status(201).json({ ...created, workOrderCount: 0 });
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Customer code is already in use" });
      return;
    }
    throw error;
  }
});

router.patch("/customers/:id", requireAuth, requireRole("admin", "manager"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = customerInput.partial().safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "Invalid customer update" });
    return;
  }
  const changes = {
    ...parsed.data,
    ...(parsed.data.customerCode ? { customerCode: parsed.data.customerCode.toUpperCase() } : {}),
    updatedAt: new Date(),
  };
  try {
    const [updated] = await db.update(customersTable).set(changes)
      .where(and(eq(customersTable.id, id), eq(customersTable.companyId, req.user!.companyId!)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json(updated);
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Customer code is already in use" });
      return;
    }
    throw error;
  }
});

export default router;