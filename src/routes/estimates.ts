import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  customersTable, estimatesTable, estimateLineItemsTable, vehiclesTable, workOrdersTable, estimateEmailsTable, usersTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { generateEstimatePdf, generateEstimatePdfAsBuffer } from "../lib/pdf-generator.js";
import { sendEmail } from "../lib/emailService.js";

const router: IRouter = Router();
const roles = requireRole("admin", "manager");

const estimateInput = z.object({
  customerId: z.number().int().positive(),
  vehicleId: z.number().int().positive().nullable().optional(),
  vehicleDescription: z.string().trim().max(240).nullable().optional(),
  title: z.string().trim().min(1).max(180),
  validUntil: z.string().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  terms: z.string().trim().max(4000).nullable().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
});
const lineInput = z.object({
  lineType: z.enum(["service", "labour", "part", "fee"]).default("service"),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(100000),
  unitPrice: z.coerce.number().min(0).max(10000000),
});

async function loadEstimate(id: number, companyId: number) {
  const [estimate] = await db.select({
    id: estimatesTable.id, estimateNumber: estimatesTable.estimateNumber,
    customerId: estimatesTable.customerId, customerName: customersTable.name,
    customerCode: customersTable.customerCode, contactName: customersTable.contactName,
    customerEmail: customersTable.email, customerPhone: customersTable.phone,
    customerAddress: customersTable.addressLine1, customerCity: customersTable.city,
    customerProvince: customersTable.province, customerPostalCode: customersTable.postalCode,
    vehicleId: estimatesTable.vehicleId, vehicleUnitNumber: vehiclesTable.unitNumber,
    vehicleDescription: estimatesTable.vehicleDescription, title: estimatesTable.title,
    status: estimatesTable.status, validUntil: estimatesTable.validUntil,
    notes: estimatesTable.notes, terms: estimatesTable.terms, taxRate: estimatesTable.taxRate,
    subtotal: estimatesTable.subtotal, taxAmount: estimatesTable.taxAmount, total: estimatesTable.total,
    convertedWorkOrderId: estimatesTable.convertedWorkOrderId,
    sentAt: estimatesTable.sentAt, approvedAt: estimatesTable.approvedAt,
    createdAt: estimatesTable.createdAt, updatedAt: estimatesTable.updatedAt,
  }).from(estimatesTable)
    .innerJoin(customersTable, and(
      eq(estimatesTable.customerId, customersTable.id),
      eq(customersTable.companyId, companyId),
    ))
    .leftJoin(vehiclesTable, and(
      eq(estimatesTable.vehicleId, vehiclesTable.id),
      eq(vehiclesTable.companyId, companyId),
    ))
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)));
  if (!estimate) return null;
  const lineItems = await db.select().from(estimateLineItemsTable)
    .where(eq(estimateLineItemsTable.estimateId, id))
    .orderBy(asc(estimateLineItemsTable.sortOrder), asc(estimateLineItemsTable.id));
  return { ...estimate, lineItems };
}

async function recalculate(id: number, executor: any = db) {
  const lines = await executor.select({ total: estimateLineItemsTable.lineTotal })
    .from(estimateLineItemsTable).where(eq(estimateLineItemsTable.estimateId, id));
  const [estimate] = await executor.select({ taxRate: estimatesTable.taxRate })
    .from(estimatesTable).where(eq(estimatesTable.id, id));
  const subtotalCents = lines.reduce(
    (sum: number, line: { total: string }) => sum + Math.round(Number(line.total) * 100),
    0,
  );
  const taxRateMilliPercent = Math.round(Number(estimate?.taxRate ?? 0) * 1000);
  const taxCents = Math.round(subtotalCents * taxRateMilliPercent / 100000);
  await executor.update(estimatesTable).set({
    subtotal: (subtotalCents / 100).toFixed(2), taxAmount: (taxCents / 100).toFixed(2),
    total: ((subtotalCents + taxCents) / 100).toFixed(2), updatedAt: new Date(),
  }).where(eq(estimatesTable.id, id));
}

