/**
 * Format a date string in Nigerian locale format
 */
export function formatNigerianDate(
  date: string | Date | undefined | null,
): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
