/**
 * Staff Patient Dashboard
 *
 * Protected route (/staff/patients) — accessible only to authenticated staff.
 * Lists all registered patients and lets staff:
 *   • View a patient's vitals, medications, and visits
 *   • Add vitals, medications, or visit notes for any patient
 *
 * Data is read/written directly from the shared Supabase tables so changes
 * are immediately visible to the patient in their own portal. Nothing on this
 * page is stored on the device, so it needs a connection to read or save.
 */
import { useEffect, useState, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  UsersIcon,
  HeartIcon,
  BeakerIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  SignalSlashIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import {
  getAllPatients,
  getVitals,
  getMedications,
  getVisits,
  addVital,
  addMedication,
  addVisit,
} from "@/services/patientService";
import type { PatientProfile, Vital, Medication, Visit } from "@/services/patientService";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useAuthStore } from "@/stores/auth";
import { can, type Role } from "@/auth/roles";
import { useToast } from "@/stores/toast";
import { generateId } from "@/db";
import { formatNigerianDate } from "@/utils/dateFormat";
import { patientMatchesQuery } from "@/utils/patientSearch";
import { classifyBloodPressure, classifyTemperature } from "@/utils/vitals";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PatientListSkeleton } from "@/components/ui/Skeleton";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OFFLINE_WRITE_MESSAGE =
  "You are offline. Nothing was saved — this form writes straight to the online record. Try again when connected.";
const REMOTE_WRITE_FAILED =
  "Not saved. The online record could not be updated. Check the connection and try again.";

function canRecordMedication(role: Role | undefined): boolean {
  return !!role && (can(role, "consult") || can(role, "dispense"));
}

/** Tracks navigator.onLine so the page can say plainly when it cannot work. */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function FormError({ id, message }: { id: string; message: string }) {
  if (!message) return null;
  return (
    <div id={id} className="banner banner-danger" role="alert">
      <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

/** Empty section text that never claims "none recorded" when the load failed. */
function SectionEmpty({ failed, what }: { failed: boolean; what: string }) {
  return failed ? (
    <p className="flex items-center gap-1.5 px-3 py-2 text-caption text-warning-fg">
      <ExclamationTriangleIcon className="h-4 w-4 shrink-0" aria-hidden />
      Could not load {what}.
    </p>
  ) : (
    <p className="px-3 py-2 text-caption text-ink-muted">No {what} recorded.</p>
  );
}

// ─── Sub-forms ────────────────────────────────────────────────────────────────

function AddVitalForm({
  patientId,
  onSuccess,
}: {
  patientId: string;
  onSuccess: () => void;
}) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const { push: pushToast } = useToast();
  const [bp,    setBp]    = useState("");
  const [wt,    setWt]    = useState("");
  const [temp,  setTemp]  = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!role || !can(role, "vitals")) {
      setError("Your role cannot record vital signs.");
      return;
    }
    if (!navigator.onLine) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      // Parse "120/80" format into systolic/diastolic
      const [sysStr, diaStr] = (bp || "").split("/");
      const result = await addVital(patientId, {
        bloodPressureSystolic:  sysStr ? parseInt(sysStr, 10) : null,
        bloodPressureDiastolic: diaStr ? parseInt(diaStr, 10) : null,
        weightKg:    wt   ? parseFloat(wt)   : null,
        tempC:       temp ? parseFloat(temp) : null,
      });
      if (result.error) {
        setError(REMOTE_WRITE_FAILED);
      } else {
        setBp(""); setWt(""); setTemp("");
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Vital signs saved",
          body: "Saved to the online record.",
        });
        onSuccess();
      }
    } catch (err) {
      console.error("Add vital failed:", err instanceof Error ? err.name : err);
      setError(REMOTE_WRITE_FAILED);
    } finally {
      setLoading(false);
    }
  };

  const errorId = `vital-error-${patientId}`;
  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-line bg-surface-sunken p-4" noValidate>
      <h3 className="text-h3 text-ink">Add vital signs</h3>
      <FormError id={errorId} message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`bp-${patientId}`} className="field-label">Blood pressure (mmHg)</label>
          <input id={`bp-${patientId}`} value={bp} onChange={(e) => setBp(e.target.value)} placeholder="e.g. 120/80"
            inputMode="numeric" className="input-field" />
        </div>
        <div>
          <label htmlFor={`wt-${patientId}`} className="field-label">Weight (kg)</label>
          <input id={`wt-${patientId}`} value={wt} onChange={(e) => setWt(e.target.value)} type="number" step="0.1"
            inputMode="decimal" className="input-field" />
        </div>
        <div>
          <label htmlFor={`temp-${patientId}`} className="field-label">Temperature (°C)</label>
          <input id={`temp-${patientId}`} value={temp} onChange={(e) => setTemp(e.target.value)} type="number" step="0.1"
            inputMode="decimal" className="input-field" />
        </div>
      </div>
      <button type="submit" disabled={loading} className="btn-primary">
        <PlusIcon className="h-4 w-4" aria-hidden />
        {loading ? "Saving…" : "Save vital signs"}
      </button>
    </form>
  );
}

