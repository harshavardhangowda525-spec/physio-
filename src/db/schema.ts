import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  varchar,
  date,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const ENQUIRY_STATUSES = [
  "NEW_ENQUIRY",
  "AWAITING_CLINIC_REVIEW",
  "AWAITING_PATIENT_RESPONSE",
  "CONFIRMED",
  "RESCHEDULE_REQUESTED",
  "CANCELLED",
  "COMPLETED",
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const enquiryStatus = pgEnum("enquiry_status", ENQUIRY_STATUSES);
export const enquirySource = pgEnum("enquiry_source", ["WEBSITE_CHAT", "STAFF_ENTRY"]);
export const therapistPreference = pgEnum("therapist_preference", [
  "NO_PREFERENCE",
  "FEMALE",
  "MALE",
]);
export const staffRole = pgEnum("staff_role", ["ADMIN", "STAFF"]);
export const notificationStatus = pgEnum("notification_status", [
  "PENDING",
  "SENT",
  "FAILED",
  "TEST_MODE",
  "NOT_CONFIGURED",
]);

export const enquiries = pgTable(
  "enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 32 }).notNull(),
    patientName: varchar("patient_name", { length: 120 }).notNull(),
    contactNumber: varchar("contact_number", { length: 20 }).notNull(),
    preferredDate: date("preferred_date").notNull(),
    preferredTime: varchar("preferred_time", { length: 80 }).notNull(),
    locality: varchar("locality", { length: 120 }).notNull(),
    serviceRequirement: varchar("service_requirement", { length: 500 }).notNull(),
    therapistPreference: therapistPreference("therapist_preference")
      .notNull()
      .default("NO_PREFERENCE"),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    consentText: text("consent_text").notNull(),
    source: enquirySource("source").notNull().default("WEBSITE_CHAT"),
    status: enquiryStatus("status").notNull().default("NEW_ENQUIRY"),
    patientChangeRequest: text("patient_change_request"),
    idempotencyKey: varchar("idempotency_key", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("enquiries_reference_uq").on(t.reference),
    uniqueIndex("enquiries_idempotency_uq").on(t.idempotencyKey),
    index("enquiries_status_idx").on(t.status),
    index("enquiries_created_idx").on(t.createdAt),
    index("enquiries_phone_idx").on(t.contactNumber),
  ],
);

export const staffUsers = pgTable(
  "staff_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 200 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: staffRole("role").notNull().default("STAFF"),
    active: boolean("active").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("staff_email_uq").on(t.email)],
);

export const staffNotes = pgTable(
  "staff_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enquiryId: uuid("enquiry_id")
      .notNull()
      .references(() => enquiries.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => staffUsers.id, { onDelete: "set null" }),
    authorName: varchar("author_name", { length: 120 }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notes_enquiry_idx").on(t.enquiryId)],
);

export const statusHistory = pgTable(
  "status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enquiryId: uuid("enquiry_id")
      .notNull()
      .references(() => enquiries.id, { onDelete: "cascade" }),
    fromStatus: enquiryStatus("from_status"),
    toStatus: enquiryStatus("to_status").notNull(),
    changedBy: varchar("changed_by", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("history_enquiry_idx").on(t.enquiryId)],
);

export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 20 }).notNull(),
    event: varchar("event", { length: 40 }).notNull(),
    recipient: varchar("recipient", { length: 400 }),
    status: notificationStatus("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: varchar("provider_message_id", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notif_status_idx").on(t.status),
    index("notif_enquiry_idx").on(t.enquiryId),
  ],
);

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    state: jsonb("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("chat_token_uq").on(t.tokenHash), index("chat_updated_idx").on(t.updatedAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: varchar("actor", { length: 200 }).notNull(),
    action: varchar("action", { length: 60 }).notNull(),
    target: varchar("target", { length: 120 }),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export type Enquiry = typeof enquiries.$inferSelect;
export type NewEnquiry = typeof enquiries.$inferInsert;
export type StaffUser = typeof staffUsers.$inferSelect;
export type NotificationLog = typeof notificationLogs.$inferSelect;
