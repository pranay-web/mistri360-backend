import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Immutable audit trail — every edit, status change, and access is logged
export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  tableName: text("table_name").notNull(),
  recordId: integer("record_id"),
  action: text("action").notNull(), // create, update, delete, status_change, sign
  changedByUserId: integer("changed_by_user_id").references(() => usersTable.id),
  changedByName: text("changed_by_name"),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  metadata: jsonb("metadata"), // extra context (ip, user agent, etc.)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