function AddMedForm({
  patientId,
  onSuccess,
}: {
  patientId: string;
  onSuccess: () => void;
}) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const { push: pushToast } = useToast();
  const [name, setName]   = useState("");
  const [dose, setDose]   = useState("");
  const [instr, setInstr] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!canRecordMedication(role)) {
      setError("Only clinicians and pharmacy staff can record medicines.");
      return;
    }
    if (!name) { setError("Enter the medicine name."); return; }
    if (!navigator.onLine) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      const result = await addMedication(patientId, {
        name, dosage: dose || null, instructions: instr || null,
      } as { name: string; dosage?: string | null; instructions?: string | null });
      if (result.error) {
        setError(REMOTE_WRITE_FAILED);
      } else {
        setName(""); setDose(""); setInstr("");
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Medicine recorded",
          body: `${name} saved to the online record.`,
        });
        onSuccess();
      }
    } catch (err) {
      console.error("Add medication failed:", err instanceof Error ? err.name : err);
      setError(REMOTE_WRITE_FAILED);
    } finally {
      setLoading(false);
    }
  };

  const errorId = `med-error-${patientId}`;
  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-line bg-surface-sunken p-4" noValidate>
      <h3 className="text-h3 text-ink">Add medicine</h3>
      <FormError id={errorId} message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`med-name-${patientId}`} className="field-label">Medicine name *</label>
          <input id={`med-name-${patientId}`} value={name} onChange={(e) => setName(e.target.value)}
            className="input-field" aria-required="true" />
        </div>
        <div>
          <label htmlFor={`med-dose-${patientId}`} className="field-label">Dose</label>
          <input id={`med-dose-${patientId}`} value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 500 mg"
            className="input-field" />
        </div>
      </div>
      <div>
        <label htmlFor={`med-instr-${patientId}`} className="field-label">Instructions</label>
        <input id={`med-instr-${patientId}`} value={instr} onChange={(e) => setInstr(e.target.value)}
          placeholder="e.g. Take twice daily with food" className="input-field" />
      </div>
      <button type="submit" disabled={loading} className="btn-primary">
        <PlusIcon className="h-4 w-4" aria-hidden />
        {loading ? "Saving…" : "Save medicine"}
      </button>
    </form>
  );
}

