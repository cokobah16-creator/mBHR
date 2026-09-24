import { useCallback } from "react";
import { generateId } from "@/db";
import { useToast } from "@/stores/toast";
import { downloadCsv } from "./downloadCsv";
import type { CsvCell } from "./reportUtils";

/**
 * CSV export with honest feedback: says how many rows went into the file,
 * that it stays on this device, or that nothing was exported and why.
 * Returns true when the download was started.
 */
export function useCsvExport() {
  const push = useToast((s) => s.push);

  return useCallback(
    (what: string, filename: string, headers: string[], rows: CsvCell[][]): boolean => {
      if (rows.length === 0) {
        push({
          id: generateId(),
          tone: "info",
          title: `No ${what} to export`,
          body: "There are no rows for the current selection, so no file was created.",
        });
        return false;
      }
      try {
        downloadCsv(filename, headers, rows);
        push({
          id: generateId(),
          tone: "success",
          title: `Download started: ${filename}`,
          body: `${rows.length} ${rows.length === 1 ? "row" : "rows"} of ${what}. Your browser saves it on this device (usually in Downloads); nothing is uploaded.`,
        });
        return true;
      } catch (error) {
        console.error("CSV export failed:", error instanceof Error ? error.name : error);
        push({
          id: generateId(),
          tone: "error",
          title: `Could not create the ${what} file`,
          body: "Try again. If it keeps failing, check that this browser allows downloads.",
        });
        return false;
      }
    },
    [push],
  );
}