router.get("/estimates", requireAuth, roles, async (req, res): Promise<void> => {
  const emailSubquery = db.select({
    estimateId: estimateEmailsTable.estimateId,
    emailCount: sql<number>`count(*)::int`.as("email_count"),
    lastEmailSentAt: sql<string>`max(${estimateEmailsTable.createdAt})`.as("last_email_sent_at"),
  }).from(estimateEmailsTable)
    .groupBy(estimateEmailsTable.estimateId)
    .as("email_stats");

  const rows = await db.select({
    id: estimatesTable.id, estimateNumber: estimatesTable.estimateNumber,
    title: estimatesTable.title, status: estimatesTable.status,
    customerId: estimatesTable.customerId, customerName: customersTable.name,
    vehicleId: estimatesTable.vehicleId, vehicleUnitNumber: vehiclesTable.unitNumber,
    vehicleDescription: estimatesTable.vehicleDescription, validUntil: estimatesTable.validUntil,
    subtotal: estimatesTable.subtotal, taxAmount: estimatesTable.taxAmount, total: estimatesTable.total,
    convertedWorkOrderId: estimatesTable.convertedWorkOrderId, createdAt: estimatesTable.createdAt,
    emailCount: sql<number>`COALESCE(${emailSubquery.emailCount}, 0)`,
    lastEmailSentAt: emailSubquery.lastEmailSentAt,
  }).from(estimatesTable)
    .innerJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(vehiclesTable, eq(estimatesTable.vehicleId, vehiclesTable.id))
    .leftJoin(emailSubquery, eq(estimatesTable.id, emailSubquery.estimateId))
    .where(eq(estimatesTable.companyId, req.user!.companyId!))
    .orderBy(desc(estimatesTable.createdAt));
  res.json(rows);
});

router.post("/estimates", requireAuth, roles, async (req, res): Promise<void> => {
  const parsed = estimateInput.safeParse(req.body);
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
  const year = new Date().getFullYear();
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${companyId}, ${year})`);
    const [row] = await tx.select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(${estimatesTable.estimateNumber}, '-', 3) AS INTEGER)), 0)`,
    }).from(estimatesTable)
      .where(and(eq(estimatesTable.companyId, companyId), sql`EXTRACT(YEAR FROM ${estimatesTable.createdAt}) = ${year}`));
    const estimateNumber = `EST-${year}-${String(Number(row?.maxSeq ?? 0) + 1).padStart(4, "0")}`;
    const [record] = await tx.insert(estimatesTable).values({
      companyId, customerId: parsed.data.customerId, vehicleId: parsed.data.vehicleId ?? null,
      vehicleDescription: parsed.data.vehicleDescription ?? null, estimateNumber,
      title: parsed.data.title, status: "draft", validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      notes: parsed.data.notes ?? null, terms: parsed.data.terms ?? null, taxRate: String(parsed.data.taxRate ?? 13),
      createdByUserId: req.user!.id,
    }).returning({ id: estimatesTable.id });
    return record;
  });
  res.status(201).json(await loadEstimate(created.id, companyId));
});

router.get("/estimates/:id", requireAuth, roles, async (req, res): Promise<void> => {
  const detail = await loadEstimate(Number(req.params.id), req.user!.companyId!);
  if (!detail) { res.status(404).json({ error: "Estimate not found" }); return; }
  res.json(detail);
});

router.put("/estimates/:id", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = estimateInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const existing = await loadEstimate(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (existing.status !== "draft") { res.status(400).json({ error: "Only draft estimates can be edited" }); return; }
  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765432, ${id})`);
    const [current] = await tx.select({ id: estimatesTable.id }).from(estimatesTable).where(and(
      eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!), eq(estimatesTable.status, "draft"),
    ));
    if (!current) return null;
    await tx.update(estimatesTable).set({
      title: parsed.data.title, customerId: parsed.data.customerId, vehicleId: parsed.data.vehicleId ?? null,
      vehicleDescription: parsed.data.vehicleDescription ?? null, validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      notes: parsed.data.notes ?? null, terms: parsed.data.terms ?? null, taxRate: String(parsed.data.taxRate ?? 13),
      updatedAt: new Date(),
    } as any).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!), eq(estimatesTable.status, "draft")));
    await recalculate(id, tx);
    return true;
  });
  if (!updated) { res.status(409).json({ error: "Estimate is no longer editable" }); return; }
  res.json(await loadEstimate(id, req.user!.companyId!));
});

router.delete("/estimates/:id", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const existing = await loadEstimate(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (existing.status !== "draft") { res.status(400).json({ error: "Only draft estimates can be deleted" }); return; }
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765432, ${id})`);
    const [current] = await tx.select({ id: estimatesTable.id }).from(estimatesTable).where(and(
      eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!), eq(estimatesTable.status, "draft"),
    ));
    if (!current) return false;
    await tx.delete(estimatesTable).where(and(
      eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!), eq(estimatesTable.status, "draft"),
    ));
    return true;
  });
  if (!deleted) { res.status(409).json({ error: "Estimate cannot be deleted" }); return; }
  res.status(204).end();
});