function AddVisitForm({
  patientId,
  onSuccess,
}: {
  patientId: string;
  onSuccess: () => void;
}) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const { push: pushToast } = useToast();
  const [notes, setNotes]   = useState("");
  const [diag, setDiag]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!role || !can(role, "consult")) {
      setError("Only clinicians can add visit notes and diagnoses.");
      return;
    }
    if (!navigator.onLine) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      const result = await addVisit(patientId, {
        notes: notes || null, diagnosis: diag || null,
      });
      if (result.error) {
        setError(REMOTE_WRITE_FAILED);
      } else {
        setNotes(""); setDiag("");
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Visit note saved",
          body: "Saved to the online record.",
        });
        onSuccess();
      }
    } catch (err) {
      console.error("Add visit failed:", err instanceof Error ? err.name : err);
      setError(REMOTE_WRITE_FAILED);
    } finally {
      setLoading(false);
    }
  };

  const errorId = `visit-error-${patientId}`;
  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-line bg-surface-sunken p-4" noValidate>
      <h3 className="text-h3 text-ink">Add visit note</h3>
      <FormError id={errorId} message={error} />
      <div>
        <label htmlFor={`visit-dx-${patientId}`} className="field-label">Diagnosis (optional)</label>
        <input id={`visit-dx-${patientId}`} value={diag} onChange={(e) => setDiag(e.target.value)}
          className="input-field" />
      </div>
      <div>
        <label htmlFor={`visit-notes-${patientId}`} className="field-label">Clinical notes</label>
        <textarea id={`visit-notes-${patientId}`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="input-field resize-none" />
      </div>
      <button type="submit" disabled={loading} className="btn-primary">
        <PlusIcon className="h-4 w-4" aria-hidden />
        {loading ? "Saving…" : "Save visit note"}
      </button>
    </form>
  );
}

// ─── Patient detail panel ─────────────────────────────────────────────────────

type ActiveForm = "vitals" | "medication" | "visit" | null;

const FORM_LABELS: Record<Exclude<ActiveForm, null>, string> = {
  vitals: "Add vital signs",
  medication: "Add medicine",
  visit: "Add visit note",
};

