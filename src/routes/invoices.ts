import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  customersTable, invoicesTable, invoiceLineItemsTable, vehiclesTable,
  estimatesTable, workOrdersTable, estimateLineItemsTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { generateInvoicePdf } from "../lib/pdf-generator.js";

const router: IRouter = Router();
const roles = requireRole("admin", "manager");

const invoiceInput = z.object({
  customerId: z.number().int().positive(),
  vehicleId: z.number().int().positive().nullable().optional(),
  vehicleDescription: z.string().trim().max(240).nullable().optional(),
  title: z.string().trim().min(1).max(180),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  terms: z.string().trim().max(4000).nullable().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  fromEstimateId: z.number().int().positive().optional(),
  fromWorkOrderId: z.number().int().positive().optional(),
});
const lineInput = z.object({
  lineType: z.enum(["service", "labour", "part", "fee"]).default("service"),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(100000),
  unitPrice: z.coerce.number().min(0).max(10000000),
});
const statusInput = z.object({
  status: z.enum(["draft", "sent", "paid", "overdue", "void"]),
  paymentMethod: z.string().trim().min(1).max(100).optional(),
});

async function loadInvoice(id: number, companyId: number) {
  const [invoice] = await db.select({
    id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
    customerId: invoicesTable.customerId, customerName: customersTable.name,
    customerCode: customersTable.customerCode, contactName: customersTable.contactName,
    customerEmail: customersTable.email, customerPhone: customersTable.phone,
    customerAddress: customersTable.addressLine1, customerCity: customersTable.city,
    customerProvince: customersTable.province, customerPostalCode: customersTable.postalCode,
    vehicleId: invoicesTable.vehicleId, vehicleUnitNumber: vehiclesTable.unitNumber,
    vehicleDescription: invoicesTable.vehicleDescription, title: invoicesTable.title,
    status: invoicesTable.status, issueDate: invoicesTable.issueDate,
    dueDate: invoicesTable.dueDate, notes: invoicesTable.notes, terms: invoicesTable.terms,
    taxRate: invoicesTable.taxRate, subtotal: invoicesTable.subtotal,
    taxAmount: invoicesTable.taxAmount, total: invoicesTable.total,
    amountPaid: invoicesTable.amountPaid, paidAt: invoicesTable.paidAt,
    paymentMethod: invoicesTable.paymentMethod, paymentReference: invoicesTable.paymentReference,
    sourceEstimateId: invoicesTable.sourceEstimateId, sourceWorkOrderId: invoicesTable.sourceWorkOrderId,
    createdAt: invoicesTable.createdAt, updatedAt: invoicesTable.updatedAt,
  }).from(invoicesTable)
    .innerJoin(customersTable, and(
      eq(invoicesTable.customerId, customersTable.id),
      eq(customersTable.companyId, companyId),
    ))
    .leftJoin(vehiclesTable, and(
      eq(invoicesTable.vehicleId, vehiclesTable.id),
      eq(vehiclesTable.companyId, companyId),
    ))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, companyId)));
  if (!invoice) return null;
  const lineItems = await db.select().from(invoiceLineItemsTable)
    .where(eq(invoiceLineItemsTable.invoiceId, id))
    .orderBy(asc(invoiceLineItemsTable.sortOrder), asc(invoiceLineItemsTable.id));
  return { ...invoice, lineItems };
}

async function recalculate(id: number, executor: any = db) {
  const lines = await executor.select({ total: invoiceLineItemsTable.lineTotal })
    .from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id));
  const [invoice] = await executor.select({ taxRate: invoicesTable.taxRate })
    .from(invoicesTable).where(eq(invoicesTable.id, id));
  const subtotalCents = lines.reduce(
    (sum: number, line: { total: string }) => sum + Math.round(Number(line.total) * 100),
    0,
  );
  const taxRateMilliPercent = Math.round(Number(invoice?.taxRate ?? 0) * 1000);
  const taxCents = Math.round(subtotalCents * taxRateMilliPercent / 100000);
  await executor.update(invoicesTable).set({
    subtotal: (subtotalCents / 100).toFixed(2), taxAmount: (taxCents / 100).toFixed(2),
    total: ((subtotalCents + taxCents) / 100).toFixed(2), updatedAt: new Date(),
  }).where(eq(invoicesTable.id, id));
}