router.post("/estimates/:id/line-items", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = lineInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const existing = await loadEstimate(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (existing.status !== "draft") { res.status(400).json({ error: "Only draft estimates can be edited" }); return; }
  const quantityCents = Math.round(parsed.data.quantity * 100);
  const unitPriceCents = Math.round(parsed.data.unitPrice * 100);
  const lineTotalCents = Math.round((quantityCents * unitPriceCents) / 100);
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765432, ${id})`);
    const [current] = await tx.select({ id: estimatesTable.id }).from(estimatesTable).where(and(
      eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!), eq(estimatesTable.status, "draft"),
    ));
    if (!current) return false;
    const [lineCount] = await tx.select({ cnt: count() }).from(estimateLineItemsTable).where(eq(estimateLineItemsTable.estimateId, id));
    await tx.insert(estimateLineItemsTable).values({
      estimateId: id, lineType: parsed.data.lineType, description: parsed.data.description,
      quantity: (quantityCents / 100).toFixed(2), unitPrice: (unitPriceCents / 100).toFixed(2),
      lineTotal: (lineTotalCents / 100).toFixed(2), sortOrder: lineCount?.cnt ?? 0,
    });
    await recalculate(id, tx);
    return true;
  });
  if (!changed) { res.status(409).json({ error: "Estimate is no longer editable" }); return; }
  res.status(201).json(await loadEstimate(id, req.user!.companyId!));
});

router.delete("/estimates/:id/line-items/:lineId", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const existing = await loadEstimate(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (existing.status !== "draft") { res.status(400).json({ error: "Only draft estimates can be edited" }); return; }
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765432, ${id})`);
    const [current] = await tx.select({ id: estimatesTable.id }).from(estimatesTable).where(and(
      eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!), eq(estimatesTable.status, "draft"),
    ));
    if (!current) return false;
    await tx.delete(estimateLineItemsTable).where(and(
      eq(estimateLineItemsTable.id, Number(req.params.lineId)), eq(estimateLineItemsTable.estimateId, id),
    ));
    await recalculate(id, tx);
    return true;
  });
  if (!changed) { res.status(409).json({ error: "Estimate is no longer editable" }); return; }
  res.json(await loadEstimate(id, req.user!.companyId!));
});

