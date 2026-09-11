import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  timestamp,
  date,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";
import { usersTable } from "./users";
import { companiesTable } from "./companies";
import { customersTable } from "./customers";

export const workOrderTypeEnum = pgEnum("work_order_type", [
  "pm1",
  "pm2",
  "greasing",
  "trailer_maintenance",
  "reefer_maintenance",
  "driver_defect",
  "breakdown",
  "roadside_repair",
  "pmcvi_prep",
  "general_repair",
]);

export const workOrderStatusEnum = pgEnum("work_order_status", [
  "draft",
  "assigned",
  "checked_in",
  "inspection_in_progress",
  "approval_required",
  "repair_in_progress",
  "waiting_for_part",
  "qc_review",
  "completed",
  "released",
  "restricted",
  "out_of_service",
]);

export const workOrderPriorityEnum = pgEnum("work_order_priority", [
  "low",
  "normal",
  "high",
  "critical",
]);

export const workOrdersTable = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  // Kept nullable for safe rollout; all server-created work orders set this value.
  companyId: integer("company_id").references(() => companiesTable.id),
  woNumber: text("wo_number").notNull().unique(), // WO-2024-0001
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id),
  customerId: integer("customer_id").references(() => customersTable.id),
  workOrderType: workOrderTypeEnum("work_order_type").notNull(),
  status: workOrderStatusEnum("status").notNull().default("draft"),
  priority: workOrderPriorityEnum("priority").notNull().default("normal"),
  assignedMechanicId: integer("assigned_mechanic_id").references(
    () => usersTable.id
  ),
  createdByUserId: integer("created_by_user_id")
    .notNull()
    .references(() => usersTable.id),
  description: text("description"),
  internalNotes: text("internal_notes"),
  odometerAtService: integer("odometer_at_service"),
  engineHoursAtService: numeric("engine_hours_at_service", {
    precision: 10,
    scale: 1,
  }),
  scheduledDate: date("scheduled_date"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  releasedAt: timestamp("released_at"),
  totalLabourHours: numeric("total_labour_hours", { precision: 8, scale: 2 }),
  totalPartsCost: numeric("total_parts_cost", { precision: 10, scale: 2 }),
  mechanicSignatureId: integer("mechanic_signature_id"),
  supervisorSignatureId: integer("supervisor_signature_id"),
  // Lock: completed WOs cannot be deleted
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWorkOrderSchema = createInsertSchema(workOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type WorkOrder = typeof workOrdersTable.$inferSelect;

// Every status transition is recorded here
export const workOrderStatusHistoryTable = pgTable("work_order_status_history", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  fromStatus: workOrderStatusEnum("from_status"),
  toStatus: workOrderStatusEnum("to_status").notNull(),
  changedByUserId: integer("changed_by_user_id")
    .notNull()
    .references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WorkOrderStatusHistory = typeof workOrderStatusHistoryTable.$inferSelect;

// Parts used on a work order
export const partsUsedTable = pgTable("parts_used", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  vendorName: text("vendor_name").notNull(),
  partDescription: text("part_description").notNull(),
  partNumber: text("part_number"),
  invoiceNumber: text("invoice_number"),
  quantity: numeric("quantity", { precision: 8, scale: 2 }).notNull().default("1"),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 10, scale: 2 }).notNull(),
  invoiceFileKey: text("invoice_file_key"), // storage key for uploaded invoice
  addedByUserId: integer("added_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PartUsed = typeof partsUsedTable.$inferSelect;

// Before/after photos per work order
export const workOrderPhotosTable = pgTable("work_order_photos", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  photoType: text("photo_type").notNull().default("general"), // before, after, general
  fileKey: text("file_key").notNull(),
  caption: text("caption"),
  uploadedByUserId: integer("uploaded_by_user_id").references(
    () => usersTable.id
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WorkOrderPhoto = typeof workOrderPhotosTable.$inferSelect;

// Digital signatures
export const digitalSignaturesTable = pgTable("digital_signatures", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").references(() => workOrdersTable.id),
  signatureType: text("signature_type").notNull(), // mechanic, supervisor, driver
  signedByUserId: integer("signed_by_user_id")
    .notNull()
    .references(() => usersTable.id),
  signatureImageKey: text("signature_image_key").notNull(),
  signedAt: timestamp("signed_at").notNull().defaultNow(),
});

export type DigitalSignature = typeof digitalSignaturesTable.$inferSelect;

// Standalone vendor invoices (not tied to a single part entry)
export const vendorInvoicesTable = pgTable("vendor_invoices", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").references(() => workOrdersTable.id, {
    onDelete: "cascade",
  }),
  vendorName: text("vendor_name").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  fileKey: text("file_key"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  addedByUserId: integer("added_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type VendorInvoice = typeof vendorInvoicesTable.$inferSelect;

// Per-mechanic labour time entries on a work order
export const workOrderLabourTable = pgTable("work_order_labour", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  mechanicId: integer("mechanic_id")
    .notNull()
    .references(() => usersTable.id),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  hoursWorked: numeric("hours_worked", { precision: 6, scale: 2 }),
  labourType: text("labour_type").notNull().default("regular"), // regular, overtime
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WorkOrderLabour = typeof workOrderLabourTable.$inferSelect;

// Internal comment thread on a work order
export const workOrderCommentsTable = pgTable("work_order_comments", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id")
    .notNull()
    .references(() => usersTable.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorkOrderComment = typeof workOrderCommentsTable.$inferSelect;
