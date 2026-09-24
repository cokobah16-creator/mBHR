/**
 * Moves a password-reset link that landed on the wrong page to /reset-password.
 *
 * Supabase only redirects a reset link to the URL the app asked for when that
 * URL is on the project's redirect allow list. Otherwise it silently sends the
 * user to the project's Site URL instead, with the recovery token still in the
 * URL hash. When the Site URL is the app's home page, supabase-js consumes the
 * token there, the user just sees the home page, and the link looks dead.
 *
 * This runs before the Supabase client exists (see lib/supabaseClient), so the
 * token reaches the reset page instead. The real fix is still the allow list
 * (docs/PASSWORD_RECOVERY.md); this makes a configuration slip degrade
 * gracefully rather than silently.
 */

export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * Returns the path (plus query and hash) the page should be at when `href`
 * carries a recovery token but is not the reset page, or null when the URL
 * should be left alone.
 */
export function recoveryLandingPath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.pathname.replace(/\/+$/, "") === RESET_PASSWORD_PATH) return null;

  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (hash.get("type") !== "recovery" || !hash.get("access_token")) return null;

  return `${RESET_PASSWORD_PATH}${url.search}${url.hash}`;
}

/**
 * Rewrites the current URL in place (no reload, no history entry) when a
 * recovery token landed somewhere other than the reset page. Returns whether
 * anything changed.
 */
export function relocateRecoveryLanding(
  win: Pick<Window, "location" | "history"> = window,
): boolean {
  const target = recoveryLandingPath(win.location.href);
  if (!target) return false;
  try {
    win.history.replaceState(win.history.state, "", target);
    return true;
  } catch {
    return false;
  }
}
