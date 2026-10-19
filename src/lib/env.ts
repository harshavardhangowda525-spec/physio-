import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: bool,
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  CHAT_TOKEN_SECRET: z.string().min(32, "CHAT_TOKEN_SECRET must be at least 32 characters"),
  ALLOWED_EMBED_ORIGINS: z.string().default(""),

  // AI provider (optional). Leave GROQ_API_KEY empty for rule-only mode.
  AI_PROVIDER: z.enum(["none", "groq"]).default("none"),
  GROQ_API_KEY: z.string().default(""),
  GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),

  // Email notifications. EMAIL_MODE: disabled | test | smtp
  EMAIL_MODE: z.enum(["disabled", "test", "smtp"]).default("disabled"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  EMAIL_FROM: z.string().default(""),
  STAFF_NOTIFICATION_EMAILS: z.string().default(""),

  RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  MAX_ADVANCE_BOOKING_DAYS: z.coerce.number().int().positive().default(90),
  CLINIC_TIMEZONE: z.string().default("Asia/Kolkata"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server-side configuration. Never import this from client components. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment configuration:\n  ${issues.join("\n  ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests: drop the cached config so changed process.env values apply. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function staffRecipients(): string[] {
  return env()
    .STAFF_NOTIFICATION_EMAILS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function embedOrigins(): string[] {
  return env()
    .ALLOWED_EMBED_ORIGINS.split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
