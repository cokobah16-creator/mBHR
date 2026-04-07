import React, { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { db, Patient, Visit, Vital, Consultation, Dispense } from "@/db";
import { getFlagColor, getFlagLabel } from "@/utils/vitals";
import { formatNigerianDate } from "@/utils/dateFormat";
import { AllergyManager } from "@/components/AllergyManager";
import { PreferenceManager } from "@/components/PreferenceManager";
import { PortalStatusCard } from "@/components/PortalStatusCard";
import { useAuthStore } from "@/stores/auth";
import { patientSchema, PatientFormData } from "@/validation/schemas";
import { NIGERIAN_STATES, LGAS_BY_STATE } from "@/utils/nigeria";
import { normalizePhone } from "@/utils/phone";
import { useToast } from "@/stores/toast";
import {
  ArrowLeftIcon,
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
} from "@heroicons/react/24/outline";

export function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);

  const [patient, setPatient] = useState<Patient | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [dispenses, setDispenses] = useState<Dispense[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { push: pushToast } = useToast();

  const canEdit = user && ["admin", "doctor", "nurse"].includes(user.role);

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
      setVisits(visitsData);
      setVitals(vitalsData);
      setConsultations(consultationsData);
      setDispenses(dispensesData);
    } catch (error) {
      console.error("Error loading patient data:", error);
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
        siteName: "Mobile Clinic",
        status: "open" as const,
      };

      await db.visits.add(visit);
      navigate(`/vitals/${visit.id}`);
    } catch (error) {
      console.error("Error starting visit:", error);
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
      console.error("Error updating patient:", error);
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
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading patient...</p>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="text-center py-12">
        <UserIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Patient not found
        </h3>
        <p className="text-gray-600 mb-6">
          The patient you're looking for doesn't exist.
        </p>
        <Link to="/patients" className="btn-primary">
          Back to Patients
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => startTransition(() => navigate("/patients"))}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target"
        >
          <ArrowLeftIcon className="h-6 w-6 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {isEditing ? "Edit Patient Details" : "Patient Details"}
          </h1>
          <p className="text-gray-600">
            {isEditing
              ? "Update patient information"
              : "View patient information and medical history"}
          </p>
        </div>
        {!isEditing && (
          <>
            {canEdit && (
              <button
                onClick={handleEdit}
                className="btn-secondary inline-flex items-center space-x-2"
              >
                <PencilIcon className="h-5 w-5" />
                <span>Edit</span>
              </button>
            )}
            <button
              onClick={startNewVisit}
              className="btn-primary inline-flex items-center space-x-2"
            >
              <PlayIcon className="h-5 w-5" />
              <span>Start Visit</span>
            </button>
          </>
        )}
      </div>

      {/* Patient Info Card */}
      <div className="card">
        {isEditing ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Given Name *
                </label>
                <input
                  {...register("givenName")}
                  className="input-field"
                  placeholder="Enter given name"
                />
                {errors.givenName && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.givenName.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Family Name *
                </label>
                <input
                  {...register("familyName")}
                  className="input-field"
                  placeholder="Enter family name"
                />
                {errors.familyName && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.familyName.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sex *
                </label>
                <select {...register("sex")} className="input-field">
                  <option value="">Select sex</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                {errors.sex && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.sex.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Birth *
                </label>
                <input
                  {...register("dob")}
                  type="date"
                  className="input-field"
                  max={new Date().toISOString().split("T")[0]}
                />
                {errors.dob && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.dob.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone (at least one contact required)
                </label>
                <input
                  {...register("phone")}
                  type="tel"
                  className="input-field"
                  placeholder="08012345678 or +2348012345678"
                />
                {errors.phone && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.phone.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email (at least one contact required)
                </label>
                <input
                  {...register("email")}
                  type="email"
                  className="input-field"
                  placeholder="patient@example.com"
                />
                {errors.email && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.email.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Address *
              </label>
              <textarea
                {...register("address")}
                className="input-field"
                rows={3}
                placeholder="Enter full address"
              />
              {errors.address && (
                <p className="text-red-600 text-sm mt-1">
                  {errors.address.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  State *
                </label>
                <select
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
                  <p className="text-red-600 text-sm mt-1">
                    {errors.state.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  LGA *
                </label>
                <select
                  {...register("lga")}
                  className={`input-field ${!watchedState ? "bg-gray-100 cursor-not-allowed" : ""}`}
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
                  <p className="text-red-600 text-sm mt-1">
                    {errors.lga.message}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Family ID (Optional)
              </label>
              <input
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
          <div className="flex items-start space-x-6">
            {/* Photo */}
            <div className="flex-shrink-0">
              {patient.photoUrl ? (
                <img
                  src={patient.photoUrl}
                  alt={`${patient.givenName} ${patient.familyName}`}
                  className="w-24 h-24 rounded-full object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center">
                  <span className="text-2xl font-medium text-gray-600">
                    {patient.givenName[0]}
                    {patient.familyName[0]}
                  </span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-4">
                <h2 className="text-2xl font-bold text-gray-900">
                  {patient.givenName} {patient.familyName}
                </h2>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {patient.sex}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center space-x-2 text-gray-600">
                  <CalendarIcon className="h-4 w-4" />
                  <span>
                    Age: {getPatientAge(patient.dob)} (
                    {formatNigerianDate(patient.dob)})
                  </span>
                </div>

                {patient.phone && (
                  <div className="flex items-center space-x-2 text-gray-600">
                    <PhoneIcon className="h-4 w-4" />
                    <span>{patient.phone}</span>
                  </div>
                )}

                {patient.email && (
                  <div className="flex items-center space-x-2 text-gray-600">
                    <EnvelopeIcon className="h-4 w-4" />
                    <span>{patient.email}</span>
                  </div>
                )}

                <div className="flex items-center space-x-2 text-gray-600">
                  <MapPinIcon className="h-4 w-4" />
                  <span>
                    {patient.state}, {patient.lga}
                  </span>
                </div>

                <div className="text-gray-600">
                  <strong>ID:</strong> {patient.id.slice(-8).toUpperCase()}
                </div>
              </div>

              <div className="mt-4">
                <p className="text-sm text-gray-600">
                  <strong>Address:</strong> {patient.address}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Medical History Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Vitals */}
        <div className="card">
          <div className="flex items-center space-x-2 mb-4">
            <HeartIcon className="h-5 w-5 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Recent Vitals
            </h3>
          </div>

          {vitals.length === 0 ? (
            <p className="text-gray-500 text-sm">No vitals recorded</p>
          ) : (
            <div className="space-y-3">
              {vitals.slice(0, 3).map((vital) => (
                <div
                  key={vital.id}
                  className="border-l-4 border-green-500 pl-3"
                >
                  <div className="text-sm text-gray-600">
                    {formatNigerianDate(vital.takenAt)}
                  </div>
                  <div className="text-sm">
                    {vital.systolic && vital.diastolic && (
                      <span>
                        BP: {vital.systolic}/{vital.diastolic}{" "}
                      </span>
                    )}
                    {vital.pulseBpm && <span>HR: {vital.pulseBpm} </span>}
                    {vital.bmi && <span>BMI: {vital.bmi}</span>}
                  </div>
                  {vital.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {vital.flags.map((flag) => (
                        <span
                          key={flag}
                          className={`px-1 py-0.5 rounded text-xs ${getFlagColor(flag)}`}
                        >
                          {getFlagLabel(flag)}
                        </span>
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
            <DocumentTextIcon className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Consultations
            </h3>
          </div>

          {consultations.length === 0 ? (
            <p className="text-gray-500 text-sm">No consultations recorded</p>
          ) : (
            <div className="space-y-3">
              {consultations.slice(0, 3).map((consultation) => (
                <div
                  key={consultation.id}
                  className="border-l-4 border-purple-500 pl-3"
                >
                  <div className="text-sm text-gray-600">
                    {formatNigerianDate(consultation.createdAt)}
                  </div>
                  <div className="text-sm font-medium">
                    {consultation.providerName}
                  </div>
                  {consultation.provisionalDx.length > 0 && (
                    <div className="text-sm text-gray-700">
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
            <BeakerIcon className="h-5 w-5 text-orange-600" />
            <h3 className="text-lg font-semibold text-gray-900">Medications</h3>
          </div>

          {dispenses.length === 0 ? (
            <p className="text-gray-500 text-sm">No medications dispensed</p>
          ) : (
            <div className="space-y-3">
              {dispenses.slice(0, 3).map((dispense) => (
                <div
                  key={dispense.id}
                  className="border-l-4 border-orange-500 pl-3"
                >
                  <div className="text-sm text-gray-600">
                    {formatNigerianDate(dispense.dispensedAt)}
                  </div>
                  <div className="text-sm font-medium">{dispense.itemName}</div>
                  <div className="text-sm text-gray-700">
                    {dispense.dosage} × {dispense.qty}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Portal Status */}
      {patient && (
        <PortalStatusCard
          patientId={patient.id}
          patientName={`${patient.givenName} ${patient.familyName}`}
          onStatusChange={() => loadPatientData(patient.id)}
        />
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
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Visit History
        </h3>

        {visits.length === 0 ? (
          <p className="text-gray-500">No visits recorded</p>
        ) : (
          <div className="space-y-4">
            {visits.map((visit) => (
              <div key={visit.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium">
                      {formatNigerianDate(visit.startedAt)} - {visit.siteName}
                    </span>
                    <span
                      className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                        visit.status === "open"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {visit.status}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500">
                    ID: {visit.id.slice(-8).toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
