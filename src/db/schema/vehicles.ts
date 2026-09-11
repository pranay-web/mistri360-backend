import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const vehicleTypeEnum = pgEnum("vehicle_type", ["truck", "trailer", "reefer_trailer"]);

export const vehicleStatusEnum = pgEnum("vehicle_status", [
  "available",
  "in_repair",
  "out_of_service",
  "restricted",
  "inactive",
]);

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  // Kept nullable for safe rollout; all server-created vehicles set this value.
  companyId: integer("company_id").references(() => companiesTable.id),
  unitNumber: text("unit_number").notNull().unique(),
  vehicleType: vehicleTypeEnum("vehicle_type").notNull(),
  status: vehicleStatusEnum("status").notNull().default("available"),
  vin: text("vin").notNull().unique(),
  licensePlate: text("license_plate").notNull(),
  licenseProvince: text("license_province"),
  year: integer("year").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  color: text("color"),
  // Odometer / hours
  currentOdometer: integer("current_odometer").notNull().default(0),
  engineHours: numeric("engine_hours", { precision: 10, scale: 1 }).default("0"),
  reeferHours: numeric("reefer_hours", { precision: 10, scale: 1 }).default("0"),
  // PM due dates / odometer targets
  pm1DueDate: date("pm1_due_date"),
  pm1DueOdometer: integer("pm1_due_odometer"),
  pm2DueDate: date("pm2_due_date"),
  pm2DueOdometer: integer("pm2_due_odometer"),
  greasingDueDate: date("greasing_due_date"),
  greasingDueOdometer: integer("greasing_due_odometer"),
  pmcviDueDate: date("pmcvi_due_date"),
  usAnnualDueDate: date("us_annual_due_date"),
  // Insurance / registration
  registrationExpiry: date("registration_expiry"),
  insuranceExpiry: date("insurance_expiry"),
  // Notes
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;

// PM interval configuration per vehicle
export const pmSchedulesTable = pgTable(
  "pm_schedules",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "cascade" }),
    pmType: text("pm_type").notNull(), // pm1, pm2, greasing, pmcvi, us_annual
    intervalKm: integer("interval_km"),
    intervalEngineHours: integer("interval_engine_hours"),
    intervalReeferHours: integer("interval_reefer_hours"),
    intervalDays: integer("interval_days"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pm_schedules_vehicle_pm_uniq").on(t.vehicleId, t.pmType)]
);

export type PmSchedule = typeof pmSchedulesTable.$inferSelect;

// Reminders created when a threshold is crossed
export const pmRemindersTable = pgTable("pm_reminders", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  pmType: text("pm_type").notNull(),
  triggerType: text("trigger_type").notNull(), // km, engine_hours, reefer_hours, date
  dueDate: date("due_date"),
  dueOdometer: integer("due_odometer"),
  dismissed: boolean("dismissed").notNull().default(false),
  workOrderId: integer("work_order_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PmReminder = typeof pmRemindersTable.$inferSelect;

// Every vehicle status change is recorded here for audit / history
export const vehicleStatusHistoryTable = pgTable("vehicle_status_history", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  fromStatus: vehicleStatusEnum("from_status"),
  toStatus: vehicleStatusEnum("to_status").notNull(),
  reason: text("reason"),
  workOrderId: integer("work_order_id"),
  changedByUserId: integer("changed_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type VehicleStatusHistory = typeof vehicleStatusHistoryTable.$inferSelect;

// Odometer / engine-hours readings logged at each service or check-in
export const vehicleOdometerEntriesTable = pgTable("vehicle_odometer_entries", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  odometer: integer("odometer"),
  engineHours: numeric("engine_hours", { precision: 10, scale: 1 }),
  reeferHours: numeric("reefer_hours", { precision: 10, scale: 1 }),
  source: text("source").notNull().default("work_order"), // work_order, manual, driver
  workOrderId: integer("work_order_id"),
  recordedByUserId: integer("recorded_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type VehicleOdometerEntry = typeof vehicleOdometerEntriesTable.$inferSelect;

// Documents attached to a vehicle (registration, insurance, previous inspection reports)
export const vehicleAttachmentsTable = pgTable("vehicle_attachments", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  attachmentType: text("attachment_type").notNull(), // registration, insurance, inspection, other
  fileName: text("file_name").notNull(),
  fileKey: text("file_key").notNull(),
  expiryDate: date("expiry_date"),
  uploadedByUserId: integer("uploaded_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type VehicleAttachment = typeof vehicleAttachmentsTable.$inferSelect;
