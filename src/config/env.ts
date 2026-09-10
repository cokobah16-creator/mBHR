// Centralised, validated access to import.meta.env.
//
// Each variable is read once at module load through zod; missing required
// values throw immediately in dev (so misconfigured local setups fail loudly)
// and report to Sentry without crashing in prod (so the app still boots in
// offline-only mode when the cloud config is missing).
//
// To add a new env var: add it to envSchema below. Callers should import
// `env` from here rather than reading `import.meta.env` directly.

import { z } from "zod";
import { captureError } from "@/lib/logger";

const envSchema = z.object({
  // Supabase (optional — empty string means "offline-only mode")
  VITE_SUPABASE_URL: z.string().url().or(z.literal("")).default(""),
  VITE_SUPABASE_ANON_KEY: z.string().default(""),

  // App
  VITE_APP_URL: z
    .string()
    .url()
    .default(
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:5173",
    ),
  VITE_SITE_NAME: z.string().default("Med Bridge Health Reach"),
  VITE_ORGANIZATION: z.string().default("Dr. Isioma Okobah Foundation"),

  // Observability
  VITE_SENTRY_DSN: z.string().default(""),

  // Outbound messaging (optional)
  VITE_TERMII_API_KEY: z.string().optional(),
  VITE_TERMII_SENDER_ID: z.string().optional(),
  VITE_INVITE_RATE_MS: z.coerce.number().int().nonnegative().default(60_000),

  // Televisits (video-room base URL; rooms are appended as /mbhr-<uuid>).
  // A present-but-blank value is treated as unset so the default applies.
  VITE_TELEVISIT_BASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().default("https://meet.jit.si"),
  ),
});

export type EnvShape = z.infer<typeof envSchema>;

function readRaw(): Record<string, unknown> {
  // Vite's import.meta.env is statically replaced at build time, so we have
  // to enumerate the keys we care about rather than spreading.
  const e = import.meta.env as unknown as Record<string, unknown>;
  return {
    VITE_SUPABASE_URL: e.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: e.VITE_SUPABASE_ANON_KEY,
    VITE_APP_URL: e.VITE_APP_URL,
    VITE_SITE_NAME: e.VITE_SITE_NAME,
    VITE_ORGANIZATION: e.VITE_ORGANIZATION,
    VITE_SENTRY_DSN: e.VITE_SENTRY_DSN,
    VITE_TERMII_API_KEY: e.VITE_TERMII_API_KEY,
    VITE_TERMII_SENDER_ID: e.VITE_TERMII_SENDER_ID,
    VITE_INVITE_RATE_MS: e.VITE_INVITE_RATE_MS,
    VITE_TELEVISIT_BASE_URL: e.VITE_TELEVISIT_BASE_URL,
  };
}

function parseEnv(): EnvShape {
  const raw = readRaw();
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const flat = result.error.flatten().fieldErrors;
  const message =
    "Invalid environment variables:\n" +
    Object.entries(flat)
      .map(([k, errs]) => `  ${k}: ${(errs ?? []).join(", ")}`)
      .join("\n");

  if (import.meta.env.DEV) {
    // In dev, surface immediately.
    throw new Error(message);
  }

  // In prod, fall back to defaults and report so the app still boots.
  captureError(new Error(message), {
    tag: "env.validation",
    extra: { errors: flat },
  });
  return envSchema.parse({});
}

export const env: EnvShape = parseEnv();

export const supabaseConfigured = (): boolean =>
  Boolean(env.VITE_SUPABASE_URL) && Boolean(env.VITE_SUPABASE_ANON_KEY);
