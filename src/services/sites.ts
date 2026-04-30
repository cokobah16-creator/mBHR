// Outreach site registry. Admins can add/disable named sites that show
// up in visit creation flows and the outreach report's site filter.
import { db, generateId, Site } from "@/db";

export async function listAllSites(): Promise<Site[]> {
  return db.sites.orderBy("name").toArray();
}

export async function listActiveSites(): Promise<Site[]> {
  const sites = await db.sites.toArray();
  return sites
    .filter((s) => s.active === 1)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listActiveSiteNames(): Promise<string[]> {
  const sites = await listActiveSites();
  return sites.map((s) => s.name);
}

export async function addSite(name: string, notes?: string): Promise<Site> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Site name is required");

  const existing = await db.sites
    .filter((s) => s.name.toLowerCase() === trimmed.toLowerCase())
    .first();
  if (existing) {
    if (existing.active === 1) return existing;
    return setSiteActive(existing.id, true);
  }

  const now = new Date();
  const site: Site = {
    id: generateId(),
    name: trimmed,
    active: 1,
    notes,
    createdAt: now,
    updatedAt: now,
  };
  await db.sites.add(site);
  return site;
}

export async function setSiteActive(
  id: string,
  active: boolean,
): Promise<Site> {
  const existing = await db.sites.get(id);
  if (!existing) throw new Error("Site not found");
  const updated: Site = {
    ...existing,
    active: active ? 1 : 0,
    updatedAt: new Date(),
  };
  await db.sites.put(updated);
  return updated;
}
