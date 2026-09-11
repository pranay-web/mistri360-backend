import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
import { usersTable } from "./users";

export const pmcviResultEnum = pgEnum("pmcvi_result", [
  "pass",
  "fail",
  "conditional",
  "pending",
]);

// Ontario PMCVI records
export const pmcviRecordsTable = pgTable("pmcvi_records", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id),
  inspectionDate: date("inspection_date").notNull(),
  expiryDate: date("expiry_date").notNull(),
  result: pmcviResultEnum("result").notNull().default("pending"),
  inspectionStationName: text("inspection_station_name"),
  inspectorName: text("inspector_name"),
  certificateNumber: text("certificate_number"),
  // DriveON document must be uploaded before marking as officially passed
  driveOnDocumentKey: text("drive_on_document_key"),
  driveOnUploadedAt: timestamp("drive_on_uploaded_at"),
  driveOnUploadedByUserId: integer("drive_on_uploaded_by_user_id").references(
    () => usersTable.id
  ),
  isOfficiallyPassed: boolean("is_officially_passed")
    .notNull()
    .default(false),
  repairNotes: text("repair_notes"),
  reinspectionDate: date("reinspection_date"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PmcviRecord = typeof pmcviRecordsTable.$inferSelect;

// US Annual Inspection records
export const usInspectionRecordsTable = pgTable("us_inspection_records", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id),
  inspectionDate: date("inspection_date").notNull(),
  expiryDate: date("expiry_date").notNull(),
  inspectorName: text("inspector_name"),
  inspectorId: text("inspector_id"),
  brakeInspectorName: text("brake_inspector_name"),
  brakeInspectorId: text("brake_inspector_id"),
  reportFileKey: text("report_file_key"),
  result: text("result").notNull().default("pass"), // pass, fail
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UsInspectionRecord = typeof usInspectionRecordsTable.$inferSelect;

// Roadside inspection violations
export const roadsideViolationsTable = pgTable("roadside_violations", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id),
  inspectionDate: date("inspection_date").notNull(),
  inspectionLocation: text("inspection_location"),
  violationCode: text("violation_code"),
  violationDescription: text("violation_description").notNull(),
  severity: text("severity").notNull().default("minor"), // minor, major, oos
  correctiveAction: text("corrective_action"),
  repairDocumentKey: text("repair_document_key"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type RoadsideViolation = typeof roadsideViolationsTable.$inferSelect;
