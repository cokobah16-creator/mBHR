// The outreach site this device is currently recording for.
//
// Every visit carries a siteName, and the outreach report filters by it.
// Recording under the wrong site/day at a temporary camp is an operational
// error, so the active site is chosen explicitly, stored per device, shown
// in the staff header, and stamped onto every new visit.
import { db, generateId, type Site } from "@/db";
import { useAuthStore } from "@/stores/auth";

const SETTING_KEY = "active_outreach_site_id";

/** Used when no site has been chosen — matches the historical default. */
export const DEFAULT_SITE_NAME = "Mobile Clinic";

export async function getActiveSite(): Promise<Site | undefined> {
  const row = await db.settings.get(SETTING_KEY);
  if (!row?.value) return undefined;
  const site = await db.sites.get(row.value);
  return site && site.active === 1 ? site : undefined;
}

/** Name to stamp on a new visit. Never throws — falls back to the default. */
export async function getActiveSiteName(): Promise<string> {
  try {
    return (await getActiveSite())?.name ?? DEFAULT_SITE_NAME;
  } catch {
    return DEFAULT_SITE_NAME;
  }
}

export async function setActiveSite(siteId: string | null): Promise<void> {
  if (siteId) {
    const site = await db.sites.get(siteId);
    if (!site || site.active !== 1) {
      throw new Error("That site is not active. Ask an administrator to enable it.");
    }
    await db.settings.put({ key: SETTING_KEY, value: siteId });
  } else {
    await db.settings.delete(SETTING_KEY);
  }

  const actorRole = useAuthStore.getState().currentUser?.role ?? "unknown";
  await db.auditLogs
    .add({
      id: generateId(),
      actorRole,
      action: "set_active_site",
      entity: "site",
      entityId: siteId ?? "none",
      at: new Date(),
    })
    .catch(() => undefined);
}

export const ACTIVE_SITE_SETTING_KEY = SETTING_KEY;