function PatientPanel({ patient, online }: { patient: PatientProfile; online: boolean }) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const [vitals,      setVitals]      = useState<Vital[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [visits,      setVisits]      = useState<Visit[]>([]);
  const [loaded,      setLoaded]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [loadError,   setLoadError]   = useState("");
  const [failed,      setFailed]      = useState({ vitals: false, medications: false, visits: false });
  const [activeForm,  setActiveForm]  = useState<ActiveForm>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [v, m, vis] = await Promise.all([
        getVitals(patient.id),
        getMedications(patient.id),
        getVisits(patient.id),
      ]);
      setVitals(v.data ?? []);
      setMedications(m.data ?? []);
      setVisits(vis.data ?? []);
      setFailed({ vitals: !!v.error, medications: !!m.error, visits: !!vis.error });
      if (v.error || m.error || vis.error) {
        setLoadError(
          "Some records could not be loaded from the online record. What is shown may be incomplete — refresh to try again.",
        );
      }
      setLoaded(true);
    } catch (err) {
      console.error("Load patient records failed:", err instanceof Error ? err.name : err);
      setLoadError("Records could not be loaded. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [patient.id]);

  const handleFormSuccess = () => {
    setActiveForm(null);
    load();
  };

  const allowed: Record<Exclude<ActiveForm, null>, boolean> = {
    vitals: !!role && can(role, "vitals"),
    medication: canRecordMedication(role),
    visit: !!role && can(role, "consult"),
  };
  const formKeys = (["vitals", "medication", "visit"] as const).filter((f) => allowed[f]);

  if (!loaded) {
    return (
      <div className="space-y-2">
        {loadError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{loadError}</span>
          </div>
        )}
        <button type="button" onClick={load} disabled={loading || !online} className="btn-secondary w-full">
          {loading ? (
            <>
              <ArrowPathIcon className="h-4 w-4 animate-spin" aria-hidden /> Loading records…
            </>
          ) : online ? (
            "Load records"
          ) : (
            "Records need a connection"
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>{loadError}</span>
        </div>
      )}

      {/* Action buttons */}
      {formKeys.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Add to this record">
          {formKeys.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActiveForm(activeForm === f ? null : f)}
              aria-pressed={activeForm === f}
              className={`inline-flex min-h-touch-target items-center gap-1.5 rounded-md border px-3 py-1.5 text-label transition-colors ${
                activeForm === f
                  ? "border-primary bg-primary-soft text-primary-fg"
                  : "border-line bg-surface text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              <PlusIcon className="h-4 w-4" aria-hidden />
              {FORM_LABELS[f]}
            </button>
          ))}
        </div>
      )}

      {activeForm === "vitals"     && allowed.vitals     && <AddVitalForm patientId={patient.id} onSuccess={handleFormSuccess} />}
      {activeForm === "medication" && allowed.medication && <AddMedForm   patientId={patient.id} onSuccess={handleFormSuccess} />}
      {activeForm === "visit"      && allowed.visit      && <AddVisitForm patientId={patient.id} onSuccess={handleFormSuccess} />}

      {/* Records */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Vitals */}
        <section className="rounded-md border border-line" aria-labelledby={`vitals-h-${patient.id}`}>
          <h3 id={`vitals-h-${patient.id}`} className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-label text-ink">
            <span className="h-2 w-2 rounded-full bg-stage-vitals" aria-hidden />
            <HeartIcon className="h-4 w-4 text-ink-muted" aria-hidden /> Vital signs ({vitals.length})
          </h3>
          {vitals.length > 0 ? (
            <ul className="divide-y divide-line text-body text-ink-secondary">
              {vitals.slice(0, 3).map((v) => {
                const bpClass = classifyBloodPressure(v.systolic, v.diastolic);
                const tempClass = classifyTemperature(v.tempC);
                return (
                  <li key={v.id} className="space-y-1 px-3 py-2">
                    {v.systolic != null && v.diastolic != null && (
                      <p className="flex flex-wrap items-center gap-1.5">
                        BP {v.systolic}/{v.diastolic} mmHg
                        {bpClass && bpClass.tone !== "success" && (
                          <StatusBadge tone={bpClass.tone}>{bpClass.label}</StatusBadge>
                        )}
                      </p>
                    )}
                    {v.weightKg  != null && <p>Weight {v.weightKg} kg</p>}
                    {v.tempC     != null && (
                      <p className="flex flex-wrap items-center gap-1.5">
                        Temp {v.tempC} °C
                        {tempClass && tempClass.tone !== "success" && (
                          <StatusBadge tone={tempClass.tone}>{tempClass.label}</StatusBadge>
                        )}
                      </p>
                    )}
                    <p className="text-caption text-ink-muted">{formatNigerianDate(v.takenAt)}</p>
                  </li>
                );
              })}
            </ul>
          ) : <SectionEmpty failed={failed.vitals} what="vital signs" />}
        </section>

        {/* Medications */}
        <section className="rounded-md border border-line" aria-labelledby={`meds-h-${patient.id}`}>
          <h3 id={`meds-h-${patient.id}`} className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-label text-ink">
            <span className="h-2 w-2 rounded-full bg-stage-pharmacy" aria-hidden />
            <BeakerIcon className="h-4 w-4 text-ink-muted" aria-hidden /> Medicines ({medications.length})
          </h3>
          {medications.length > 0 ? (
            <ul className="divide-y divide-line text-body text-ink-secondary">
              {medications.slice(0, 3).map((m) => (
                <li key={m.id} className="px-3 py-2">
                  <p className="font-medium text-ink">{m.itemName}</p>
                  {m.dosage     && <p>{m.dosage}</p>}
                  {m.directions && <p className="text-caption text-ink-muted">{m.directions}</p>}
                </li>
              ))}
            </ul>
          ) : <SectionEmpty failed={failed.medications} what="medicines" />}
        </section>

        {/* Visits */}
        <section className="rounded-md border border-line" aria-labelledby={`visits-h-${patient.id}`}>
          <h3 id={`visits-h-${patient.id}`} className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-label text-ink">
            <span className="h-2 w-2 rounded-full bg-stage-consult" aria-hidden />
            <ClipboardDocumentListIcon className="h-4 w-4 text-ink-muted" aria-hidden /> Visits ({visits.length})
          </h3>
          {visits.length > 0 ? (
            <ul className="divide-y divide-line text-body text-ink-secondary">
              {visits.slice(0, 3).map((v) => (
                <li key={v.id} className="px-3 py-2">
                  <p className="font-medium text-ink">{formatNigerianDate(v.startedAt)}</p>
                  {v.diagnosis && <p>Diagnosis: {v.diagnosis}</p>}
                  {v.notes     && <p className="truncate text-caption text-ink-muted">{v.notes}</p>}
                </li>
              ))}
            </ul>
          ) : <SectionEmpty failed={failed.visits} what="visits" />}
        </section>
      </div>
    </div>
  );
}

// ─── Patient row ──────────────────────────────────────────────────────────────

function PatientRow({ patient, online }: { patient: PatientProfile; online: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `staff-patient-${patient.id}`;

  return (
    <li className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex min-h-touch-target w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-surface-hover"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunken" aria-hidden>
            <span className="text-label text-ink-secondary">
              {patient.givenName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{patient.givenName} {patient.familyName}</p>
            <p className="truncate text-caption text-ink-muted">{patient.email ?? "No email"}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {patient.dob && (
            <span className="hidden text-caption text-ink-muted md:block">
              Born {formatNigerianDate(patient.dob)}
            </span>
          )}
          {expanded
            ? <ChevronUpIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            : <ChevronDownIcon className="h-5 w-5 text-ink-muted" aria-hidden />}
          <span className="sr-only">{expanded ? "Hide records" : "Show records"}</span>
        </div>
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-line p-4">
          <PatientPanel patient={patient} online={online} />
        </div>
      )}
    </li>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function StaffPatientDashboard() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const online = useOnlineStatus();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [search,   setSearch]   = useState("");
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  const loadPatients = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getAllPatients();
      if (result.error) {
        setError(
          navigator.onLine
            ? "The online patient list could not be loaded. Try Refresh in a moment."
            : "You are offline. Online patient records need a connection.",
        );
      } else {
        setPatients(result.data ?? []);
      }
    } catch (err) {
      console.error("Load patients failed:", err instanceof Error ? err.name : err);
      setError("The online patient list could not be loaded. Check the connection and try Refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
      return;
    }
    if (!isSupabaseEnabled) {
      setError("Online records are not set up on this installation.");
      setLoading(false);
      return;
    }
    loadPatients();
  }, [isAuthenticated, navigate, loadPatients]);

  const filtered = patients.filter((p) => {
    const q = search.trim().toLowerCase();
    return (
      patientMatchesQuery(p, search) ||
      (q !== "" && (p.email ?? "").toLowerCase().includes(q))
    );
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        breadcrumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: "Online patient records" }]}
        title="Online patient records"
        description={
          loading || error
            ? "Reads and writes the shared online record directly. Changes appear in the patient portal once saved; nothing here is stored on this device."
            : `${patients.length} patient${patients.length !== 1 ? "s" : ""} in the online record. Changes save straight to it and appear in the patient portal; nothing here is stored on this device.`
        }
        actions={
          isSupabaseEnabled && (
            <button type="button" onClick={loadPatients} disabled={loading || !online} className="btn-secondary">
              <ArrowPathIcon className="h-4 w-4" aria-hidden />
              Refresh
            </button>
          )
        }
      />

      {!online && isSupabaseEnabled && (
        <div className="banner banner-warning" role="status">
          <SignalSlashIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            You are offline. This page works only with a connection — records cannot be loaded or
            saved until it is back. Patients registered on this device are still under Patients.
          </span>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <label htmlFor="staff-patient-search" className="sr-only">
          Search online patient records
        </label>
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <input
          id="staff-patient-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or phone"
          className="input-field pl-9"
        />
      </div>

      {/* Content */}
      {loading && <PatientListSkeleton />}

      {!loading && error && (
        <div className="banner banner-warning" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Online patient records are not available</p>
            <p className="mt-1">{error}</p>
            {!isSupabaseEnabled && (
              <p className="mt-2 text-caption">
                An administrator needs to add{" "}
                <code className="rounded bg-surface px-1">VITE_SUPABASE_URL</code> and{" "}
                <code className="rounded bg-surface px-1">VITE_SUPABASE_ANON_KEY</code> to the{" "}
                <code className="rounded bg-surface px-1">.env</code> file and restart the app.
              </p>
            )}
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={UsersIcon}
            title={search ? "No patients match your search" : "No patients in the online record yet"}
            description={
              search
                ? "Check the spelling, or search by phone number."
                : "Patients appear here once their records are in the online database."
            }
          />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="space-y-3" aria-label="Patients">
          {filtered.map((p) => <PatientRow key={p.id} patient={p} online={online} />)}
        </ul>
      )}
    </div>
  );
}

export default StaffPatientDashboard;
