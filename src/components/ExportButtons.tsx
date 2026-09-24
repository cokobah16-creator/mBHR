import React, { useState } from "react";
import type { Table } from "dexie";
import { db, createAuditLog, generateId } from "@/db";
import { exportTable } from "@/utils/export";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { InformationCircleIcon } from "@heroicons/react/20/solid";

interface ExportSpec {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Table<any, any>;
  /** Dexie table name, for the audit log. */
  entity: string;
  filename: string;
  label: string;
  type: "csv" | "json";
}

export function ExportButtons() {
  const { currentUser } = useAuthStore();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  // Only admins can export data
  if (!currentUser || !can(currentUser.role, "export")) return null;

  const exports: ExportSpec[] = [
    { table: db.patients, entity: "patients", filename: "patients.csv", label: "Patients", type: "csv" },
    { table: db.vitals, entity: "vitals", filename: "vitals.csv", label: "Vitals", type: "csv" },
    {
      table: db.consultations,
      entity: "consultations",
      filename: "consultations.csv",
      label: "Consultations",
      type: "csv",
    },
    {
      table: db.dispenses,
      entity: "dispenses",
      filename: "dispenses.csv",
      label: "Dispenses",
      type: "csv",
    },
    {
      table: db.inventory,
      entity: "inventory",
      filename: "inventory.csv",
      label: "Inventory",
      type: "csv",
    },
    {
      table: db.auditLogs,
      entity: "auditLogs",
      filename: "audit_logs.csv",
      label: "Audit Logs",
      type: "csv",
    },
  ];

  // Exported before this change as "Export All Data (JSON)" / all_data.json,
  // although it has only ever contained the patients table.
  const patientsJson: ExportSpec = {
    table: db.patients,
    entity: "patients",
    filename: "patients.json",
    label: "Patients (JSON)",
    type: "json",
  };

  const runExport = async (spec: ExportSpec) => {
    // Re-check at the moment of export, not only when the buttons render.
    const actor = useAuthStore.getState().currentUser;
    if (!actor || !can(actor.role, "export")) {
      push({
        id: generateId(),
        tone: "error",
        title: "Export not allowed",
        body: "Your role cannot export data from this device.",
      });
      return;
    }

    setBusy(spec.filename);
    try {
      const count = await spec.table.count();
      if (count === 0) {
        push({
          id: generateId(),
          tone: "info",
          title: `No ${spec.label.toLowerCase()} to export`,
          body: "There are no records of this kind on this device yet.",
        });
        return;
      }

      await exportTable(spec.table, spec.filename, spec.type);

      try {
        await createAuditLog(actor.role, `export_${spec.type}`, spec.entity, spec.filename);
      } catch (error) {
        console.error(
          "[export] audit log failed:",
          error instanceof Error ? error.name : error,
        );
      }

      push({
        id: generateId(),
        tone: "success",
        title: `${spec.filename} created`,
        body: `${count} record${count === 1 ? "" : "s"} from this device. Check your downloads folder.`,
      });
    } catch (error) {
      console.error(
        "[export] failed:",
        error instanceof Error ? error.name : error,
      );
      push({
        id: generateId(),
        tone: "error",
        title: "Export failed",
        body: `Could not create ${spec.filename}. Try again.`,
      });
    } finally {
      setBusy(null);
    }
  };

  const buttonLabel = (spec: ExportSpec) =>
    busy === spec.filename ? `Exporting ${spec.label}…` : spec.label;

  return (
    <section className="card" aria-labelledby="data-export-title">
      <h3 id="data-export-title" className="text-h3 text-ink">
        Data export
      </h3>
      <p className="mt-1 mb-4 flex items-start gap-1.5 text-caption text-ink-muted">
        <InformationCircleIcon className="h-4 w-4 shrink-0 mt-px" aria-hidden />
        Files contain the records stored on this device, including patient
        details. Keep them somewhere secure and delete them when done.
      </p>
      <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 md:grid-cols-3">
        {exports.map((spec) => (
          <button
            key={spec.filename}
            type="button"
            onClick={() => runExport(spec)}
            disabled={busy !== null}
            className="btn-secondary justify-start"
          >
            <ArrowDownTrayIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{buttonLabel(spec)}</span>
            <span className="ml-auto text-caption text-ink-muted">CSV</span>
          </button>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-line">
        <button
          type="button"
          onClick={() => runExport(patientsJson)}
          disabled={busy !== null}
          className="btn-secondary"
        >
          <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
          {buttonLabel(patientsJson)}
        </button>
      </div>
    </section>
  );
}
