import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  date,
  timestamp,
  numeric,
  pgEnum,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
import { usersTable } from "./users";
import { workOrdersTable } from "./work-orders";
import { checklistInstancesTable, checklistItemsTable } from "./checklists";

export const defectSeverityEnum = pgEnum("defect_severity", [
  "minor",
  "major",
  "out_of_service",
]);

export const defectStatusEnum = pgEnum("defect_status", [
  "open",
  "assigned",
  "repaired",
  "deferred",
  "restricted",
  "out_of_service",
]);

export const defectSourceEnum = pgEnum("defect_source", [
  "driver_report",
  "checklist",
  "mechanic_inspection",
  "roadside",
]);

export const defectsTable = pgTable("defects", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id),
  reportedByUserId: integer("reported_by_user_id")
    .notNull()
    .references(() => usersTable.id),
  source: defectSourceEnum("source").notNull().default("driver_report"),
  severity: defectSeverityEnum("severity").notNull(),
  status: defectStatusEnum("status").notNull().default("open"),
  description: text("description").notNull(),
  location: text("location"), // text location description
  odometerAtReport: integer("odometer_at_report"),
  workOrderId: integer("work_order_id").references(() => workOrdersTable.id),
  checklistInstanceId: integer("checklist_instance_id").references(
    () => checklistInstancesTable.id
  ),
  checklistItemId: integer("checklist_item_id").references(
    () => checklistItemsTable.id
  ),
  repairedByUserId: integer("repaired_by_user_id").references(
    () => usersTable.id
  ),
  repairedAt: timestamp("repaired_at"),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Defect = typeof defectsTable.$inferSelect;

export const defectPhotosTable = pgTable("defect_photos", {
  id: serial("id").primaryKey(),
  defectId: integer("defect_id")
    .notNull()
    .references(() => defectsTable.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  caption: text("caption"),
  uploadedByUserId: integer("uploaded_by_user_id").references(
    () => usersTable.id
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DefectPhoto = typeof defectPhotosTable.$inferSelect;

// Driver Vehicle Inspection Reports (DVIR) — submitted pre/post-trip
export const driverDvirReportsTable = pgTable("driver_dvir_reports", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id),
  driverId: integer("driver_id")
    .notNull()
    .references(() => usersTable.id),
  reportType: text("report_type").notNull().default("pre_trip"), // pre_trip, post_trip
  tripDate: date("trip_date").notNull(),
  odometer: integer("odometer"),
  safeToOperate: boolean("safe_to_operate").notNull().default(true),
  defectsFound: boolean("defects_found").notNull().default(false),
  driverNotes: text("driver_notes"),
  mechanicReviewedAt: timestamp("mechanic_reviewed_at"),
  mechanicId: integer("mechanic_id").references(() => usersTable.id),
  mechanicNotes: text("mechanic_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DriverDvirReport = typeof driverDvirReportsTable.$inferSelect;

// Individual defect lines on a DVIR report
export const driverDvirDefectsTable = pgTable("driver_dvir_defects", {
  id: serial("id").primaryKey(),
  dvirReportId: integer("dvir_report_id")
    .notNull()
    .references(() => driverDvirReportsTable.id, { onDelete: "cascade" }),
  defectId: integer("defect_id").references(() => defectsTable.id), // links to main defect if escalated
  systemArea: text("system_area").notNull(), // brakes, tires, lights, etc.
  description: text("description").notNull(),
  severity: defectSeverityEnum("severity").notNull().default("minor"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DriverDvirDefect = typeof driverDvirDefectsTable.$inferSelect;
