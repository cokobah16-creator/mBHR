import { supabase } from "../lib/supabase";

// Localized SMS bodies live in the Supabase message_templates table, keyed by
// (key, locale, channel). Locales match src/i18n: en, ha, yo, ig, pcm.
export type SmsTemplateKey =
  | "medication_reminder"
  | "follow_up_reminder"
  | "outreach_announcement"
  | "visit_thank_you"
  | "otp"
  | "test_message"
  | "televisit_scheduled";

// English fallbacks so composing still works offline or before the
// message_templates table has been seeded.
const FALLBACK_BODIES: Record<SmsTemplateKey, string> = {
  medication_reminder:
    "mBHR: {{patient_name}}, please take your {{medication}} ({{dosage}}) now, as prescribed.",
  follow_up_reminder:
    "mBHR: {{patient_name}}, your follow-up visit is on {{date}} at {{site_name}}. Please come with your card.",
  outreach_announcement:
    "mBHR: Free medical outreach on {{date}} at {{site_name}}. Treatment and medicines at no cost. Bring your card if you have one.",
  visit_thank_you:
    "mBHR: Thank you for visiting, {{patient_name}}. Take your medicines as instructed. If symptoms get worse, please return or go to the nearest hospital.",
  otp: "Your mBHR verification code is {{otp}}. It expires in 10 minutes. Do not share this code with anyone.",
  test_message:
    "mBHR: This is a test message. Your SMS setup is working correctly.",
  televisit_scheduled:
    "mBHR: {{patient_name}}, your video visit with {{provider_name}} is on {{date}} at {{time}}. Join: {{link}}",
};

const cache = new Map<string, string>();

export function renderTemplate(
  body: string,
  vars: Record<string, string>,
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? vars[name] : match,
  );
}

export async function getSmsTemplateBody(
  key: SmsTemplateKey,
  locale = "en",
): Promise<string> {
  const cacheKey = `${key}:${locale}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    if (supabase) {
      const { data } = await supabase
        .from("message_templates")
        .select("locale, body")
        .eq("channel", "sms")
        .eq("key", key)
        .in("locale", locale === "en" ? ["en"] : [locale, "en"]);

      const rows = (data ?? []) as Array<{ locale: string; body: string }>;
      const body =
        rows.find((row) => row.locale === locale)?.body ??
        rows.find((row) => row.locale === "en")?.body;

      if (body) {
        cache.set(cacheKey, body);
        return body;
      }
    }
  } catch {
    // offline or table missing — fall through to the built-in English body
  }

  return FALLBACK_BODIES[key];
}

export async function composeSms(
  key: SmsTemplateKey,
  locale: string | undefined,
  vars: Record<string, string>,
): Promise<string> {
  const body = await getSmsTemplateBody(key, locale || "en");
  return renderTemplate(body, vars);
}

export function clearTemplateCache(): void {
  cache.clear();
}
