// Chart colours for report charts. Each daily-activity series belongs to one
// patient-flow stage, so it uses that stage's token colour (tailwind.config.js
// `stage.*`); charts need literal values because they draw SVG.

export type ActivitySeriesKey = "registrations" | "vitals" | "consultations" | "dispenses";

export const ACTIVITY_SERIES: {
  key: ActivitySeriesKey;
  label: string;
  color: string;
  /** Dash pattern so series differ by more than colour. */
  dash?: string;
}[] = [
  { key: "registrations", label: "New patients", color: "#1E40AF" },
  { key: "vitals", label: "Vitals", color: "#166534", dash: "6 3" },
  { key: "consultations", label: "Consultations", color: "#6B21A8", dash: "2 3" },
  { key: "dispenses", label: "Dispensing records", color: "#9A3412", dash: "10 3 2 3" },
];

/** Recessive grid and axis colours (line / ink-muted tokens). */
export const CHART_GRID = "#E2E5E0";
export const CHART_AXIS = "#636C66";
