import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  numeric,
  pgEnum,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
import { workOrdersTable } from "./work-orders";
import { usersTable } from "./users";

export const checklistTypeEnum = pgEnum("checklist_type", [
  "pm1",
  "pm2",
  "trailer",
  "reefer",
  "driver_dvir",
  "pmcvi_prep",
]);

export const checklistItemStatusEnum = pgEnum("checklist_item_status", [
  "pass",
  "monitor",
  "repair_required",
  "major_defect",
  "out_of_service",
  "n_a",
]);

// Master templates — seeded once, reused for every inspection
export const checklistTemplatesTable = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  checklistType: checklistTypeEnum("checklist_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ChecklistTemplate = typeof checklistTemplatesTable.$inferSelect;

// Individual items within a template
export const checklistItemsTable = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id")
    .notNull()
    .references(() => checklistTemplatesTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // e.g. "Brakes", "Tires & Wheels"
  itemDescription: text("item_description").notNull(),
  requiresMeasurement: boolean("requires_measurement").notNull().default(false),
  measurementUnit: text("measurement_unit"), // mm, psi, %
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export type ChecklistItem = typeof checklistItemsTable.$inferSelect;

// A specific checklist instance tied to a work order / vehicle
export const checklistInstancesTable = pgTable("checklist_instances", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id")
    .notNull()
    .references(() => workOrdersTable.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id),
  templateId: integer("template_id")
    .notNull()
    .references(() => checklistTemplatesTable.id),
  checklistType: checklistTypeEnum("checklist_type").notNull(),
  submittedByUserId: integer("submitted_by_user_id").references(
    () => usersTable.id
  ),
  submittedAt: timestamp("submitted_at"),
  isLocked: boolean("is_locked").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ChecklistInstance = typeof checklistInstancesTable.$inferSelect;

// One row per checklist item response
export const checklistResponsesTable = pgTable("checklist_responses", {
  id: serial("id").primaryKey(),
  instanceId: integer("instance_id")
    .notNull()
    .references(() => checklistInstancesTable.id, { onDelete: "cascade" }),
  itemId: integer("item_id")
    .notNull()
    .references(() => checklistItemsTable.id),
  status: checklistItemStatusEnum("status"),
  notes: text("notes"),
  measurement: numeric("measurement", { precision: 10, scale: 3 }),
  photoFileKey: text("photo_file_key"),
  respondedByUserId: integer("responded_by_user_id").references(
    () => usersTable.id
  ),
  respondedAt: timestamp("responded_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ChecklistResponse = typeof checklistResponsesTable.$inferSelect;