router.get("/invoices", requireAuth, roles, async (req, res): Promise<void> => {
  const rows = await db.select({
    id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
    title: invoicesTable.title, status: invoicesTable.status,
    customerId: invoicesTable.customerId, customerName: customersTable.name,
    vehicleId: invoicesTable.vehicleId, vehicleUnitNumber: vehiclesTable.unitNumber,
    vehicleDescription: invoicesTable.vehicleDescription, issueDate: invoicesTable.issueDate,
    dueDate: invoicesTable.dueDate, subtotal: invoicesTable.subtotal,
    taxAmount: invoicesTable.taxAmount, total: invoicesTable.total,
    amountPaid: invoicesTable.amountPaid, paidAt: invoicesTable.paidAt,
    createdAt: invoicesTable.createdAt,
  }).from(invoicesTable)
    .innerJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .leftJoin(vehiclesTable, eq(invoicesTable.vehicleId, vehiclesTable.id))
    .where(eq(invoicesTable.companyId, req.user!.companyId!))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(rows);
});

router.post("/invoices", requireAuth, roles, async (req, res): Promise<void> => {
  const parsed = invoiceInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const companyId = req.user!.companyId!;
  const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
    .where(and(eq(customersTable.id, parsed.data.customerId), eq(customersTable.companyId, companyId), eq(customersTable.active, true)));
  if (!customer) { res.status(400).json({ error: "Active customer not found" }); return; }
  if (parsed.data.vehicleId) {
    const [vehicle] = await db.select({ id: vehiclesTable.id }).from(vehiclesTable)
      .where(and(eq(vehiclesTable.id, parsed.data.vehicleId), eq(vehiclesTable.companyId, companyId)));
    if (!vehicle) { res.status(400).json({ error: "Vehicle not found" }); return; }
  }

  let sourceEstimate: any = null;
  let sourceWorkOrder: any = null;
  if (parsed.data.fromEstimateId) {
    const [est] = await db.select({
      customerId: estimatesTable.customerId, vehicleId: estimatesTable.vehicleId,
      title: estimatesTable.title, taxRate: estimatesTable.taxRate,
    }).from(estimatesTable)
      .where(and(eq(estimatesTable.id, parsed.data.fromEstimateId), eq(estimatesTable.companyId, companyId), eq(estimatesTable.status, "approved")));
    if (!est) { res.status(400).json({ error: "Approved estimate not found" }); return; }
    sourceEstimate = est;
  }
  if (parsed.data.fromWorkOrderId) {
    const [wo] = await db.select({
      customerId: workOrdersTable.customerId, vehicleId: workOrdersTable.vehicleId,
      description: workOrdersTable.description,
    }).from(workOrdersTable)
      .where(and(eq(workOrdersTable.id, parsed.data.fromWorkOrderId), eq(workOrdersTable.companyId, companyId), eq(workOrdersTable.status, "completed")));
    if (!wo) { res.status(400).json({ error: "Completed work order not found" }); return; }
    sourceWorkOrder = wo;
  }

  const year = new Date().getFullYear();
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${companyId}, ${year})`);
    const [row] = await tx.select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(${invoicesTable.invoiceNumber}, '-', 3) AS INTEGER)), 0)`,
    }).from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), sql`EXTRACT(YEAR FROM ${invoicesTable.createdAt}) = ${year}`));
    const invoiceNumber = `INV-${year}-${String(Number(row?.maxSeq ?? 0) + 1).padStart(4, "0")}`;
    const now = new Date();
    const issueDate = parsed.data.issueDate ? new Date(`${parsed.data.issueDate}T00:00:00`) : now;
    const dueDate = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T23:59:59`) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [record] = await tx.insert(invoicesTable).values({
      companyId, invoiceNumber,
      customerId: sourceEstimate?.customerId ?? sourceWorkOrder?.customerId ?? parsed.data.customerId,
      vehicleId: sourceEstimate?.vehicleId ?? sourceWorkOrder?.vehicleId ?? parsed.data.vehicleId ?? null,
      vehicleDescription: parsed.data.vehicleDescription ?? null,
      sourceEstimateId: parsed.data.fromEstimateId ?? null,
      sourceWorkOrderId: parsed.data.fromWorkOrderId ?? null,
      title: sourceEstimate?.title ?? parsed.data.title,
      issueDate, dueDate,
      notes: parsed.data.notes ?? null, terms: parsed.data.terms ?? null,
      taxRate: Number(sourceEstimate?.taxRate ?? parsed.data.taxRate ?? 13).toFixed(3),
      createdByUserId: req.user!.id,
    }).returning({ id: invoicesTable.id });

    // Copy line items from estimate if provided
    if (sourceEstimate && parsed.data.fromEstimateId) {
      const estLines = await tx.select().from(estimateLineItemsTable)
        .where(eq(estimateLineItemsTable.estimateId, parsed.data.fromEstimateId));
      let sortOrder = 0;
      for (const line of estLines) {
        await tx.insert(invoiceLineItemsTable).values({
          invoiceId: record.id,
          lineType: line.lineType,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          sortOrder: sortOrder++,
        });
      }
    } else if (sourceWorkOrder) {
      // Add work order description as a single line item
      await tx.insert(invoiceLineItemsTable).values({
        invoiceId: record.id,
        lineType: "service",
        description: sourceWorkOrder.description || "Work Order Service",
        quantity: "1",
        unitPrice: "0",
        lineTotal: "0",
        sortOrder: 0,
      });
    }

    return record;
  });
  res.status(201).json(await loadInvoice(created.id, companyId));
});

router.get("/invoices/:id", requireAuth, roles, async (req, res): Promise<void> => {
  const detail = await loadInvoice(Number(req.params.id), req.user!.companyId!);
  if (!detail) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(detail);
});

router.patch("/invoices/:id", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = invoiceInput.partial().safeParse(req.body);
  const existing = await loadInvoice(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!parsed.success || existing.status !== "draft") {
    res.status(400).json({ error: !parsed.success ? "Invalid invoice update" : "Only draft invoices can be edited" }); return;
  }
  if (parsed.data.customerId !== undefined) {
    const [customer] = await db.select({ id: customersTable.id }).from(customersTable).where(and(
      eq(customersTable.id, parsed.data.customerId),
      eq(customersTable.companyId, req.user!.companyId!),
      eq(customersTable.active, true),
    ));
    if (!customer) { res.status(400).json({ error: "Active customer not found" }); return; }
  }
  if (parsed.data.vehicleId) {
    const [vehicle] = await db.select({ id: vehiclesTable.id }).from(vehiclesTable).where(and(
      eq(vehiclesTable.id, parsed.data.vehicleId),
      eq(vehiclesTable.companyId, req.user!.companyId!),
    ));
    if (!vehicle) { res.status(400).json({ error: "Vehicle not found" }); return; }
  }
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765433, ${id})`);
    const [current] = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
      eq(invoicesTable.id, id), eq(invoicesTable.companyId, req.user!.companyId!), eq(invoicesTable.status, "draft"),
    ));
    if (!current) return false;
    await tx.update(invoicesTable).set({
      ...parsed.data,
      taxRate: parsed.data.taxRate === undefined ? undefined : Number(parsed.data.taxRate).toFixed(3),
      issueDate: parsed.data.issueDate === undefined ? undefined : parsed.data.issueDate ? new Date(`${parsed.data.issueDate}T00:00:00`) : null,
      dueDate: parsed.data.dueDate === undefined ? undefined : parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T23:59:59`) : null,
      updatedAt: new Date(),
    } as any).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, req.user!.companyId!), eq(invoicesTable.status, "draft")));
    await recalculate(id, tx);
    return true;
  });
  if (!changed) { res.status(409).json({ error: "Invoice is no longer editable" }); return; }
  res.json(await loadInvoice(id, req.user!.companyId!));
});

router.post("/invoices/:id/line-items", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = lineInput.safeParse(req.body);
  const existing = await loadInvoice(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!parsed.success || existing.status !== "draft") {
    res.status(400).json({ error: !parsed.success ? "Invalid line item" : "Only draft invoices can be edited" }); return;
  }
  const quantity = Math.round((parsed.data.quantity + Number.EPSILON) * 100) / 100;
  const unitPriceCents = Math.round((parsed.data.unitPrice + Number.EPSILON) * 100);
  const lineTotalCents = Math.round(quantity * unitPriceCents);
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765433, ${id})`);
    const [current] = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
      eq(invoicesTable.id, id), eq(invoicesTable.companyId, req.user!.companyId!), eq(invoicesTable.status, "draft"),
    ));
    if (!current) return false;
    const [lineCount] = await tx.select({ cnt: count() }).from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id));
    await tx.insert(invoiceLineItemsTable).values({
      invoiceId: id, lineType: parsed.data.lineType, description: parsed.data.description,
      quantity: quantity.toFixed(2), unitPrice: (unitPriceCents / 100).toFixed(2),
      lineTotal: (lineTotalCents / 100).toFixed(2), sortOrder: lineCount?.cnt ?? 0,
    });
    await recalculate(id, tx);
    return true;
  });
  if (!changed) { res.status(409).json({ error: "Invoice is no longer editable" }); return; }
  res.status(201).json(await loadInvoice(id, req.user!.companyId!));
});

