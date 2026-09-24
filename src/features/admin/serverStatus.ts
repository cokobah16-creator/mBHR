/**
 * Plain description of whether this device can reach the server (Supabase)
 * right now. Admin tools that create portal accounts or send email need both
 * a configured server and a connection; everything else works offline.
 */
export type ServerState = "not-configured" | "offline" | "available";

export interface ServerStatus {
  state: ServerState;
  available: boolean;
  /** Short label for a status badge. */
  label: string;
  /** What that means for the person using the page. */
  detail: string;
}

export function describeServerStatus(
  configured: boolean,
  online: boolean,
): ServerStatus {
  if (!configured) {
    return {
      state: "not-configured",
      available: false,
      label: "No server connected",
      detail:
        "This device is not set up to connect to a server. Work is saved on this device only.",
    };
  }
  if (!online) {
    return {
      state: "offline",
      available: false,
      label: "Offline",
      detail:
        "This device has no internet connection. Work is saved on this device and uploaded when the connection returns.",
    };
  }
  // navigator.onLine only says a network is present; it does not prove the
  // server answers, so the label stays "Online" rather than "reachable".
  return {
    state: "available",
    available: true,
    label: "Online",
    detail:
      "This device is online and set up to use the server. A request can still fail if the server does not respond.",
  };
}
