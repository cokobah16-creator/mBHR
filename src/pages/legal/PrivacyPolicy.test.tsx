import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivacyPolicy from "./PrivacyPolicy";
import { PRIVACY_VERSION, formatPolicyDate } from "./policyMeta";
import {
  DEFAULT_SHARING_FLAGS,
  SHARING_OPTIONS,
  choiceLabel,
} from "@/features/patient-portal/account/sharingChanges";

/*
 * The privacy notice must name every service that receives data. This test
 * looks for each known service in the code and fails if the notice does not
 * name it. When you add a service, add a row here and a line to the notice.
 */

// App and server-function source, keyed by path. The notice itself and the
// tests are left out so they cannot satisfy the check on their own. Vite
// resolves these at transform time, so the test needs no Node APIs.
const CODE = import.meta.glob(
  [
    "/src/**/*.{ts,tsx}",
    "/supabase/functions/**/*.ts",
    "!/src/pages/legal/**",
    "!**/*.test.{ts,tsx}",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// The hosting config. Its Content-Security-Policy lists every host the
// browser may contact, including the map CDNs that public/nigeria-loader.js
// fetches from (files in public/ cannot be imported here).
const VERCEL_JSON =
  (
    import.meta.glob("/vercel.json", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>
  )["/vercel.json"] ?? "";

const ALL_CODE = [...Object.values(CODE), VERCEL_JSON].join("\n");

/** Text that shows a service is used, and the name the notice must give it. */
const SERVICES: Array<{ marker: string; name: string }> = [
  { marker: "@supabase/supabase-js", name: "Supabase" },
  { marker: "api.ng.termii.com", name: "Termii" },
  { marker: "api.twilio.com", name: "Twilio" },
  { marker: "api.resend.com", name: "Resend" },
  { marker: "meet.jit.si", name: "meet.jit.si" },
  { marker: "cdn.jsdelivr.net", name: "jsDelivr" },
  { marker: "cdn.statically.io", name: "Statically" },
  { marker: "@sentry/react", name: "Sentry" },
];

function renderNotice() {
  return render(
    <MemoryRouter>
      <PrivacyPolicy />
    </MemoryRouter>,
  );
}

function noticeText(): string {
  return document.body.textContent ?? "";
}

describe("PrivacyPolicy", () => {
  it("shows the current version as its date", () => {
    renderNotice();
    expect(
      screen.getByText(`Last updated ${formatPolicyDate(PRIVACY_VERSION)}`),
    ).toBeInTheDocument();
  });

  it.each(SERVICES)("names $name, which the code uses", ({ marker, name }) => {
    // If this fails, the service is gone from the code: remove its row here
    // and its line from the notice.
    expect(ALL_CODE).toContain(marker);
    renderNotice();
    expect(noticeText()).toContain(name);
  });

  it("names the host and the service that runs the nightly backup", () => {
    // vercel.json deploys the app to Vercel. The backup is
    // .github/workflows/backup.yml, which runs on GitHub Actions.
    expect(VERCEL_JSON).toContain("outputDirectory");
    renderNotice();
    expect(noticeText()).toContain("Vercel hosts the app");
    expect(noticeText()).toContain(
      "GitHub Actions runs our nightly database backup",
    );
  });

  it("says a different video server may replace meet.jit.si", () => {
    renderNotice();
    expect(noticeText()).toContain(
      "unless the Foundation has set up a different video server",
    );
  });

  it("lists the same starting sharing choices as the portal page", () => {
    renderNotice();
    const heading = screen.getByRole("heading", { name: "Your sharing choices" });
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    const items = within(section as HTMLElement)
      .getAllByRole("listitem")
      .map((li) => (li.textContent ?? "").replace(/\s+/g, " ").toLowerCase());

    for (const option of SHARING_OPTIONS) {
      const expected = `${option.title}: ${choiceLabel(
        option.key,
        DEFAULT_SHARING_FLAGS[option.key],
      )}`.toLowerCase();
      expect(items.some((text) => text.startsWith(expected))).toBe(true);
    }
    expect(
      within(section as HTMLElement).getByText(/Manage Data Sharing/),
    ).toBeInTheDocument();
  });

  it("does not promise that sharing choices are enforced", () => {
    renderNotice();
    expect(noticeText()).toContain(
      "Requests are not yet checked against them automatically",
    );
  });

  it("says portal accounts are for adults and accepted versions are recorded", () => {
    renderNotice();
    expect(noticeText()).toContain(
      "You must be 18 or older to create your own portal account",
    );
    expect(noticeText()).toContain(
      "which versions of the terms of use and this notice you accepted and when",
    );
  });
});
