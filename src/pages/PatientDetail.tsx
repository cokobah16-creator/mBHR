import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { db, Patient, Visit, Vital, Consultation, Dispense } from "@/db";
import { getFlagTone, getFlagLabel, resolveBmi } from "@/utils/vitals";
import { formatNigerianDate } from "@/utils/dateFormat";
import { AllergyManager } from "@/components/AllergyManager";
import { PreferenceManager } from "@/components/PreferenceManager";
import { PortalStatusCard } from "@/components/PortalStatusCard";
import { PatientTimeline } from "@/components/PatientTimeline";
import { useAuthStore } from "@/stores/auth";
import { patientSchema, PatientFormData } from "@/validation/schemas";
import { NIGERIAN_STATES, LGAS_BY_STATE } from "@/utils/nigeria";
import { normalizePhone } from "@/utils/phone";
import { useToast } from "@/stores/toast";
import { supabase } from "@/lib/supabase";
import { getPatientStatus, PatientStatus } from "@/services/patientStatus";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PatientDetailSkeleton } from "@/components/ui/Skeleton";
import { PatientContextHeader } from "@/components/patient/PatientContextHeader";
import {
  derivePatientFlow,
  currentFlowStage,
  FLOW_STAGE_LABELS,
  type FlowStage,
} from "@/services/patientFlow";
import { can, type Permission } from "@/auth/roles";
import { formatPatientId } from "@/utils/patient";
import {
  UserIcon,
  PhoneIcon,
  MapPinIcon,
  CalendarIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  PlayIcon,
  PencilIcon,
  XMarkIcon,
  CheckIcon,
  EnvelopeIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { getActiveSiteName } from "@/services/activeSite";
import { queueManagement } from "@/services/queueManagement";

const STAGE_PERMISSION: Record<FlowStage, Permission> = {
  registration: "vitals",
  vitals: "vitals",
  consult: "consult",
  pharmacy: "dispense",
};

const STAGE_ROUTE: Record<FlowStage, string> = {
  registration: "/vitals",
  vitals: "/vitals",
  consult: "/consult",
  pharmacy: "/pharmacy",
};

export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.currentUser);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [dispenses, setDispenses] = useState<Dispense[]>([]);
  const [status, setStatus] = useState<PatientStatus | null>(null);
  const [historyView, setHistoryView] = useState<"timeline" | "raw">(
    "timeline",
  );
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { push: pushToast } = useToast();

  const canEdit = user && ["admin", "doctor", "nurse"].includes(user.role);
  const canDelete = user?.role === "admin";

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
  });

  const watchedState = watch("state");
  const availableLGAs = LGAS_BY_STATE[watchedState] || [];

  useEffect(() => {
    if (id) {
      loadPatientData(id);
    }
  }, [id]);

  useEffect(() => {
    if (patient) {
      reset({
        givenName: patient.givenName,
        familyName: patient.familyName,
        sex: patient.sex,
        dob: patient.dob,
        phone: patient.phone || "",
        email: patient.email || "",
        address: patient.address,
        state: patient.state,
        lga: patient.lga,
        familyId: patient.familyId,
      });
    }
  }, [patient, reset]);

  const loadPatientData = async (patientId: string) => {
    try {
      const [
        patientData,
        visitsData,
        vitalsData,
        consultationsData,
        dispensesData,
      ] = await Promise.all([
        db.patients.get(patientId),
        db.visits.where("patientId").equals(patientId).reverse().toArray(),
        db.vitals.where("patientId").equals(patientId).reverse().toArray(),
        db.consultations
          .where("patientId")
          .equals(patientId)
          .reverse()
          .toArray(),
        db.dispenses.where("patientId").equals(patientId).reverse().toArray(),
      ]);

      setPatient(patientData || null);
      setVisits(
        [...visitsData].sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        ),
      );
      setVitals(vitalsData);
      setConsultations(consultationsData);
      setDispenses(dispensesData);

      try {
        const next = await getPatientStatus(patientId);
        setStatus(next);
      } catch (statusErr) {
        console.warn(
          "Could not derive patient status:",
          statusErr instanceof Error ? statusErr.name : statusErr,
        );
        setStatus(null);
      }
    } catch (error) {
      console.error(
        "Error loading patient data:",
        error instanceof Error ? error.name : error,
      );
    } finally {
      setLoading(false);
    }
  };

  const getPatientAge = (dob: string) => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  };

  const startNewVisit = async () => {
    if (!patient) return;

    try {
      const visit = {
        id: crypto.randomUUID(),
        patientId: patient.id,
        startedAt: new Date(),
        siteName: await getActiveSiteName(),
        status: "open" as const,
        _dirty: 1,
      };

      await db.visits.add(visit);

      // A newly registered patient still sits in the registration queue.
      // Finish that stage first, or saving vitals would only advance them
      // to vitals and leave them a stage behind. The visit is already saved,
      // so a queue error must not stop staff reaching vitals.
      try {
        const current = await db.queue
          .where("patientId")
          .equals(patient.id)
          .and((i) => i.status !== "done")
          .first();
        if (current?.stage === "registration") {
          await queueManagement.moveToNextStage(patient.id);
        }
      } catch (error) {
        console.warn(
          "Failed to complete registration queue stage:",
          error instanceof Error ? error.name : error,
        );
      }

      navigate(`/vitals/${visit.id}`);
    } catch (error) {
      console.error(
        "Error starting visit:",
        error instanceof Error ? error.name : error,
      );
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (patient) {
      reset({
        givenName: patient.givenName,
        familyName: patient.familyName,
        sex: patient.sex,
        dob: patient.dob,
        phone: patient.phone || "",
        email: patient.email || "",
        address: patient.address,
        state: patient.state,
        lga: patient.lga,
        familyId: patient.familyId,
      });
    }
  };

  const handleDelete = async () => {
    if (!patient) return;
    setDeleting(true);
    try {
      const pid = patient.id;
      await Promise.all([
        db.patients.delete(pid),
        db.visits.where("patientId").equals(pid).delete(),
        db.vitals.where("patientId").equals(pid).delete(),
        db.consultations.where("patientId").equals(pid).delete(),
        db.dispenses.where("patientId").equals(pid).delete(),
      ]);

      let cloudFailed = false;
      if (supabase) {
        const results = await Promise.allSettled([
          supabase.from("dispenses").delete().eq("patient_id", pid),
          supabase.from("vitals").delete().eq("patient_id", pid),
          supabase.from("consultations").delete().eq("patient_id", pid),
          supabase.from("visits").delete().eq("patient_id", pid),
          supabase.from("patients").delete().eq("id", pid),
        ]);
        cloudFailed = results.some(
          (r) => r.status === "rejected" || Boolean(r.value?.error),
        );
      }

      await db.auditLogs
        .add({
          id: crypto.randomUUID(),
          actorRole: user?.role ?? "unknown",
          action: cloudFailed ? "delete_patient_local_only" : "delete_patient",
          entity: "patient",
          entityId: pid,
          at: new Date(),
        })
        .catch(() => undefined);

      pushToast({
        id: crypto.randomUUID(),
        tone: cloudFailed ? "warning" : "success",
        title: cloudFailed
          ? "Deleted on this device only"
          : "Patient record deleted",
        body: cloudFailed
          ? `${patient.givenName} ${patient.familyName} was removed from this device, but the cloud copy could not be deleted. Check the connection and ask an administrator to remove it.`
          : `${patient.givenName} ${patient.familyName} has been removed from this device and the cloud. Other devices keep their copy until it is removed there.`,
      });
      navigate("/patients");
    } catch (error) {
      console.error(
        "Error deleting patient:",
        error instanceof Error ? error.name : error,
      );
      pushToast({
        id: crypto.randomUUID(),
        title: "Error",
        body: "Failed to delete patient. Please try again.",
      });
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const onSubmit = async (data: PatientFormData) => {
    if (!patient || !user) return;

    setSaving(true);
    try {
      const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;
      const updatedPatient: Partial<Patient> = {
        givenName: data.givenName,
        familyName: data.familyName,
        sex: data.sex,
        dob: data.dob,
        phone: normalizedPhone,
        email: data.email || null,
        address: data.address,
        state: data.state,
        lga: data.lga,
        familyId: data.familyId,
        updatedAt: new Date(),
        _dirty: 1,
      };

      await db.patients.update(patient.id, updatedPatient);

      const refreshedPatient = await db.patients.get(patient.id);
      setPatient(refreshedPatient || null);

      setIsEditing(false);
      pushToast({
        id: crypto.randomUUID(),
        title: "Success",
        body: "Patient details updated successfully",
      });
    } catch (error) {
      console.error(
        "Error updating patient:",
        error instanceof Error ? error.name : error,
      );
      pushToast({
        id: crypto.randomUUID(),
        title: "Error",
        body: "Failed to update patient details",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <PatientDetailSkeleton />;
  }

  if (!patient) {
    return (
      <div className="panel">
        <EmptyState
          icon={UserIcon}
          title="Patient not found on this device"
          description="The record may have been merged, deleted, or not synced to this device yet."
          action={
            <Link to="/patients" className="btn-primary">
              Back to patients
            </Link>
          }
        />
      </div>
    );
  }

  if (patient.mergeInto) {
    // Its allergies and history now live on the kept record; new care must
    // be recorded there, so this record offers no actions.
    return (
      <div className="panel">
        <EmptyState
          icon={UserIcon}
          title={`${patient.givenName} ${patient.familyName}: merged record`}
          description="This record was merged into another record for the same patient. Allergies, history and new care are on the kept record."
          action={
            <Link to={`/patients/${patient.mergeInto}`} className="btn-primary">
              Open the kept record
            </Link>
          }
        />
      </div>
    );
  }

  const fullName = `${patient.givenName} ${patient.familyName}`;
  // Only today's open visit with a stage still to do can be continued;
  // anything older is finished care and must not receive new records.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todaysOpenVisit = [...visits]
    .filter((v) => v.status === "open" && new Date(v.startedAt) >= startOfToday)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  const todaysStage = todaysOpenVisit
    ? currentFlowStage(
        derivePatientFlow({ visit: todaysOpenVisit, vitals, consultations, dispenses }),
      )
    : null;
  const openVisit = todaysStage ? todaysOpenVisit : undefined;
  const role = user?.role;
  const canContinue =
    !!openVisit && !!todaysStage && !!role && can(role, STAGE_PERMISSION[todaysStage]);
  const continuePath =
    openVisit && todaysStage ? `${STAGE_ROUTE[todaysStage]}/${openVisit.id}` : null;
  const canStartVisit = !!role && can(role, "vitals");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Patients", to: "/patients" },
          { label: isEditing ? `${fullName} · Edit` : fullName },
        ]}
        title={isEditing ? "Edit patient details" : fullName}
        actions={
          !isEditing && (
            <>
              {canDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="btn-ghost text-danger-fg hover:bg-danger-soft hover:text-danger-fg"
                >
                  <TrashIcon className="h-5 w-5" aria-hidden />
                  Delete
                </button>
              )}
              {canEdit && (
                <button onClick={handleEdit} className="btn-secondary">
                  <PencilIcon className="h-5 w-5" aria-hidden />
                  Edit details
                </button>
              )}
              {openVisit ? (
                canContinue ? (
                  <button
                    onClick={() => continuePath && navigate(continuePath)}
                    className="btn-primary"
                  >
                    <PlayIcon className="h-5 w-5" aria-hidden />
                    Continue visit
                  </button>
                ) : (
                  <Link to="/queue" className="btn-secondary">
                    In the queue for {todaysStage ? FLOW_STAGE_LABELS[todaysStage] : "care"}
                  </Link>
                )
              ) : (
                canStartVisit && (
                  <button onClick={startNewVisit} className="btn-primary">
                    <PlayIcon className="h-5 w-5" aria-hidden />
                    Start visit
                  </button>
                )
              )}
            </>
          )
        }
      />

      {!isEditing && (
        <PatientContextHeader
          patientId={patient.id}
          visitId={openVisit?.id}
          patient={patient}
          showFlow={Boolean(openVisit)}
          actions={
            status && (
              <span
                className={`badge ${status.classes}`}
                title={status.detail}
              >
                {status.label}
              </span>
            )
          }
        />
      )}

      {/* Patient details / edit form */}
      <div className="card">
        {isEditing ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pd-givenName" className="field-label">
                  Given Name *
                </label>
                <input id="pd-givenName"
                  {...register("givenName")}
                  className="input-field"
                  placeholder="Enter given name"
                />
                {errors.givenName && (
                  <p className="field-error" role="alert">
                    {errors.givenName.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="pd-familyName" className="field-label">
                  Family Name *
                </label>
                <input id="pd-familyName"
                  {...register("familyName")}
                  className="input-field"
                  placeholder="Enter family name"
                />
                {errors.familyName && (
                  <p className="field-error" role="alert">
                    {errors.familyName.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pd-sex" className="field-label">
                  Sex *
                </label>
                <select id="pd-sex"
                  {...register("sex")} className="input-field">
                  <option value="">Select sex</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                {errors.sex && (
                  <p className="field-error" role="alert">
                    {errors.sex.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="pd-dob" className="field-label">
                  Date of Birth *
                </label>
                <input id="pd-dob"
                  {...register("dob")}
                  type="date"
                  className="input-field"
                  max={new Date().toISOString().split("T")[0]}
                />
                {errors.dob && (
                  <p className="field-error" role="alert">
                    {errors.dob.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pd-phone" className="field-label">
                  Phone (at least one contact required)
                </label>
                <input id="pd-phone"
                  {...register("phone")}
                  type="tel"
                  className="input-field"
                  placeholder="08012345678 or +2348012345678"
                />
                {errors.phone && (
                  <p className="field-error" role="alert">
                    {errors.phone.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="pd-email" className="field-label">
                  Email (at least one contact required)
                </label>
                <input id="pd-email"
                  {...register("email")}
                  type="email"
                  className="input-field"
                  placeholder="patient@example.com"
                />
                {errors.email && (
                  <p className="field-error" role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="pd-address" className="field-label">
                Address *
              </label>
              <textarea
                id="pd-address"
                {...register("address")}
                className="input-field"
                rows={3}
                placeholder="Enter full address"
              />
              {errors.address && (
                <p className="field-error" role="alert">
                  {errors.address.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pd-state" className="field-label">
                  State *
                </label>
                <select
                  id="pd-state"
                  {...register("state", {
                    onChange: () => {
                      setValue("lga", "");
                    },
                  })}
                  className="input-field"
                >
                  <option value="">Select state</option>
                  {NIGERIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
                {errors.state && (
                  <p className="field-error" role="alert">
                    {errors.state.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="pd-lga" className="field-label">
                  LGA *
                </label>
                <select id="pd-lga"
                  {...register("lga")}
                  className={`input-field ${!watchedState ? "bg-surface-sunken cursor-not-allowed" : ""}`}
                  disabled={!watchedState || availableLGAs.length === 0}
                >
                  <option value="">
                    {!watchedState
                      ? "Select state first"
                      : availableLGAs.length === 0
                        ? "No LGAs available"
                        : "Select LGA"}
                  </option>
                  {availableLGAs.map((lga) => (
                    <option key={lga} value={lga}>
                      {lga}
                    </option>
                  ))}
                </select>
                {errors.lga && (
                  <p className="field-error" role="alert">
                    {errors.lga.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="pd-familyId" className="field-label">
                Family ID (Optional)
              </label>
              <input id="pd-familyId"
                  {...register("familyId")}
                className="input-field"
                placeholder="Link to existing family member"
              />
            </div>

            <div className="flex space-x-4 pt-4">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex-1 inline-flex items-center justify-center space-x-2"
              >
                <CheckIcon className="h-5 w-5" />
                <span>{saving ? "Saving..." : "Save Changes"}</span>
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={saving}
                className="btn-secondary flex-1 inline-flex items-center justify-center space-x-2"
              >
                <XMarkIcon className="h-5 w-5" />
                <span>Cancel</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="shrink-0">
              {patient.photoUrl ? (
                <img
                  src={patient.photoUrl}
                  alt={`Photo of ${fullName}`}
                  className="h-20 w-20 rounded-lg object-cover border border-line"
                />
              ) : (
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-lg bg-surface-sunken border border-line text-h2 text-ink-muted"
                  aria-hidden
                >
                  {patient.givenName[0]}
                  {patient.familyName[0]}
                </div>
              )}
            </div>
            <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-3 text-body sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="section-label">Date of birth</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-ink">
                  <CalendarIcon className="h-4 w-4 text-ink-muted" aria-hidden />
                  {formatNigerianDate(patient.dob)} · {getPatientAge(patient.dob)} years
                </dd>
              </div>
              <div>
                <dt className="section-label">Phone</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-ink">
                  <PhoneIcon className="h-4 w-4 text-ink-muted" aria-hidden />
                  {patient.phone || <span className="text-ink-muted">Not recorded</span>}
                </dd>
              </div>
              <div>
                <dt className="section-label">Email</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-ink break-all">
                  <EnvelopeIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                  {patient.email || <span className="text-ink-muted">Not recorded</span>}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="section-label">Address</dt>
                <dd className="mt-0.5 flex items-start gap-1.5 text-ink">
                  <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                  <span>
                    {patient.address}
                    <span className="block text-ink-secondary">
                      {patient.lga}, {patient.state}
                    </span>
                  </span>
                </dd>
              </div>
              <div>
                <dt className="section-label">Record ID</dt>
                <dd className="mt-0.5 font-mono text-ink">
                  {formatPatientId(patient.id)}
                  {patient.familyId && (
                    <span className="block font-sans text-caption text-ink-muted">
                      Family ID {patient.familyId}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Medical History — toggle between unified timeline and per-section raw view */}
      <div className="flex items-center gap-2">
        <h2 className="text-h2 text-ink">Medical history</h2>
        <div
          className="ml-auto inline-flex rounded-md border border-line bg-surface p-0.5 text-label"
          role="group"
          aria-label="History view"
        >
          <button
            type="button"
            onClick={() => setHistoryView("timeline")}
            aria-pressed={historyView === "timeline"}
            className={`px-3 py-1.5 rounded transition-colors ${
              historyView === "timeline"
                ? "bg-primary-soft text-primary-fg font-semibold"
                : "text-ink-secondary hover:text-ink"
            }`}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setHistoryView("raw")}
            aria-pressed={historyView === "raw"}
            className={`px-3 py-1.5 rounded transition-colors ${
              historyView === "raw"
                ? "bg-primary-soft text-primary-fg font-semibold"
                : "text-ink-secondary hover:text-ink"
            }`}
          >
            By section
          </button>
        </div>
      </div>

      {historyView === "timeline" && patient && (
        <PatientTimeline
          patientId={patient.id}
          refreshKey={`${vitals.length}-${consultations.length}-${dispenses.length}-${visits.length}`}
        />
      )}

      {historyView === "raw" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Vitals */}
          <div className="card">
            <div className="flex items-center space-x-2 mb-4">
              <HeartIcon className="h-5 w-5 text-ink-muted" aria-hidden />
              <h3 className="text-h3 text-ink">
                Recent Vitals
              </h3>
            </div>

            {vitals.length === 0 ? (
              <p className="text-body text-ink-muted">No vitals recorded</p>
            ) : (
              <div className="space-y-3">
                {vitals.slice(0, 3).map((vital) => (
                  <div
                    key={vital.id}
                    className="border-l-2 border-line-strong pl-3"
                  >
                    <div className="text-caption text-ink-muted">
                      {formatNigerianDate(vital.takenAt)}
                    </div>
                    <div className="text-sm">
                      {vital.systolic && vital.diastolic && (
                        <span>
                          BP: {vital.systolic}/{vital.diastolic}{" "}
                        </span>
                      )}
                      {vital.pulseBpm && <span>HR: {vital.pulseBpm} </span>}
                      {resolveBmi(vital) && <span>BMI: {resolveBmi(vital)}</span>}
                    </div>
                    {vital.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {vital.flags.map((flag) => (
                          <StatusBadge key={flag} tone={getFlagTone(flag)}>
                            {getFlagLabel(flag)}
                          </StatusBadge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Consultations */}
          <div className="card">
            <div className="flex items-center space-x-2 mb-4">
              <DocumentTextIcon className="h-5 w-5 text-ink-muted" aria-hidden />
              <h3 className="text-h3 text-ink">
                Consultations
              </h3>
            </div>

            {consultations.length === 0 ? (
              <p className="text-body text-ink-muted">No consultations recorded</p>
            ) : (
              <div className="space-y-3">
                {consultations.slice(0, 3).map((consultation) => (
                  <div
                    key={consultation.id}
                    className="border-l-2 border-line-strong pl-3"
                  >
                    <div className="text-caption text-ink-muted">
                      {formatNigerianDate(consultation.createdAt)}
                    </div>
                    <div className="text-sm font-medium">
                      {consultation.providerName}
                    </div>
                    {consultation.provisionalDx.length > 0 && (
                      <div className="text-body text-ink-secondary">
                        {consultation.provisionalDx.slice(0, 2).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Dispenses */}
          <div className="card">
            <div className="flex items-center space-x-2 mb-4">
              <BeakerIcon className="h-5 w-5 text-ink-muted" aria-hidden />
              <h3 className="text-h3 text-ink">
                Medications
              </h3>
            </div>

            {dispenses.length === 0 ? (
              <p className="text-body text-ink-muted">No medications dispensed</p>
            ) : (
              <div className="space-y-3">
                {dispenses.slice(0, 3).map((dispense) => (
                  <div
                    key={dispense.id}
                    className="border-l-2 border-line-strong pl-3"
                  >
                    <div className="text-caption text-ink-muted">
                      {formatNigerianDate(dispense.dispensedAt)}
                    </div>
                    <div className="text-sm font-medium">
                      {dispense.itemName}
                    </div>
                    <div className="text-body text-ink-secondary">
                      {dispense.dosage} × {dispense.qty}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Portal Status */}
      {patient && (
        <PortalStatusCard
          patientId={patient.id}
          patientName={`${patient.givenName} ${patient.familyName}`}
          onStatusChange={() => loadPatientData(patient.id)}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && patient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-patient-title"
            aria-describedby="delete-patient-desc"
            className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-2xl"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !deleting) setShowDeleteConfirm(false);
            }}
          >
            <h2 id="delete-patient-title" className="text-h2 text-ink">
              Delete the record for {fullName}?
            </h2>
            <div id="delete-patient-desc" className="mt-2 space-y-2 text-body text-ink-secondary">
              <p>This permanently removes, on this device and in the cloud:</p>
              <ul className="list-disc pl-5">
                <li>{visits.length} visit{visits.length === 1 ? "" : "s"}</li>
                <li>{vitals.length} vital sign record{vitals.length === 1 ? "" : "s"}</li>
                <li>{consultations.length} consultation{consultations.length === 1 ? "" : "s"}</li>
                <li>{dispenses.length} dispensing record{dispenses.length === 1 ? "" : "s"}</li>
              </ul>
              <p>
                Other devices that already have this patient keep their copy
                until it is removed there.
              </p>
              <p className="font-medium text-danger-fg">This cannot be undone.</p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                autoFocus
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="btn-secondary"
              >
                Keep record
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="btn-danger"
              >
                <TrashIcon className="h-4 w-4" aria-hidden />
                {deleting ? "Deleting…" : "Delete record"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Allergies and Preferences */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          {patient && user && (
            <AllergyManager patientId={patient.id} userId={user.id} />
          )}
        </div>
        <div className="card">
          {patient && <PreferenceManager patientId={patient.id} />}
        </div>
      </div>

      {/* Visit History */}
      <section className="panel" aria-labelledby="visit-history-title">
        <div className="panel-header">
          <h2 id="visit-history-title" className="panel-title">
            Visit history
          </h2>
          <span className="text-caption text-ink-muted">
            {visits.length} visit{visits.length === 1 ? "" : "s"}
          </span>
        </div>
        {visits.length === 0 ? (
          <EmptyState
            title="No visits yet"
            description="Start a visit to record vitals, a consultation and medicines for this patient."
          />
        ) : (
          <ul className="divide-y divide-line">
            {visits.map((visit) => (
              <li
                key={visit.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span className="text-body text-ink">
                  {formatNigerianDate(visit.startedAt)}
                  <span className="text-ink-muted"> · {visit.siteName}</span>
                </span>
                <StatusBadge tone={visit.status === "open" ? "info" : "neutral"}>
                  {visit.status === "open" ? "In progress" : "Closed"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
