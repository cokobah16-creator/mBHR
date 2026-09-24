import { describe, it, expect } from "vitest";
import { buildTicketPrintHtml, escapeHtml } from "./ticketPrint";

describe("buildTicketPrintHtml", () => {
  const ticket = {
    ticketNumber: "Q-014",
    destination: "Vitals",
    siteName: "Ikorodu Town Hall",
    issuedAt: new Date(2026, 8, 23, 9, 5),
  };

  it("shows the ticket number, destination, site and issue time", () => {
    const html = buildTicketPrintHtml(ticket);
    expect(html).toContain('<div class="number">Q-014</div>');
    expect(html).toContain("Go to: Vitals");
    expect(html).toContain("Ikorodu Town Hall");
    expect(html).toContain("Issued 23/09/2026 09:05");
  });

  it("escapes values so stored text cannot inject markup", () => {
    const html = buildTicketPrintHtml({ ...ticket, siteName: '<img src=x onerror="x">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;x&quot;&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
