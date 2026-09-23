// Saves report rows as a CSV file on this device. Nothing is uploaded.
import { toCsv, type CsvCell } from "./reportUtils";

/**
 * Builds the CSV and asks the browser to download it. Throws if the file
 * could not be created, so callers can tell staff the export failed. The
 * browser decides where the file goes, so success means "download started".
 */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  // A byte-order mark lets spreadsheet apps read naira signs and accents.
  const blob = new Blob(["﻿" + toCsv(headers, rows)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoking straight away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
