// Printable ticket slip for the patient to hold. Like the waiting-room
// display it carries no personal details: ticket number, where to go, the
// outreach site and when it was issued.
import { formatNigerianDateTime } from "@/utils/dateFormat";

export interface PrintableTicket {
  ticketNumber: string;
  destination: string;
  siteName: string;
  issuedAt: Date;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

export function buildTicketPrintHtml(t: PrintableTicket): string {
  const number = escapeHtml(t.ticketNumber);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ticket ${number}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #000; text-align: center; }
  .site { font-size: 13pt; font-weight: 600; }
  .label { margin-top: 5mm; font-size: 10pt; letter-spacing: 0.08em; text-transform: uppercase; }
  .number { margin: 1mm 0 2mm; font-size: 48pt; font-weight: 800; line-height: 1.1; }
  .dest { font-size: 16pt; font-weight: 600; }
  .meta { margin-top: 4mm; font-size: 10pt; }
</style>
</head>
<body>
  <div class="site">${escapeHtml(t.siteName)}</div>
  <div class="label">Your ticket</div>
  <div class="number">${number}</div>
  <div class="dest">Go to: ${escapeHtml(t.destination)}</div>
  <div class="meta">Issued ${escapeHtml(formatNigerianDateTime(t.issuedAt))}</div>
  <div class="meta">Keep this ticket and listen for your number.</div>
</body>
</html>`;
}

/**
 * Opens the browser print dialog for one ticket slip using a hidden iframe,
 * so the staff page itself is not printed. Throws if the browser blocks it.
 * The browser does not say whether anything was actually printed.
 */
export function printTicket(t: PrintableTicket): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const remove = () => iframe.remove();
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument ?? win?.document;
    if (!win || !doc) throw new Error("Print frame unavailable");
    doc.open();
    doc.write(buildTicketPrintHtml(t));
    doc.close();
    win.addEventListener("afterprint", () => setTimeout(remove, 500), {
      once: true,
    });
    // Browsers that never fire afterprint still get cleaned up.
    setTimeout(remove, 60_000);
    win.focus();
    win.print();
  } catch (err) {
    remove();
    throw err;
  }
}
