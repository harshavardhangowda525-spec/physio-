CREATE TYPE "public"."enquiry_source" AS ENUM('WEBSITE_CHAT', 'STAFF_ENTRY');--> statement-breakpoint
CREATE TYPE "public"."enquiry_status" AS ENUM('NEW_ENQUIRY', 'AWAITING_CLINIC_REVIEW', 'AWAITING_PATIENT_RESPONSE', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'TEST_MODE', 'NOT_CONFIGURED');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('ADMIN', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."therapist_preference" AS ENUM('NO_PREFERENCE', 'FEMALE', 'MALE');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" varchar(200) NOT NULL,
	"action" varchar(60) NOT NULL,
	"target" varchar(120),
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(32) NOT NULL,
	"patient_name" varchar(120) NOT NULL,
	"contact_number" varchar(20) NOT NULL,
	"preferred_date" date NOT NULL,
	"preferred_time" varchar(80) NOT NULL,
	"locality" varchar(120) NOT NULL,
	"service_requirement" varchar(500) NOT NULL,
	"therapist_preference" "therapist_preference" DEFAULT 'NO_PREFERENCE' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_text" text NOT NULL,
	"source" "enquiry_source" DEFAULT 'WEBSITE_CHAT' NOT NULL,
	"status" "enquiry_status" DEFAULT 'NEW_ENQUIRY' NOT NULL,
	"patient_change_request" text,
	"idempotency_key" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid,
	"channel" varchar(20) NOT NULL,
	"event" varchar(40) NOT NULL,
	"recipient" varchar(400),
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(200) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" DEFAULT 'STAFF' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"from_status" "enquiry_status",
	"to_status" "enquiry_status" NOT NULL,
	"changed_by" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_author_id_staff_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_token_uq" ON "chat_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "chat_updated_idx" ON "chat_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_reference_uq" ON "enquiries" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_idempotency_uq" ON "enquiries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "enquiries_status_idx" ON "enquiries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "enquiries_created_idx" ON "enquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "enquiries_phone_idx" ON "enquiries" USING btree ("contact_number");--> statement-breakpoint
CREATE INDEX "notif_status_idx" ON "notification_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notif_enquiry_idx" ON "notification_logs" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "notes_enquiry_idx" ON "staff_notes" USING btree ("enquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_uq" ON "staff_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "history_enquiry_idx" ON "status_history" USING btree ("enquiry_id");