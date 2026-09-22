import { useLiveQuery } from "dexie-react-hooks";
import { db, type Site } from "@/db";
import { ACTIVE_SITE_SETTING_KEY } from "@/services/activeSite";

export interface ActiveSiteState {
  loading: boolean;
  site: Site | undefined;
  /** Sites an operator can switch to. */
  options: Site[];
}

/** Live view of the device's active outreach site and the selectable sites. */
export function useActiveSite(): ActiveSiteState {
  const data = useLiveQuery(async () => {
    const [row, sites] = await Promise.all([
      db.settings.get(ACTIVE_SITE_SETTING_KEY),
      db.sites.toArray(),
    ]);
    const options = sites
      .filter((s) => s.active === 1)
      .sort((a, b) => a.name.localeCompare(b.name));
    const site = row?.value ? options.find((s) => s.id === row.value) : undefined;
    return { site, options };
  }, []);

  return {
    loading: data === undefined,
    site: data?.site,
    options: data?.options ?? [],
  };
}
