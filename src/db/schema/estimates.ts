import { pgEnum, pgTable, serial, integer, text, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { customersTable } from "./customers";
import { vehiclesTable } from "./vehicles";
import { workOrdersTable } from "./work-orders";

export const estimateStatusEnum = pgEnum("estimate_status", [
  "draft", "sent", "approved", "declined", "expired", "converted",
]);
export const estimateLineTypeEnum = pgEnum("estimate_line_type", ["service", "labour", "part", "fee"]);

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  estimateNumber: text("estimate_number").notNull(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  vehicleDescription: text("vehicle_description"),
  title: text("title").notNull(),
  status: estimateStatusEnum("status").notNull().default("draft"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  notes: text("notes"),
  terms: text("terms"),
  taxRate: numeric("tax_rate", { precision: 6, scale: 3 }).notNull().default("13"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  convertedWorkOrderId: integer("converted_work_order_id").references(() => workOrdersTable.id),
  createdByUserId: integer("created_by_user_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("estimates_company_number_uniq").on(t.companyId, t.estimateNumber)]);

export const estimateLineItemsTable = pgTable("estimate_line_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull().references(() => estimatesTable.id, { onDelete: "cascade" }),
  lineType: estimateLineTypeEnum("line_type").notNull().default("service"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Estimate = typeof estimatesTable.$inferSelect;
export type EstimateLineItem = typeof estimateLineItemsTable.$inferSelect;