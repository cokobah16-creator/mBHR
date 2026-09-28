import React, { useState } from "react";
import { checkForNewVersion } from "@/lib/serviceWorker";

/**
 * For a person with a staff account on a device with no online sign-in:
 * their account cannot be added here, but this may be an old copy of the
 * app that the service worker kept. A newer version reloads the page.
 */
export function UpdateCheck({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "checking" | "latest">("idle");
  const check = async () => {
    setState("checking");
    const updating = await checkForNewVersion().catch(() => false);
    if (!updating) setState("latest");
  };
  return (
    <div className="space-y-2">
      <p className="text-caption text-ink-muted">{children}</p>
      <button
        type="button"
        disabled={state === "checking"}
        onClick={check}
        className="btn-secondary w-full h-12"
      >
        {state === "checking" ? "Checking for updates…" : "Check for updates"}
      </button>
      {state === "latest" && (
        <p className="text-caption text-ink-muted" role="status">
          This is the latest version of the app available here. Sign in on the
          device where your account was created, or ask whoever runs mBHR for
          your organisation to connect this address to the server.
        </p>
      )}
    </div>
  );
}