router.patch("/estimates/:id/status", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const status = z.enum(["draft", "sent", "approved", "declined", "expired"]).safeParse(req.body.status);
  const existing = await loadEstimate(id, req.user!.companyId!);
  if (!existing) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (!status.success) { res.status(400).json({ error: "Invalid status change" }); return; }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765432, ${id})`);
    const [current] = await tx.select({
      status: estimatesTable.status, sentAt: estimatesTable.sentAt, approvedAt: estimatesTable.approvedAt,
    }).from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!)));
    if (!current) return "missing";
    const transitions: Partial<Record<typeof current.status, string[]>> = { draft: ["sent"], sent: ["approved", "declined"] };
    if (!(transitions[current.status] ?? []).includes(status.data)) return "conflict";
    if (status.data === "sent") {
      const [lineCount] = await tx.select({ cnt: count() }).from(estimateLineItemsTable).where(eq(estimateLineItemsTable.estimateId, id));
      if (!lineCount?.cnt) return "empty";
    }
    await tx.update(estimatesTable).set({
      status: status.data, sentAt: status.data === "sent" ? new Date() : current.sentAt,
      approvedAt: status.data === "approved" ? new Date() : current.approvedAt, updatedAt: new Date(),
    }).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, req.user!.companyId!), eq(estimatesTable.status, current.status)));
    return "ok";
  });
  if (result !== "ok") {
    res.status(result === "missing" ? 404 : 409).json({ error: result === "empty" ? "Add at least one line item before sending" : "Estimate status changed; refresh and try again" });
    return;
  }
  res.json(await loadEstimate(id, req.user!.companyId!));
});

router.post("/estimates/:id/convert", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const companyId = req.user!.companyId!;
  const estimate = await loadEstimate(id, companyId);
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (estimate.status !== "approved") { res.status(400).json({ error: "Only approved estimates can be converted to work orders" }); return; }
  if (estimate.convertedWorkOrderId) { res.status(409).json({ error: "Estimate has already been converted" }); return; }
  if (!estimate.vehicleId) { res.status(400).json({ error: "A fleet vehicle must be linked before converting to a work order" }); return; }

  let workOrder: { id: number; woNumber: string };
  try {
    workOrder = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(765432, ${id})`);
      const [current] = await tx.select({
        status: estimatesTable.status, convertedWorkOrderId: estimatesTable.convertedWorkOrderId,
      }).from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)));
      if (!current || current.status !== "approved" || current.convertedWorkOrderId) {
        throw new Error("ESTIMATE_CONVERSION_CONFLICT");
      }
      const year = new Date().getFullYear();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${year}, 987654)`);
      const [row] = await tx.select({
        maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(${workOrdersTable.woNumber}, '-', 3) AS INTEGER)), 0)`,
      }).from(workOrdersTable).where(sql`EXTRACT(YEAR FROM created_at) = ${year}`);
      const woNumber = `WO-${year}-${String(Number(row?.maxSeq ?? 0) + 1).padStart(4, "0")}`;
      const description = [estimate.title, ...estimate.lineItems.map((line) => `${line.description} (${line.quantity} × $${line.unitPrice})`)].join("\n");
      const [created] = await tx.insert(workOrdersTable).values({
        companyId, woNumber, vehicleId: estimate.vehicleId!, customerId: estimate.customerId,
        workOrderType: "general_repair", priority: "normal", status: "draft",
        description, internalNotes: `Converted from estimate ${estimate.estimateNumber}`,
        createdByUserId: req.user!.id,
      }).returning({ id: workOrdersTable.id, woNumber: workOrdersTable.woNumber });
      await tx.update(estimatesTable).set({ convertedWorkOrderId: created.id, status: "converted", updatedAt: new Date() })
        .where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)));
      return created;
    });
  } catch (error: any) {
    if (error?.message === "ESTIMATE_CONVERSION_CONFLICT") {
      res.status(409).json({ error: "Estimate has already been converted or is no longer approved" });
      return;
    }
    throw error;
  }
  res.status(201).json(workOrder);
});

router.get("/estimates/:id/pdf", requireAuth, roles, async (req, res): Promise<void> => {
  const estimate = await loadEstimate(Number(req.params.id), req.user!.companyId!);
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }
  generateEstimatePdf(estimate, res, req.user!.companyName ?? "Company Workspace");
});

router.post("/estimates/:id/send-email", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { to, cc, message } = req.body ?? {};
  const companyId = req.user!.companyId!;
  const estimate = await loadEstimate(id, companyId);
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }

  const recipientEmail = (to || estimate.customerEmail || "").trim();
  if (!recipientEmail) {
    res.status(400).json({ error: "No email address found. Add customer email or specify recipient." });
    return;
  }

  // Generate the PDF buffer
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateEstimatePdfAsBuffer(estimate, req.user!.companyName ?? "Company Workspace");
  } catch (err: any) {
    res.status(500).json({ error: `Failed to generate PDF: ${err.message}` });
    return;
  }

  const htmlBody = buildEstimateEmailHtml(estimate, message);
  const emailResult = await sendEmail({
    to: recipientEmail,
    cc: cc ? cc.split(",").map((e: string) => e.trim()).filter(Boolean) : [],
    subject: `Estimate ${estimate.estimateNumber}: ${estimate.title}`,
    htmlBody,
    attachment: {
      filename: `${estimate.estimateNumber}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    },
  });

  // Execute in transaction with advisory lock and tenancy scoping
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(765432, ${id})`);

    const [current] = await tx.select({
      id: estimatesTable.id,
      status: estimatesTable.status,
    }).from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)));

    if (!current) throw new Error("ESTIMATE_NOT_FOUND");

    // Insert audit record of email send attempt
    await tx.insert(estimateEmailsTable).values({
      estimateId: id,
      sentToEmail: recipientEmail,
      ccEmails: cc ? cc.trim() : null,
      subject: `Estimate ${estimate.estimateNumber}: ${estimate.title}`,
      message: message ? message.trim() : null,
      sentByUserId: req.user!.id,
      status: emailResult.success ? "sent" : "failed",
      errorMessage: emailResult.error ?? null,
      providerMessageId: emailResult.messageId ?? null,
    });

    // If estimate is in draft, check line items and transition to sent
    if (current.status === "draft") {
      const [lineCount] = await tx.select({ cnt: count() }).from(estimateLineItemsTable).where(eq(estimateLineItemsTable.estimateId, id));
      if (!lineCount?.cnt) {
        throw new Error("EMPTY_ESTIMATE_CANNOT_SEND");
      }
      await tx.update(estimatesTable).set({
        status: "sent",
        sentAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(estimatesTable.id, id), eq(estimatesTable.companyId, companyId)));
    }
  }).catch((err) => {
    if (err.message === "EMPTY_ESTIMATE_CANNOT_SEND") {
      res.status(400).json({ error: "Cannot send estimate with no line items" });
      return "HANDLED";
    }
    throw err;
  });

  if (res.headersSent) return;

  res.json({
    success: emailResult.success,
    messageId: emailResult.messageId,
    error: emailResult.error,
  });
});

