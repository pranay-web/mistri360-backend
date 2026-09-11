CREATE TYPE "public"."estimate_line_type" AS ENUM('service', 'labour', 'part', 'fee');--> statement-breakpoint
CREATE TYPE "public"."estimate_status" AS ENUM('draft', 'sent', 'approved', 'declined', 'expired', 'converted');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('platform_admin', 'admin', 'manager', 'mechanic', 'driver');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('available', 'in_repair', 'out_of_service', 'restricted', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('truck', 'trailer', 'reefer_trailer');--> statement-breakpoint
CREATE TYPE "public"."work_order_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('draft', 'assigned', 'checked_in', 'inspection_in_progress', 'approval_required', 'repair_in_progress', 'waiting_for_part', 'qc_review', 'completed', 'released', 'restricted', 'out_of_service');--> statement-breakpoint
CREATE TYPE "public"."work_order_type" AS ENUM('pm1', 'pm2', 'greasing', 'trailer_maintenance', 'reefer_maintenance', 'driver_defect', 'breakdown', 'roadside_repair', 'pmcvi_prep', 'general_repair');--> statement-breakpoint
CREATE TYPE "public"."checklist_item_status" AS ENUM('pass', 'monitor', 'repair_required', 'major_defect', 'out_of_service', 'n_a');--> statement-breakpoint
CREATE TYPE "public"."checklist_type" AS ENUM('pm1', 'pm2', 'trailer', 'reefer', 'driver_dvir', 'pmcvi_prep');--> statement-breakpoint
CREATE TYPE "public"."defect_severity" AS ENUM('minor', 'major', 'out_of_service');--> statement-breakpoint
CREATE TYPE "public"."defect_source" AS ENUM('driver_report', 'checklist', 'mechanic_inspection', 'roadside');--> statement-breakpoint
CREATE TYPE "public"."defect_status" AS ENUM('open', 'assigned', 'repaired', 'deferred', 'restricted', 'out_of_service');--> statement-breakpoint
CREATE TYPE "public"."pmcvi_result" AS ENUM('pass', 'fail', 'conditional', 'pending');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"customer_code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address_line_1" text,
	"city" text,
	"province" text,
	"postal_code" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"estimate_id" integer NOT NULL,
	"line_type" "estimate_line_type" DEFAULT 'service' NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"estimate_number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"vehicle_id" integer,
	"vehicle_description" text,
	"title" text NOT NULL,
	"status" "estimate_status" DEFAULT 'draft' NOT NULL,
	"valid_until" timestamp with time zone,
	"notes" text,
	"terms" text,
	"tax_rate" numeric(6, 3) DEFAULT '13' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"converted_work_order_id" integer,
	"created_by_user_id" integer NOT NULL,
	"sent_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'driver' NOT NULL,
	"company_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"license_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "pm_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"pm_type" text NOT NULL,
	"trigger_type" text NOT NULL,
	"due_date" date,
	"due_odometer" integer,
	"dismissed" boolean DEFAULT false NOT NULL,
	"work_order_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"pm_type" text NOT NULL,
	"interval_km" integer,
	"interval_engine_hours" integer,
	"interval_reefer_hours" integer,
	"interval_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"attachment_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"expiry_date" date,
	"uploaded_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_odometer_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"odometer" integer,
	"engine_hours" numeric(10, 1),
	"reefer_hours" numeric(10, 1),
	"source" text DEFAULT 'work_order' NOT NULL,
	"work_order_id" integer,
	"recorded_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"from_status" "vehicle_status",
	"to_status" "vehicle_status" NOT NULL,
	"reason" text,
	"work_order_id" integer,
	"changed_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"unit_number" text NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"status" "vehicle_status" DEFAULT 'available' NOT NULL,
	"vin" text NOT NULL,
	"license_plate" text NOT NULL,
	"license_province" text,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"color" text,
	"current_odometer" integer DEFAULT 0 NOT NULL,
	"engine_hours" numeric(10, 1) DEFAULT '0',
	"reefer_hours" numeric(10, 1) DEFAULT '0',
	"pm1_due_date" date,
	"pm1_due_odometer" integer,
	"pm2_due_date" date,
	"pm2_due_odometer" integer,
	"greasing_due_date" date,
	"greasing_due_odometer" integer,
	"pmcvi_due_date" date,
	"us_annual_due_date" date,
	"registration_expiry" date,
	"insurance_expiry" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_unit_number_unique" UNIQUE("unit_number"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "digital_signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer,
	"signature_type" text NOT NULL,
	"signed_by_user_id" integer NOT NULL,
	"signature_image_key" text NOT NULL,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts_used" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"vendor_name" text NOT NULL,
	"part_description" text NOT NULL,
	"part_number" text,
	"invoice_number" text,
	"quantity" numeric(8, 2) DEFAULT '1' NOT NULL,
	"unit_cost" numeric(10, 2) NOT NULL,
	"total_cost" numeric(10, 2) NOT NULL,
	"invoice_file_key" text,
	"added_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer,
	"vendor_name" text NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date,
	"total_amount" numeric(10, 2) NOT NULL,
	"file_key" text,
	"paid_at" timestamp,
	"notes" text,
	"added_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_labour" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"mechanic_id" integer NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"hours_worked" numeric(6, 2),
	"labour_type" text DEFAULT 'regular' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"photo_type" text DEFAULT 'general' NOT NULL,
	"file_key" text NOT NULL,
	"caption" text,
	"uploaded_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"from_status" "work_order_status",
	"to_status" "work_order_status" NOT NULL,
	"changed_by_user_id" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"wo_number" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"customer_id" integer,
	"work_order_type" "work_order_type" NOT NULL,
	"status" "work_order_status" DEFAULT 'draft' NOT NULL,
	"priority" "work_order_priority" DEFAULT 'normal' NOT NULL,
	"assigned_mechanic_id" integer,
	"created_by_user_id" integer NOT NULL,
	"description" text,
	"internal_notes" text,
	"odometer_at_service" integer,
	"engine_hours_at_service" numeric(10, 1),
	"scheduled_date" date,
	"started_at" timestamp,
	"completed_at" timestamp,
	"released_at" timestamp,
	"total_labour_hours" numeric(8, 2),
	"total_parts_cost" numeric(10, 2),
	"mechanic_signature_id" integer,
	"supervisor_signature_id" integer,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_wo_number_unique" UNIQUE("wo_number")
);
--> statement-breakpoint
CREATE TABLE "checklist_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"checklist_type" "checklist_type" NOT NULL,
	"submitted_by_user_id" integer,
	"submitted_at" timestamp,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"category" text NOT NULL,
	"item_description" text NOT NULL,
	"requires_measurement" boolean DEFAULT false NOT NULL,
	"measurement_unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"status" "checklist_item_status",
	"notes" text,
	"measurement" numeric(10, 3),
	"photo_file_key" text,
	"responded_by_user_id" integer,
	"responded_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"checklist_type" "checklist_type" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defect_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"defect_id" integer NOT NULL,
	"file_key" text NOT NULL,
	"caption" text,
	"uploaded_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defects" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"reported_by_user_id" integer NOT NULL,
	"source" "defect_source" DEFAULT 'driver_report' NOT NULL,
	"severity" "defect_severity" NOT NULL,
	"status" "defect_status" DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"odometer_at_report" integer,
	"work_order_id" integer,
	"checklist_instance_id" integer,
	"checklist_item_id" integer,
	"repaired_by_user_id" integer,
	"repaired_at" timestamp,
	"resolution_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_dvir_defects" (
	"id" serial PRIMARY KEY NOT NULL,
	"dvir_report_id" integer NOT NULL,
	"defect_id" integer,
	"system_area" text NOT NULL,
	"description" text NOT NULL,
	"severity" "defect_severity" DEFAULT 'minor' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_dvir_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"report_type" text DEFAULT 'pre_trip' NOT NULL,
	"trip_date" date NOT NULL,
	"odometer" integer,
	"safe_to_operate" boolean DEFAULT true NOT NULL,
	"defects_found" boolean DEFAULT false NOT NULL,
	"driver_notes" text,
	"mechanic_reviewed_at" timestamp,
	"mechanic_id" integer,
	"mechanic_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmcvi_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"inspection_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"result" "pmcvi_result" DEFAULT 'pending' NOT NULL,
	"inspection_station_name" text,
	"inspector_name" text,
	"certificate_number" text,
	"drive_on_document_key" text,
	"drive_on_uploaded_at" timestamp,
	"drive_on_uploaded_by_user_id" integer,
	"is_officially_passed" boolean DEFAULT false NOT NULL,
	"repair_notes" text,
	"reinspection_date" date,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadside_violations" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"inspection_date" date NOT NULL,
	"inspection_location" text,
	"violation_code" text,
	"violation_description" text NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"corrective_action" text,
	"repair_document_key" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "us_inspection_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"inspection_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"inspector_name" text,
	"inspector_id" text,
	"brake_inspector_name" text,
	"brake_inspector_id" text,
	"report_file_key" text,
	"result" text DEFAULT 'pass' NOT NULL,
	"notes" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" integer,
	"action" text NOT NULL,
	"changed_by_user_id" integer,
	"changed_by_name" text,
	"field_name" text,
	"old_value" text,
	"new_value" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_sent_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"notification_type" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"related_table_name" text,
	"related_record_id" integer,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"notification_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"related_table_name" text,
	"related_record_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_converted_work_order_id_work_orders_id_fk" FOREIGN KEY ("converted_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_reminders" ADD CONSTRAINT "pm_reminders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_attachments" ADD CONSTRAINT "vehicle_attachments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_odometer_entries" ADD CONSTRAINT "vehicle_odometer_entries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_status_history" ADD CONSTRAINT "vehicle_status_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_signatures" ADD CONSTRAINT "digital_signatures_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts_used" ADD CONSTRAINT "parts_used_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts_used" ADD CONSTRAINT "parts_used_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_comments" ADD CONSTRAINT "work_order_comments_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_comments" ADD CONSTRAINT "work_order_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_labour" ADD CONSTRAINT "work_order_labour_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_labour" ADD CONSTRAINT "work_order_labour_mechanic_id_users_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_photos" ADD CONSTRAINT "work_order_photos_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_photos" ADD CONSTRAINT "work_order_photos_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_status_history" ADD CONSTRAINT "work_order_status_history_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_status_history" ADD CONSTRAINT "work_order_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_mechanic_id_users_id_fk" FOREIGN KEY ("assigned_mechanic_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_instance_id_checklist_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."checklist_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_item_id_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_responses" ADD CONSTRAINT "checklist_responses_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_photos" ADD CONSTRAINT "defect_photos_defect_id_defects_id_fk" FOREIGN KEY ("defect_id") REFERENCES "public"."defects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_photos" ADD CONSTRAINT "defect_photos_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_checklist_instance_id_checklist_instances_id_fk" FOREIGN KEY ("checklist_instance_id") REFERENCES "public"."checklist_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_repaired_by_user_id_users_id_fk" FOREIGN KEY ("repaired_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_dvir_defects" ADD CONSTRAINT "driver_dvir_defects_dvir_report_id_driver_dvir_reports_id_fk" FOREIGN KEY ("dvir_report_id") REFERENCES "public"."driver_dvir_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_dvir_defects" ADD CONSTRAINT "driver_dvir_defects_defect_id_defects_id_fk" FOREIGN KEY ("defect_id") REFERENCES "public"."defects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_dvir_reports" ADD CONSTRAINT "driver_dvir_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_dvir_reports" ADD CONSTRAINT "driver_dvir_reports_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_dvir_reports" ADD CONSTRAINT "driver_dvir_reports_mechanic_id_users_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pmcvi_records" ADD CONSTRAINT "pmcvi_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pmcvi_records" ADD CONSTRAINT "pmcvi_records_drive_on_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("drive_on_uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pmcvi_records" ADD CONSTRAINT "pmcvi_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadside_violations" ADD CONSTRAINT "roadside_violations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadside_violations" ADD CONSTRAINT "roadside_violations_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "us_inspection_records" ADD CONSTRAINT "us_inspection_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "us_inspection_records" ADD CONSTRAINT "us_inspection_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_sent_log" ADD CONSTRAINT "notification_sent_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_code_uniq" ON "customers" USING btree ("company_id","customer_code");--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_company_number_uniq" ON "estimates" USING btree ("company_id","estimate_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_schedules_vehicle_pm_uniq" ON "pm_schedules" USING btree ("vehicle_id","pm_type");