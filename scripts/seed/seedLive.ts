#!/usr/bin/env tsx
/**
 * Live-database bootstrap seed for mBHR.
 *
 * Seeds the production Supabase project with everything a first outreach day
 * needs: organization, site, staff (full identity chain: auth.users +
 * staff_roles + app_users + user_org_sites + the PIN roster in `users`),
 * the outreach-day pharmacy formulary (pharmacy_items + site_formulary),
 * clinical protocols, prescription templates, localized SMS message
 * templates, and the first outreach_event with staff assignments.
 *
 * Usage:
 *   cp scripts/seed/roster.example.json scripts/seed/roster.json  # edit it
 *   npm run seed:live                # or: npx tsx scripts/seed/seedLive.ts
 *   npm run seed:live -- --dry-run   # show the plan without writing
 *   npm run seed:live -- --roster path/to/roster.json
 *
 * Env (env vars, .env.local, or .env): SUPABASE_URL (or VITE_SUPABASE_URL)
 * and SUPABASE_SERVICE_ROLE_KEY. The service role key is REQUIRED — the
 * multi-tenant RLS policies make first-row inserts impossible for any other
 * role. Never ship this key to a client.
 *
 * Idempotent: safe to re-run. Rows are upserted on their natural keys, and
 * existing staff PINs / auth passwords are left untouched unless the roster
 * specifies them explicitly.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { derivePinHash, newSaltB64 } from "../../src/utils/pin";
import { FORMULARY_ITEMS } from "./data/formulary";
import { MESSAGE_TEMPLATES } from "./data/messageTemplates";
import { PRESCRIPTION_TEMPLATES, PROTOCOLS } from "./data/protocols";

type StaffRole = "admin" | "doctor" | "nurse" | "pharmacist" | "volunteer";

interface RosterStaff {
  fullName: string;
  email: string;
  role: StaffRole;
  phone?: string;
  pin?: string;
  password?: string;
  adminAccess?: boolean;
  adminPermanent?: boolean;
  station?: string;
}

interface Roster {
  organization: { name: string; slug: string; subscriptionTier?: string };
  site: {
    name: string;
    siteCode: string;
    address: string;
    state: string;
    lga: string;
    typicalPatientVolume?: number;
    capacity?: number;
  };
  staff: RosterStaff[];
  event: {
    name: string;
    date: string;
    startTime?: string;
    endTime?: string;
    expectedVolume?: number;
    notes?: string;
  };
}

const VALID_ROLES: StaffRole[] = ["admin", "doctor", "nurse", "pharmacist", "volunteer"];
const DEFAULT_STATION: Record<StaffRole, string> = {
  admin: "registration",
  doctor: "consult",
  nurse: "vitals",
  pharmacist: "pharmacy",
  volunteer: "registration",
};

function loadDotEnv(): void {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Stable uuid derived from a name so re-runs upsert the same rows on tables
// whose only unique key is the uuid primary key (events, protocols).
function deterministicUuid(name: string): string {
  const bytes = createHash("sha256").update(`mbhr-seed:${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function randomPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function randomPassword(): string {
  return `mB!${randomBytes(12).toString("base64url")}`;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
  throw new Error(message);
}

function loadRoster(): Roster {
  const argIndex = process.argv.indexOf("--roster");
  const explicit = argIndex > -1 ? process.argv[argIndex + 1] : undefined;
  const candidates = explicit
    ? [resolve(process.cwd(), explicit)]
    : [
        resolve(__dirname, "roster.json"),
        resolve(process.cwd(), "scripts/seed/roster.json"),
      ];
  const rosterPath = candidates.find((p) => existsSync(p));

  if (explicit && !rosterPath) {
    fail(`--roster file not found: ${explicit}`);
  }

  let usingExample = false;
  let path = rosterPath;
  if (!path) {
    path = resolve(__dirname, "roster.example.json");
    usingExample = true;
  }

  const roster = JSON.parse(readFileSync(path, "utf8")) as Roster;

  if (usingExample) {
    const dryRun = process.argv.includes("--dry-run");
    if (!dryRun && !process.argv.includes("--allow-example")) {
      fail(
        "No scripts/seed/roster.json found. Refusing to seed PLACEHOLDER data into a real project.\n" +
          "  Copy scripts/seed/roster.example.json to scripts/seed/roster.json and fill in your\n" +
          "  real org, site and staff — or pass --allow-example if you really want demo data.",
      );
    }
    console.warn(
      "\n⚠ Using roster.example.json PLACEHOLDER data.\n",
    );
  }
  console.log(`Roster: ${path}`);

  // Validation: catch bad input before anything touches the database.
  const errors: string[] = [];
  if (!roster.organization?.name || !roster.organization?.slug) {
    errors.push("organization.name and organization.slug are required");
  }
  for (const key of ["name", "siteCode", "address", "state", "lga"] as const) {
    if (!roster.site?.[key]) errors.push(`site.${key} is required`);
  }
  if (!Array.isArray(roster.staff) || roster.staff.length === 0) {
    errors.push("staff must be a non-empty array");
  }
  const emails = new Set<string>();
  const derivedIds = new Set<string>();
  for (const s of roster.staff ?? []) {
    const label = s.fullName || s.email || "?";
    if (!s.fullName || !s.email) errors.push(`staff "${label}": fullName and email are required`);
    if (!VALID_ROLES.includes(s.role)) {
      errors.push(`staff "${label}": role must be one of ${VALID_ROLES.join(", ")}`);
    }
    if (s.pin !== undefined && !/^\d{6}$/.test(s.pin)) {
      errors.push(`staff "${label}": pin must be exactly 6 digits`);
    }
    const stations = ["registration", "vitals", "consult", "pharmacy", "lab", "education"];
    if (s.station !== undefined && !stations.includes(s.station)) {
      errors.push(`staff "${label}": station must be one of ${stations.join(", ")}`);
    }
    if (emails.has(s.email.toLowerCase())) errors.push(`duplicate staff email ${s.email}`);
    emails.add(s.email.toLowerCase());
    const derivedId = `user-${slugify(s.email)}`;
    if (derivedIds.has(derivedId)) {
      errors.push(`staff "${label}": email slug collides with another staff member (${derivedId})`);
    }
    derivedIds.add(derivedId);
  }
  if (!roster.event?.name || !/^\d{4}-\d{2}-\d{2}$/.test(roster.event?.date ?? "")) {
    errors.push("event.name is required and event.date must be YYYY-MM-DD");
  }
  if (!roster.staff?.some((s) => s.role === "admin")) {
    errors.push("at least one staff member must have role \"admin\"");
  }
  if (errors.length) fail(`Invalid roster:\n  - ${errors.join("\n  - ")}`);

  return roster;
}

interface SeededCredential {
  fullName: string;
  email: string;
  role: string;
  pin: string;
  password: string;
}

async function upsert(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown> | Array<Record<string, unknown>>,
  onConflict: string,
): Promise<void> {
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) {
    throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function findAuthUserByEmail(
  db: SupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth.admin.listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main(): Promise<void> {
  if (typeof globalThis.crypto?.subtle === "undefined") {
    fail("Node 20+ is required (WebCrypto is used for PIN hashing). Current: " + process.version);
  }
  loadDotEnv();
  const dryRun = process.argv.includes("--dry-run");

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) fail("SUPABASE_URL (or VITE_SUPABASE_URL) is not set (env, .env.local, .env)");
  if (!serviceKey && !dryRun) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set. The seed must run with the service role " +
        "(RLS blocks first-row inserts for every other role). Find it in the Supabase " +
        "dashboard under Project Settings → API. Do NOT put it in any VITE_* variable.",
    );
  }

  const roster = loadRoster();

  console.log(`\nTarget: ${url}${dryRun ? "  (DRY RUN — no writes)" : ""}`);
  console.log(
    `Plan: 1 org, 1 site, ${roster.staff.length} staff, ${FORMULARY_ITEMS.length} formulary items, ` +
      `${PROTOCOLS.length} protocols, ${PRESCRIPTION_TEMPLATES.length} prescription templates, ` +
      `${MESSAGE_TEMPLATES.length} SMS templates, 1 outreach event\n`,
  );
  if (dryRun) {
    for (const s of roster.staff) {
      console.log(`  staff: ${s.fullName} <${s.email}> ${s.role}${s.pin ? "" : " (PIN will be generated)"}`);
    }
    console.log("\nDry run complete — nothing written.");
    return;
  }

  const db = createClient(url!, serviceKey!, { auth: { persistSession: false } });

  // ── 1. Organization ────────────────────────────────────────────────────────
  const org = roster.organization;
  await upsert(
    db,
    "organizations",
    {
      name: org.name,
      slug: org.slug,
      subscription_tier: org.subscriptionTier ?? "standard",
      is_active: true,
    },
    "slug",
  );
  const { data: orgRow, error: orgErr } = await db
    .from("organizations")
    .select("id")
    .eq("slug", org.slug)
    .single();
  if (orgErr || !orgRow) fail(`could not read back organization: ${orgErr?.message}`);
  const orgId: string = orgRow.id;
  console.log(`✓ organization "${org.name}" (${orgId})`);

  // ── 2. Site ────────────────────────────────────────────────────────────────
  const site = roster.site;
  await upsert(
    db,
    "sites",
    {
      org_id: orgId,
      name: site.name,
      site_code: site.siteCode,
      address: site.address,
      state: site.state,
      lga: site.lga,
      typical_patient_volume: site.typicalPatientVolume ?? 200,
      capacity: site.capacity ?? 300,
      is_active: true,
    },
    "org_id,site_code",
  );
  const { data: siteRow, error: siteErr } = await db
    .from("sites")
    .select("id")
    .eq("org_id", orgId)
    .eq("site_code", site.siteCode)
    .single();
  if (siteErr || !siteRow) fail(`could not read back site: ${siteErr?.message}`);
  const siteId: string = siteRow.id;
  console.log(`✓ site "${site.name}" (${siteId})`);

  // ── 3. Staff identity chain ────────────────────────────────────────────────
  // auth.users (online email/password login) → staff_roles (role lookup on
  // online login) → app_users (is_staff() RLS gate) → user_org_sites
  // (org-scoped RLS) → users (canonical PIN roster).
  const credentials: SeededCredential[] = [];
  const authIdByEmail = new Map<string, string>();
  let adminAuthId = "";

  for (const staff of roster.staff) {
    const existing = await findAuthUserByEmail(db, staff.email);
    let authId: string;
    let password = "(unchanged — existing account)";
    if (existing) {
      authId = existing.id;
      if (staff.password) {
        const { error } = await db.auth.admin.updateUserById(authId, {
          password: staff.password,
        });
        if (error) throw new Error(`password update for ${staff.email} failed: ${error.message}`);
        password = staff.password;
      }
    } else {
      password = staff.password ?? randomPassword();
      const { data, error } = await db.auth.admin.createUser({
        email: staff.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: staff.fullName },
      });
      if (error || !data.user) {
        throw new Error(`auth user creation for ${staff.email} failed: ${error?.message}`);
      }
      authId = data.user.id;
    }
    authIdByEmail.set(staff.email.toLowerCase(), authId);

    const isAdmin = staff.role === "admin";
    if (isAdmin && !adminAuthId) adminAuthId = authId;

    await upsert(db, "staff_roles", { auth_user_id: authId, role: staff.role }, "auth_user_id");

    try {
      await upsert(
        db,
        "app_users",
        {
          id: authId,
          full_name: staff.fullName,
          role: staff.role,
          admin_access: staff.adminAccess ?? isAdmin,
          admin_permanent: staff.adminPermanent ?? false,
        },
        "id",
      );
    } catch (error) {
      // app_users is the is_staff() gate — without this row the account can
      // authenticate but cannot read any staff table.
      throw new Error(
        `${(error as Error).message}\n  app_users is required for staff RLS (is_staff()); ` +
          "check the live app_users column types (id/role) match the migrations.",
      );
    }

    await upsert(
      db,
      "user_org_sites",
      { user_id: authId, org_id: orgId, site_id: siteId, is_default: true },
      "user_id,org_id,site_id",
    );

    // PIN roster: keep an existing hash unless the roster pins it explicitly.
    // Id derives from the FULL email so ada@a.com and ada@b.com never collide.
    const userId = `user-${slugify(staff.email)}`;
    const { data: existingUser, error: userReadErr } = await db
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (userReadErr) throw new Error(`users read failed: ${userReadErr.message}`);

    let pin = "(unchanged)";
    const baseUserRow: Record<string, unknown> = {
      id: userId,
      full_name: staff.fullName,
      role: staff.role,
      email: staff.email,
      admin_access: staff.adminAccess ?? isAdmin,
      admin_permanent: staff.adminPermanent ?? false,
      is_active: 1,
    };
    if (staff.phone) baseUserRow.phone = staff.phone;
    if (!existingUser || staff.pin) {
      pin = staff.pin ?? randomPin();
      const pinSalt = newSaltB64();
      baseUserRow.pin_salt = pinSalt;
      baseUserRow.pin_hash = await derivePinHash(pin, pinSalt);
      await upsert(db, "users", baseUserRow, "id");
    } else {
      const { error } = await db.from("users").update(baseUserRow).eq("id", userId);
      if (error) throw new Error(`users update failed: ${error.message}`);
    }

    credentials.push({ fullName: staff.fullName, email: staff.email, role: staff.role, pin, password });
    console.log(`✓ staff ${staff.fullName} (${staff.role})`);
  }

  // ── 4. Pharmacy formulary ──────────────────────────────────────────────────
  // pharmacy_items is the dispensing catalog; on-hand quantities start at 0
  // and real stock is entered through the restock flow on packing day.
  // Existing rows keep their on_hand_qty — a re-run must never wipe live stock.
  const itemRows = FORMULARY_ITEMS.map((item) => ({
    id: `item-${slugify(`${item.medName}-${item.strength}-${item.form}`)}`,
    med_name: item.medName,
    form: item.form,
    strength: item.strength,
    unit: item.unit,
    reorder_threshold: item.reorderThreshold,
    is_controlled: item.isControlled,
  }));
  const { data: existingItems, error: itemsReadErr } = await db
    .from("pharmacy_items")
    .select("id")
    .in("id", itemRows.map((r) => r.id));
  if (itemsReadErr) throw new Error(`pharmacy_items read failed: ${itemsReadErr.message}`);
  const existingItemIds = new Set((existingItems ?? []).map((r: { id: string }) => r.id));

  const newItems = itemRows
    .filter((r) => !existingItemIds.has(r.id))
    .map((r) => ({ ...r, on_hand_qty: 0 }));
  if (newItems.length) {
    const { error } = await db.from("pharmacy_items").insert(newItems);
    if (error) throw new Error(`pharmacy_items insert failed: ${error.message}`);
  }
  for (const row of itemRows.filter((r) => existingItemIds.has(r.id))) {
    const { id, ...fields } = row;
    const { error } = await db.from("pharmacy_items").update(fields).eq("id", id);
    if (error) throw new Error(`pharmacy_items update failed: ${error.message}`);
  }
  console.log(`✓ pharmacy_items: ${itemRows.length} (${newItems.length} new)`);

  const formularyRows = FORMULARY_ITEMS.map((item) => ({
    org_id: orgId,
    site_id: siteId,
    medication_name: item.medName,
    generic_name: item.genericName,
    form: item.form,
    strength: item.strength,
    unit: item.unit,
    typical_stock_level: item.typicalStockLevel,
    reorder_threshold: item.reorderThreshold,
    is_controlled: item.isControlled,
    notes: item.notes ?? null,
    is_active: true,
  }));
  await upsert(db, "site_formulary", formularyRows, "org_id,site_id,medication_name,strength");
  console.log(`✓ site_formulary: ${formularyRows.length}`);

  // ── 5. Clinical protocols & prescription templates ─────────────────────────
  const protocolRows = PROTOCOLS.map((p) => ({
    id: deterministicUuid(`protocol:${p.title}`),
    org_id: orgId,
    site_id: null,
    title: p.title,
    condition: p.condition,
    category: p.category,
    protocol_content: p.protocolContent,
    algorithm: p.algorithm ?? null,
    medications: p.medications,
    contraindications: p.contraindications,
    special_considerations: p.specialConsiderations ?? null,
    clinical_references: p.clinicalReferences,
    is_active: true,
    created_by: adminAuthId,
  }));
  await upsert(db, "protocol_library", protocolRows, "id");
  console.log(`✓ protocol_library: ${protocolRows.length}`);

  const templateRows = PRESCRIPTION_TEMPLATES.map((t) => ({
    org_id: orgId,
    name: t.name,
    condition: t.condition,
    description: t.description,
    medications: t.medications,
    is_protocol: false,
    is_active: true,
    created_by: adminAuthId,
  }));
  await upsert(db, "prescription_templates", templateRows, "org_id,name");
  console.log(`✓ prescription_templates: ${templateRows.length}`);

  // ── 6. SMS message templates (en, ha, yo, ig, pcm) ─────────────────────────
  await upsert(db, "message_templates", MESSAGE_TEMPLATES as unknown as Array<Record<string, unknown>>, "key,locale,channel");
  console.log(`✓ message_templates: ${MESSAGE_TEMPLATES.length}`);

  // ── 7. First outreach event + staff assignments ────────────────────────────
  const event = roster.event;
  const eventId = deterministicUuid(`event:${org.slug}:${site.siteCode}:${event.date}`);
  const eventRow: Record<string, unknown> = {
    org_id: orgId,
    site_id: siteId,
    event_name: event.name,
    event_date: event.date,
    start_time: event.startTime ?? "09:00",
    end_time: event.endTime ?? "15:00",
    expected_volume: event.expectedVolume ?? site.typicalPatientVolume ?? 200,
    notes: event.notes ?? null,
    staff_roster: roster.staff.map((s) => ({
      name: s.fullName,
      role: s.role,
      station: s.station ?? DEFAULT_STATION[s.role],
    })),
  };
  const { data: existingEvent, error: eventReadErr } = await db
    .from("outreach_events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventReadErr) throw new Error(`outreach_events read failed: ${eventReadErr.message}`);
  if (existingEvent) {
    // Never reset the status of an event that has since gone active/completed.
    const { error } = await db.from("outreach_events").update(eventRow).eq("id", eventId);
    if (error) throw new Error(`outreach_events update failed: ${error.message}`);
  } else {
    const { error } = await db
      .from("outreach_events")
      .insert({ id: eventId, status: "planned", ...eventRow });
    if (error) throw new Error(`outreach_events insert failed: ${error.message}`);
  }
  const assignmentRows = roster.staff.map((s) => ({
    event_id: eventId,
    user_id: authIdByEmail.get(s.email.toLowerCase()),
    role: s.role,
    station: s.station ?? DEFAULT_STATION[s.role],
    is_supervising: s.role === "admin",
  }));
  await upsert(db, "event_staff_assignments", assignmentRows, "event_id,user_id");
  console.log(`✓ outreach_event "${event.name}" (${event.date}) with ${assignmentRows.length} staff assigned`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n═══ Seed complete ═══\n");
  console.log("Staff credentials (SHOWN ONCE — record them somewhere safe now):\n");
  for (const c of credentials) {
    console.log(`  ${c.fullName.padEnd(28)} ${c.role.padEnd(11)} ${c.email}`);
    console.log(`  ${"".padEnd(28)} PIN: ${c.pin.padEnd(22)} password: ${c.password}\n`);
  }
  console.log(
    "Next steps:\n" +
      "  1. Clinic devices authenticate PINs against their LOCAL database. On each\n" +
      "     device: log in as an admin, open User Management, and create the same\n" +
      "     staff with these PINs (the cloud `users` table is the canonical roster).\n" +
      "  2. Physical stock is entered via the restock flow on packing day —\n" +
      "     on-hand quantities were deliberately seeded as 0.\n" +
      "  3. SMS: set the Termii secrets and run `npm run test:sms` (see SMS_SETUP_TERMII.md).\n",
  );
}

main().catch((error) => {
  console.error("\n✗ Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
