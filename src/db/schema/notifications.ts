import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// In-app notification queue per user
export const userNotificationsTable = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  notificationType: text("notification_type").notNull(), // pm_due, defect_assigned, wo_status_change, pmcvi_expiry
  title: text("title").notNull(),
  body: text("body"),
  relatedTableName: text("related_table_name"),
  relatedRecordId: integer("related_record_id"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type UserNotification = typeof userNotificationsTable.$inferSelect;

// Log of PM reminder emails/push notifications sent — prevents duplicate sends
export const notificationSentLogTable = pgTable("notification_sent_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  notificationType: text("notification_type").notNull(),
  channel: text("channel").notNull().default("in_app"), // in_app, email, push
  relatedTableName: text("related_table_name"),
  relatedRecordId: integer("related_record_id"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export type NotificationSentLog = typeof notificationSentLogTable.$inferSelect;