router.delete("/invoices/:id/line-items/:lineId", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const existing = await loadInvoice(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (existing.status !== "draft") { res.status(400).json({ error: "Only draft invoices can be edited" }); return; }
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765433, ${id})`);
    const [current] = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
      eq(invoicesTable.id, id), eq(invoicesTable.companyId, req.user!.companyId!), eq(invoicesTable.status, "draft"),
    ));
    if (!current) return false;
    await tx.delete(invoiceLineItemsTable).where(and(
      eq(invoiceLineItemsTable.id, Number(req.params.lineId)), eq(invoiceLineItemsTable.invoiceId, id),
    ));
    await recalculate(id, tx);
    return true;
  });
  if (!changed) { res.status(409).json({ error: "Invoice is no longer editable" }); return; }
  res.json(await loadInvoice(id, req.user!.companyId!));
});

router.patch("/invoices/:id/status", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = statusInput.safeParse(req.body);
  const existing = await loadInvoice(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: "Invalid status change" }); return; }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765433, ${id})`);
    const [current] = await tx.select({
      status: invoicesTable.status, paidAt: invoicesTable.paidAt,
    }).from(invoicesTable).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, req.user!.companyId!)));
    if (!current) return "missing";
    const transitions: Partial<Record<typeof current.status, string[]>> = {
      draft: ["sent", "void"],
      sent: ["paid", "overdue", "void"],
      paid: [],
      overdue: ["paid", "void"],
      void: [],
    };
    if (!(transitions[current.status] ?? []).includes(parsed.data.status)) return "conflict";
    if (parsed.data.status === "sent") {
      const [lineCount] = await tx.select({ cnt: count() }).from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id));
      if (!lineCount?.cnt) return "empty";
    }
    await tx.update(invoicesTable).set({
      status: parsed.data.status,
      paidAt: parsed.data.status === "paid" ? new Date() : current.paidAt,
      paymentMethod: parsed.data.paymentMethod ?? null,
      updatedAt: new Date(),
    }).where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, req.user!.companyId!), eq(invoicesTable.status, current.status)));
    return "ok";
  });
  if (result !== "ok") {
    res.status(result === "missing" ? 404 : 409).json({ error: result === "empty" ? "Add at least one line item before sending" : "Invoice status changed; refresh and try again" });
    return;
  }
  res.json(await loadInvoice(id, req.user!.companyId!));
});

router.get("/invoices/:id/pdf", requireAuth, roles, async (req, res): Promise<void> => {
  const invoice = await loadInvoice(Number(req.params.id), req.user!.companyId!);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  generateInvoicePdf(invoice, res, req.user!.companyName ?? "Company Workspace");
});

export default router;
