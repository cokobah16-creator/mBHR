/**
 * Staff Patient Dashboard
 *
 * Protected route (/staff/patients) — accessible only to authenticated staff.
 * Lists all registered patients and lets staff:
 *   • View a patient's vitals, medications, and visits
 *   • Add vitals, medications, or visit notes for any patient
 *
 * Data is read/written directly from the shared Supabase tables so changes
 * are immediately visible to the patient in their own portal.
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  UsersIcon,
  HeartIcon,
  BeakerIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
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

// ─── Sub-forms ────────────────────────────────────────────────────────────────

function AddVitalForm({
  patientId,
  onSuccess,
}: {
  patientId: string;
  onSuccess: () => void;
}) {
  const [bp,    setBp]    = useState("");
  const [wt,    setWt]    = useState("");
  const [temp,  setTemp]  = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await addVital(patientId, {
      bloodPressure: bp   || null,
      weight:        wt   ? parseFloat(wt)   : null,
      temperature:   temp ? parseFloat(temp) : null,
    });
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setBp(""); setWt(""); setTemp("");
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
      <p className="text-sm font-medium text-gray-700">Add Vital Signs</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        <input value={bp} onChange={(e) => setBp(e.target.value)} placeholder="BP e.g. 120/80"
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500" />
        <input value={wt} onChange={(e) => setWt(e.target.value)} placeholder="Weight (kg)" type="number" step="0.1"
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500" />
        <input value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="Temp (°C)" type="number" step="0.1"
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500" />
      </div>
      <button type="submit" disabled={loading}
        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:bg-gray-400 transition-colors">
        {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlusIcon className="w-4 h-4" />}
        Save Vitals
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
  const [name, setName]   = useState("");
  const [dose, setDose]   = useState("");
  const [instr, setInstr] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) { setError("Medication name is required."); return; }
    setLoading(true);
    setError("");
    const result = await addMedication(patientId, {
      name, dosage: dose || null, instructions: instr || null,
    });
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setName(""); setDose(""); setInstr("");
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
      <p className="text-sm font-medium text-gray-700">Add Medication</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Medication name *"
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500" />
        <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Dosage e.g. 500mg"
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500" />
      </div>
      <input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Instructions e.g. Take twice daily with food"
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500" />
      <button type="submit" disabled={loading}
        className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:bg-gray-400 transition-colors">
        {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlusIcon className="w-4 h-4" />}
        Save Medication
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
  const [notes, setNotes]   = useState("");
  const [diag, setDiag]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await addVisit(patientId, {
      notes: notes || null, diagnosis: diag || null,
    });
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setNotes(""); setDiag("");
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
      <p className="text-sm font-medium text-gray-700">Add Visit Note</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input value={diag} onChange={(e) => setDiag(e.target.value)} placeholder="Diagnosis (optional)"
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-purple-500" />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
        placeholder="Clinical notes…"
        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-purple-500 resize-none" />
      <button type="submit" disabled={loading}
        className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:bg-gray-400 transition-colors">
        {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <PlusIcon className="w-4 h-4" />}
        Save Visit
      </button>
    </form>
  );
}

// ─── Patient detail panel ─────────────────────────────────────────────────────

type ActiveForm = "vitals" | "medication" | "visit" | null;

function PatientPanel({ patient }: { patient: PatientProfile }) {
  const [vitals,      setVitals]      = useState<Vital[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [visits,      setVisits]      = useState<Visit[]>([]);
  const [loaded,      setLoaded]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [activeForm,  setActiveForm]  = useState<ActiveForm>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [v, m, vis] = await Promise.all([
      getVitals(patient.id),
      getMedications(patient.id),
      getVisits(patient.id),
    ]);
    setVitals(v.data ?? []);
    setMedications(m.data ?? []);
    setVisits(vis.data ?? []);
    setLoaded(true);
    setLoading(false);
  }, [patient.id]);

  const handleFormSuccess = () => {
    setActiveForm(null);
    load();
  };

  if (!loaded) {
    return (
      <button onClick={load} disabled={loading}
        className="w-full text-sm text-blue-600 hover:text-blue-700 py-2 flex items-center justify-center gap-2">
        {loading
          ? <><span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /> Loading records…</>
          : "Load records"}
      </button>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {(["vitals", "medication", "visit"] as ActiveForm[]).map((f) => (
          <button key={f} onClick={() => setActiveForm(activeForm === f ? null : f)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors
              ${activeForm === f
                ? "bg-gray-800 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
            <PlusIcon className="w-4 h-4" />
            Add {f === "vitals" ? "Vitals" : f === "medication" ? "Medication" : "Visit"}
          </button>
        ))}
      </div>

      {activeForm === "vitals"     && <AddVitalForm     patientId={patient.id} onSuccess={handleFormSuccess} />}
      {activeForm === "medication" && <AddMedForm        patientId={patient.id} onSuccess={handleFormSuccess} />}
      {activeForm === "visit"      && <AddVisitForm      patientId={patient.id} onSuccess={handleFormSuccess} />}

      {/* Records */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Vitals */}
        <div className="bg-blue-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
            <HeartIcon className="w-4 h-4" /> Vitals ({vitals.length})
          </h4>
          {vitals.length > 0 ? (
            <ul className="space-y-2 text-xs text-gray-700">
              {vitals.slice(0, 3).map((v) => (
                <li key={v.id} className="bg-white rounded p-2">
                  {v.bloodPressure && <p>BP: {v.bloodPressure}</p>}
                  {v.weight        && <p>Wt: {v.weight} kg</p>}
                  {v.temperature   && <p>Temp: {v.temperature}°C</p>}
                  <p className="text-gray-400">{new Date(v.recordedAt).toLocaleDateString()}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-blue-600">No vitals recorded.</p>}
        </div>

        {/* Medications */}
        <div className="bg-green-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-1.5">
            <BeakerIcon className="w-4 h-4" /> Medications ({medications.length})
          </h4>
          {medications.length > 0 ? (
            <ul className="space-y-2 text-xs text-gray-700">
              {medications.slice(0, 3).map((m) => (
                <li key={m.id} className="bg-white rounded p-2">
                  <p className="font-medium">{m.name}</p>
                  {m.dosage       && <p>{m.dosage}</p>}
                  {m.instructions && <p className="text-gray-400">{m.instructions}</p>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-green-600">No medications recorded.</p>}
        </div>

        {/* Visits */}
        <div className="bg-purple-50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-purple-800 mb-2 flex items-center gap-1.5">
            <ClipboardDocumentListIcon className="w-4 h-4" /> Visits ({visits.length})
          </h4>
          {visits.length > 0 ? (
            <ul className="space-y-2 text-xs text-gray-700">
              {visits.slice(0, 3).map((v) => (
                <li key={v.id} className="bg-white rounded p-2">
                  <p className="font-medium">{new Date(v.visitDate).toLocaleDateString()}</p>
                  {v.diagnosis && <p>Dx: {v.diagnosis}</p>}
                  {v.notes     && <p className="text-gray-400 truncate">{v.notes}</p>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-purple-600">No visits recorded.</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Patient row ──────────────────────────────────────────────────────────────

function PatientRow({ patient }: { patient: PatientProfile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <span className="text-blue-700 font-bold text-sm">
              {patient.fullName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="font-semibold text-gray-900">{patient.fullName}</p>
            <p className="text-sm text-gray-500">{patient.email ?? "No email"}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {patient.dateOfBirth && (
            <span className="text-xs text-gray-400 hidden md:block">
              DOB: {patient.dateOfBirth}
            </span>
          )}
          {expanded
            ? <ChevronUpIcon className="w-5 h-5 text-gray-400" />
            : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <PatientPanel patient={patient} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function StaffPatientDashboard() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [search,   setSearch]   = useState("");
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
      return;
    }
    if (!isSupabaseEnabled) {
      setError("Supabase is not configured. Connect your project to view online patient records.");
      setLoading(false);
      return;
    }
    loadPatients();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPatients = async () => {
    setLoading(true);
    const result = await getAllPatients();
    if (result.error) {
      setError(result.error);
    } else {
      setPatients(result.data ?? []);
    }
    setLoading(false);
  };

  const filtered = patients.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.fullName.toLowerCase().includes(q) ||
      (p.email ?? "").toLowerCase().includes(q) ||
      (p.phone ?? "").includes(q)
    );
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="w-4 h-4" /> Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <UsersIcon className="w-7 h-7 text-blue-600" /> Patient Records
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {patients.length} registered patient{patients.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button onClick={loadPatients} disabled={loading}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors">
          Refresh
        </button>
      </div>

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, email, or phone…"
        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      {/* Content */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 flex items-start gap-3">
          <ExclamationTriangleIcon className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-800">Unable to load patient records</p>
            <p className="text-sm text-yellow-700 mt-1">{error}</p>
            {!isSupabaseEnabled && (
              <p className="text-xs text-yellow-600 mt-2">
                Add <code className="bg-yellow-100 px-1 rounded">VITE_SUPABASE_URL</code> and{" "}
                <code className="bg-yellow-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> to your{" "}
                <code className="bg-yellow-100 px-1 rounded">.env</code> file and restart.
              </p>
            )}
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          {search ? "No patients match your search." : "No patients registered yet."}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((p) => <PatientRow key={p.id} patient={p} />)}
        </div>
      )}
    </div>
  );
}

export default StaffPatientDashboard;