router.get("/estimates/:id/emails", requireAuth, roles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const companyId = req.user!.companyId!;

  // Scoped through parent estimate companyId
  const estimate = await loadEstimate(id, companyId);
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }

  const rows = await db.select({
    id: estimateEmailsTable.id,
    estimateId: estimateEmailsTable.estimateId,
    sentToEmail: estimateEmailsTable.sentToEmail,
    ccEmails: estimateEmailsTable.ccEmails,
    subject: estimateEmailsTable.subject,
    message: estimateEmailsTable.message,
    sentByUserId: estimateEmailsTable.sentByUserId,
    sentByName: usersTable.name,
    status: estimateEmailsTable.status,
    errorMessage: estimateEmailsTable.errorMessage,
    providerMessageId: estimateEmailsTable.providerMessageId,
    createdAt: estimateEmailsTable.createdAt,
  }).from(estimateEmailsTable)
    .innerJoin(estimatesTable, and(eq(estimateEmailsTable.estimateId, estimatesTable.id), eq(estimatesTable.companyId, companyId)))
    .innerJoin(usersTable, eq(estimateEmailsTable.sentByUserId, usersTable.id))
    .where(eq(estimateEmailsTable.estimateId, id))
    .orderBy(desc(estimateEmailsTable.createdAt));

  res.json(rows);
});

function buildEstimateEmailHtml(estimate: any, customMessage?: string): string {
  return `
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #334155;">
        <table width="100%" style="max-width: 600px; margin: 0 auto;">
          <tr><td style="padding: 20px; background: #0A1628; color: white; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">Estimate ${estimate.estimateNumber}</h1>
          </td></tr>
          <tr><td style="padding: 20px; border: 1px solid #DCE3EA;">
            <p>Hello ${estimate.contactName || "there"},</p>
            <p>We've prepared an estimate for your fleet maintenance service.</p>
            <table width="100%" style="margin: 20px 0; border-collapse: collapse;">
              <tr><td style="padding: 10px 0; border-bottom: 1px solid #DCE3EA;"><strong>Description:</strong></td><td style="padding: 10px 20px; text-align: right;">${estimate.title}</td></tr>
              <tr><td style="padding: 10px 0;"><strong>Total Amount:</strong></td><td style="padding: 10px 20px; text-align: right; font-weight: bold; font-size: 18px;">$${Number(estimate.total).toLocaleString("en-CA", { minimumFractionDigits: 2 })}</td></tr>
            </table>
            ${customMessage ? `<p><em>${customMessage}</em></p>` : ""}
            <p>Please see the attached PDF for full details.</p>
            <p>Thank you for your business!</p>
          </td></tr>
          <tr><td style="padding: 20px; background: #F3F4F6; text-align: center; font-size: 12px; color: #6B7280;">
            mistri360 Fleet Maintenance
          </td></tr>
        </table>
      </body>
    </html>
  `;
}

export default router;