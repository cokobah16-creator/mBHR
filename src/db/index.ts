import Dexie, { Table } from "dexie";
import { ulid } from "ulid";
import { metaphone } from "metaphone";

// Types
export interface User {
  id: string;
  fullName: string;
  role: "admin" | "doctor" | "nurse" | "pharmacist" | "volunteer" | "guest";
  email?: string;
  phone?: string;
  pinHash: string;
  pinSalt: string;
  adminAccess?: boolean;
  adminPermanent?: boolean;
  createdAt: Date;
  updatedAt: Date;
  isActive: 0 | 1;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  deviceKey: string;
  lastSeenAt: Date;
}

export interface Setting {
  key: string;
  value: string;
}

export interface Meta {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  updatedAt: number;
}

export interface PortalInvitation {
  lastSentAt?: string;
  lastStatus?: "queued" | "sent" | "delivered" | "failed";
  failureReason?: string | null;
  count?: number;
}

export interface Patient {
  id: string;
  givenName: string;
  familyName: string;
  sex: "male" | "female" | "other";
  dob: string;
  phone?: string | null;
  email?: string | null;
  address: string;
  state: string;
  lga: string;
  photoUrl?: string;
  familyId?: string;
  phoneN?: string;
  nameKey?: string;
  dobDay?: number;
  createdDay?: number;
  updatedDay?: number;
  mergeInto?: string;
  authUid?: string | null;
  contactVerified?: 0 | 1;
  portalEnabled?: 0 | 1;
  portalInvitation?: PortalInvitation | null;
  lastPortalActivity?: string | null;
  createdAt: Date;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface Vital {
  id: string;
  patientId: string;
  visitId: string;
  heightCm?: number;
  weightKg?: number;
  tempC?: number;
  pulseBpm?: number;
  systolic?: number;
  diastolic?: number;
  spo2?: number;
  bmi?: number;
  flags: string[];
  takenAt: Date;
  portalVisible?: boolean;
  visibilityReason?: string;
  hiddenBy?: string;
  hiddenAt?: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface Consultation {
  id: string;
  patientId: string;
  visitId: string;
  providerName: string;
  soapSubjective: string;
  soapObjective: string;
  soapAssessment: string;
  soapPlan: string;
  provisionalDx: string[];
  referred?: boolean;
  referralNotes?: string;
  createdAt: Date;
  portalVisible?: boolean;
  visibilityReason?: string;
  hiddenBy?: string;
  hiddenAt?: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface Dispense {
  id: string;
  patientId: string;
  visitId: string;
  itemName: string;
  qty: number;
  dosage: string;
  directions: string;
  dispensedBy: string;
  dispensedAt: Date;
  portalVisible?: boolean;
  visibilityReason?: string;
  hiddenBy?: string;
  hiddenAt?: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface InventoryItem {
  id: string;
  itemName: string;
  unit: string;
  onHandQty: number;
  reorderThreshold: number;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface Visit {
  id: string;
  patientId: string;
  startedAt: Date;
  siteName: string;
  status: "open" | "closed";
  _dirty?: number;
  _syncedAt?: string;
}

export interface QueueItem {
  id: string;
  patientId: string;
  stage: "registration" | "vitals" | "consult" | "pharmacy";
  position: number;
  status: "waiting" | "in_progress" | "done";
  priority?: "urgent" | "normal" | "low";
  createdBy?: string;
  queuedAt?: Date;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface AuditLog {
  id: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  at: Date;
}

export interface PatientMerge {
  id: string;
  winnerId: string;
  loserId: string;
  mergedBy: string;
  createdDay: number;
  reason: string;
}

export interface DailyCount {
  day: number;
  registrations: number;
  vitals: number;
  consultations: number;
  dispenses: number;
  visits: number;
}

export interface ConflictResolution {
  id: string;
  patientId: string;
  conflictType: "duplicate" | "sync_conflict";
  status: "pending" | "resolved" | "ignored";
  candidateIds: string[];
  resolvedBy?: string;
  resolvedAt?: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolution?: any;
}

// Gamification types
export interface GameSession {
  id: string;
  type: "vitals" | "shelf" | "quiz" | "triage";
  volunteerId: string;
  startedAt: Date;
  finishedAt?: Date;
  score: number;
  tokensEarned: number;
  payloadJson: string;
  committed: boolean; // keep for UI logic
  _dirty?: number;
  _syncedAt?: string;
}

export interface GamificationWallet {
  volunteerId: string;
  tokens: number;
  badges: string[];
  level: number;
  streakDays: number;
  lifetimeTokens: number;
  lastActiveDate?: Date;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface VitalsRange {
  id: string;
  ageMin: number;
  ageMax: number;
  sex: "M" | "F" | "U";
  metric: "hr" | "rr" | "temp" | "sbp" | "dbp" | "spo2";
  min: number;
  max: number;
  source: string;
  updatedAt: Date;
}

export interface QuizQuestion {
  id: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  stem: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  updatedAt: Date;
}

export interface TriageSample {
  id: string;
  createdAt: Date;
  caseHash: string;
  goldPriority: "urgent" | "normal" | "low";
  createdBy: string;
}

export interface TriageRecord {
  id: string;
  patientId: string;
  visitId: string;
  priority: "urgent" | "normal" | "low";
  chiefComplaint: string;
  createdAt: Date;
  createdBy: string;
  _dirty?: number;
  _syncedAt?: string;
}

export interface InventoryDiscrepancy {
  id: string;
  itemId: string;
  foundQty: number;
  systemQty: number;
  photo?: string;
  note?: string;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  _dirty?: number;
  _syncedAt?: string;
}

// Outbox and messaging types
export interface OutboundMessage {
  id: string;
  patientId: string;
  channel: "sms" | "whatsapp";
  to: string;
  locale: string;
  templateKey: string;
  payload: Record<string, string | number>;
  status: "queued" | "sending" | "sent" | "delivered" | "failed";
  createdAt: Date;
  scheduledFor?: Date;
  attempts: number;
  lastAttemptAt?: Date;
  errorMessage?: string;
  _dirty?: number;
  _syncedAt?: string;
}

export interface MessageTemplate {
  key: string;
  locale: string;
  channel: "sms" | "whatsapp";
  subject?: string;
  body: string;
  maxLength: number;
}

// Enhanced pharmacy types
export interface StockBatch {
  id: string;
  drugId: string;
  lotNumber: string;
  expiryDate: Date;
  qtyOnHand: number;
  receivedAt: Date;
  supplier?: string;
  _dirty?: number;
  _syncedAt?: string;
}

export interface CareTask {
  id: string;
  patientId: string;
  type: "medication_reminder" | "followup_visit" | "lab_test" | "vital_check";
  title: string;
  description: string;
  status: "pending" | "completed" | "overdue" | "cancelled";
  dueDate: Date;
  completedAt?: Date;
  createdAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface PatientAllergy {
  id: string;
  patientId: string;
  allergen: string;
  allergyType: "medication" | "food" | "environmental" | "other";
  reaction?: string;
  severity: "mild" | "moderate" | "severe" | "life-threatening";
  onsetDate?: Date;
  notes?: string;
  isActive: 0 | 1;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  _dirty?: number;
  _syncedAt?: string;
}

export interface PatientPreference {
  id: string;
  patientId: string;
  preferredLanguage?: string;
  communicationChannel?: "sms" | "whatsapp" | "call" | "in-person";
  bestContactTime?: string;
  dietaryRestrictions?: string;
  religiousCultural?: string;
  appointmentReminders: 0 | 1;
  medicationReminders: 0 | 1;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface ClinicalAlert {
  id: string;
  patientId: string;
  alertType:
    | "vital_sign"
    | "drug_interaction"
    | "high_risk"
    | "adherence"
    | "follow_up";
  severity: "low" | "moderate" | "high" | "critical";
  message: string;
  details: string;
  createdAt: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface PortalMessage {
  id: string;
  patientId: string;
  senderType: "patient" | "staff";
  senderId: string;
  subject?: string;
  messageBody: string;
  parentMessageId?: string;
  read: boolean;
  readAt?: Date;
  attachments?: string[];
  priority: "normal" | "high";
  createdAt: Date;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface PortalNotification {
  id: string;
  patientId: string;
  notificationType: string;
  title: string;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
  read: boolean;
  readAt?: Date;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
  createdAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface PatientSubmittedData {
  id: string;
  patientId: string;
  portalUserId?: string;
  submissionType:
    | "symptoms"
    | "medications"
    | "allergies"
    | "lifestyle"
    | "vitals"
    | "other";
  data: Record<string, unknown>;
  notes?: string;
  status: "pending" | "approved" | "rejected" | "merged";
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  mergedToRecordId?: string;
  createdAt: Date;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  providerId?: string;
  appointmentType: string;
  scheduledAt: Date;
  durationMinutes: number;
  status:
    | "scheduled"
    | "confirmed"
    | "arrived"
    | "in-progress"
    | "completed"
    | "no-show"
    | "cancelled";
  reason?: string;
  notes?: string;
  reminderSent?: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  _dirty?: number;
  _syncedAt?: string;
}

// Helper functions for date handling
export const epochDay = (d: Date) => Math.floor(d.getTime() / 86400000);
export const normPhone = (s: string) => s.replace(/\D/g, "");
export const nameKeyOf = (first: string, last: string) =>
  `${metaphone(first || "")}-${metaphone(last || "")}`;

// Outreach site registry for admins to predefine sites used in visits/reports.
export interface Site {
  id: string;
  name: string;
  active: 0 | 1;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Database name - bumped to avoid incompatible older store
export const DB_NAME = "mbhr_v5";

// Database class
export class MBHRDatabase extends Dexie {
  users!: Table<User>;
  sessions!: Table<Session>;
  settings!: Table<Setting>;
  meta!: Table<Meta>;
  patients!: Table<Patient>;
  vitals!: Table<Vital>;
  consultations!: Table<Consultation>;
  dispenses!: Table<Dispense>;
  inventory!: Table<InventoryItem>;
  visits!: Table<Visit>;
  queue!: Table<QueueItem>;
  auditLogs!: Table<AuditLog>;
  gameSessions!: Table<GameSession>;
  gamificationWallets!: Table<GamificationWallet>;
  vitalsRanges!: Table<VitalsRange>;
  quizQuestions!: Table<QuizQuestion>;
  triageSamples!: Table<TriageSample>;
  inventoryDiscrepancies!: Table<InventoryDiscrepancy>;
  outboundMessages!: Table<OutboundMessage>;
  messageTemplates!: Table<MessageTemplate>;
  stockBatches!: Table<StockBatch>;
  careTasks!: Table<CareTask>;
  triageRecords!: Table<TriageRecord>;
  patientMerges!: Table<PatientMerge>;
  dailyCounts!: Table<DailyCount>;
  conflictResolutions!: Table<ConflictResolution>;
  patientAllergies!: Table<PatientAllergy>;
  patientPreferences!: Table<PatientPreference>;
  clinicalAlerts!: Table<ClinicalAlert>;
  portalMessages!: Table<PortalMessage>;
  portalNotifications!: Table<PortalNotification>;
  patientSubmittedData!: Table<PatientSubmittedData>;
  appointments!: Table<Appointment>;
  sites!: Table<Site>;

  constructor() {
    super(DB_NAME);

    // v1 — Initial schema with stable PKs
    this.version(1).stores({
      patients: "id, familyName, phone, state, lga, createdAt, updatedAt",
      vitals: "id, patientId, visitId, takenAt, systolic, diastolic",
      consultations: "id, patientId, visitId, createdAt, providerName",
      dispenses: "id, patientId, visitId, dispensedAt, itemName",
      inventory: "id, itemName, updatedAt, onHandQty",
      visits: "id, patientId, startedAt, status, siteName",
      queue: "id, patientId, stage, position, status, updatedAt",
      auditLogs: "id, actorRole, entity, entityId, at",
      users: "id, fullName, role, email, pinHash, createdAt, updatedAt",
      sessions: "id, userId, createdAt, lastSeenAt",
      settings: "key",
    });

    // v2 — Add sync indexes for _dirty and _syncedAt
    this.version(2).stores({
      patients:
        "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt",
      vitals:
        "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
      consultations:
        "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
      dispenses:
        "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
      inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
      visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
      queue:
        "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
      auditLogs: "id, actorRole, entity, entityId, at",
      users: "id, fullName, role, email, pinHash, createdAt, updatedAt",
      sessions: "id, userId, createdAt, lastSeenAt",
      settings: "key",
    });

    // v3 — Add isActive index to users table
    this.version(3)
      .stores({
        patients:
          "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
      })
      .upgrade(async (tx) => {
        // Set default isActive = true for existing users that lack this field
        await tx
          .table("users")
          .toCollection()
          .modify((user) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (typeof (user as any).isActive === "undefined") {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (user as any).isActive = 1;
            }
          });
      });

    // v4 — Convert isActive boolean to numeric (0/1) for IndexedDB compatibility
    this.version(4)
      .stores({
        patients:
          "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
      })
      .upgrade(async (tx) => {
        // Convert boolean isActive values to numeric (0/1)
        await tx
          .table("users")
          .toCollection()
          .modify((user) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (typeof (user as any).isActive === "boolean") {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (user as any).isActive = (user as any).isActive ? 1 : 0;
            }
          });
      });

    // v5 — Add adminAccess and adminPermanent fields for Supabase integration
    this.version(5)
      .stores({
        patients:
          "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
      })
      .upgrade(async (tx) => {
        // Set default values for new adminAccess and adminPermanent fields
        await tx
          .table("users")
          .toCollection()
          .modify((user) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (typeof (user as any).adminAccess === "undefined") {
              // Set adminAccess based on role - admins get true, others get false
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (user as any).adminAccess = (user as any).role === "admin";
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (typeof (user as any).adminPermanent === "undefined") {
              // Set adminPermanent = true for Kristopher Okobah, false for others
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (user as any).adminPermanent =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (user as any).fullName === "Kristopher Okobah";
            }
          });
      });

    // v6 — Add gamification tables
    this.version(8)
      .stores({
        patients:
          "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
        gameSessions:
          "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
        gamificationWallets:
          "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
        vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
        quizQuestions: "id, topic, difficulty, updatedAt",
        triageSamples: "id, createdAt, createdBy",
        inventoryDiscrepancies:
          "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
        outboundMessages:
          "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
        messageTemplates: "key, locale, channel",
        stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
        careTasks:
          "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
      })
      .upgrade(async (tx) => {
        // Normalize date fields to ISO strings and ensure committed is boolean
        const table = tx.table("gameSessions");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await table.toCollection().modify((obj: any) => {
          // Ensure committed is boolean
          if (typeof obj.committed !== "boolean") {
            obj.committed = false;
          }
          // Normalize createdAt to ISO string if it's a Date object
          if (obj.createdAt instanceof Date) {
            obj.createdAt = obj.createdAt.toISOString();
          }
          if (obj.startedAt instanceof Date) {
            obj.startedAt = obj.startedAt.toISOString();
          }
          if (obj.finishedAt instanceof Date) {
            obj.finishedAt = obj.finishedAt.toISOString();
          }
        });
      });

    // v9 — Add dedupe and analytics tables with epochDay indexes
    this.version(9)
      .stores({
        patients:
          "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
        meta: "key",
        gameSessions:
          "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
        gamificationWallets:
          "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
        vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
        quizQuestions: "id, topic, difficulty, updatedAt",
        triageSamples: "id, createdAt, createdBy",
        inventoryDiscrepancies:
          "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
        outboundMessages:
          "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
        messageTemplates: "key, locale, channel",
        stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
        careTasks:
          "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
        patientMerges: "id, winnerId, loserId, createdDay",
        dailyCounts:
          "day, registrations, vitals, consultations, dispenses, visits",
        conflictResolutions: "id, patientId, conflictType, status, resolvedAt",
      })
      .upgrade(async (tx) => {
        // Migrate existing patients to new schema
        await tx
          .table("patients")
          .toCollection()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .modify((patient: any) => {
            if (!patient.phoneN) {
              patient.phoneN = normPhone(patient.phone || "");
            }
            if (!patient.nameKey) {
              patient.nameKey = nameKeyOf(
                patient.givenName || "",
                patient.familyName || "",
              );
            }
            if (!patient.dobDay && patient.dob) {
              patient.dobDay = epochDay(new Date(patient.dob));
            }
            if (!patient.createdDay && patient.createdAt) {
              patient.createdDay = epochDay(patient.createdAt);
            }
            if (!patient.updatedDay && patient.updatedAt) {
              patient.updatedDay = epochDay(patient.updatedAt);
            }
            patient.mergeInto = null;
          });
      });

    // v10 — Add patient allergies and preferences tables
    this.version(10).stores({
      patients:
        "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto",
      vitals:
        "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
      consultations:
        "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
      dispenses:
        "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
      inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
      visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
      queue:
        "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
      auditLogs: "id, actorRole, entity, entityId, at",
      users:
        "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
      sessions: "id, userId, createdAt, lastSeenAt",
      settings: "key",
      meta: "key",
      gameSessions:
        "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
      gamificationWallets:
        "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
      vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
      quizQuestions: "id, topic, difficulty, updatedAt",
      triageSamples: "id, createdAt, createdBy",
      inventoryDiscrepancies:
        "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
      outboundMessages:
        "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
      messageTemplates: "key, locale, channel",
      stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
      careTasks: "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
      triageRecords:
        "id, patientId, visitId, priority, createdAt, createdBy, _dirty, _syncedAt",
      patientMerges: "id, winnerId, loserId, createdDay",
      dailyCounts:
        "day, registrations, vitals, consultations, dispenses, visits",
      conflictResolutions: "id, patientId, conflictType, status, resolvedAt",
      patientAllergies:
        "id, patientId, allergen, allergyType, severity, isActive, createdAt, updatedAt, _dirty, _syncedAt",
      patientPreferences:
        "id, patientId, createdAt, updatedAt, _dirty, _syncedAt",
    });

    // v11 — Add clinical alerts table for AI decision support
    this.version(11).stores({
      patients:
        "id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto",
      vitals:
        "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
      consultations:
        "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
      dispenses:
        "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
      inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
      visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
      queue:
        "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
      auditLogs: "id, actorRole, entity, entityId, at",
      users:
        "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
      sessions: "id, userId, createdAt, lastSeenAt",
      settings: "key",
      meta: "key",
      gameSessions:
        "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
      gamificationWallets:
        "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
      vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
      quizQuestions: "id, topic, difficulty, updatedAt",
      triageSamples: "id, createdAt, createdBy",
      inventoryDiscrepancies:
        "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
      outboundMessages:
        "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
      messageTemplates: "key, locale, channel",
      stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
      careTasks: "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
      triageRecords:
        "id, patientId, visitId, priority, createdAt, createdBy, _dirty, _syncedAt",
      patientMerges: "id, winnerId, loserId, createdDay",
      dailyCounts:
        "day, registrations, vitals, consultations, dispenses, visits",
      conflictResolutions: "id, patientId, conflictType, status, resolvedAt",
      patientAllergies:
        "id, patientId, allergen, allergyType, severity, isActive, createdAt, updatedAt, _dirty, _syncedAt",
      patientPreferences:
        "id, patientId, createdAt, updatedAt, _dirty, _syncedAt",
      clinicalAlerts:
        "id, patientId, alertType, severity, acknowledged, createdAt, acknowledgedAt, _dirty, _syncedAt",
    });

    // v12 — Add email, authUid, and contactVerified fields for patient portal integration
    this.version(12)
      .stores({
        patients:
          "id, familyName, phone, email, authUid, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto, contactVerified",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
        meta: "key",
        gameSessions:
          "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
        gamificationWallets:
          "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
        vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
        quizQuestions: "id, topic, difficulty, updatedAt",
        triageSamples: "id, createdAt, createdBy",
        inventoryDiscrepancies:
          "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
        outboundMessages:
          "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
        messageTemplates: "key, locale, channel",
        stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
        careTasks:
          "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
        triageRecords:
          "id, patientId, visitId, priority, createdAt, createdBy, _dirty, _syncedAt",
        patientMerges: "id, winnerId, loserId, createdDay",
        dailyCounts:
          "day, registrations, vitals, consultations, dispenses, visits",
        conflictResolutions: "id, patientId, conflictType, status, resolvedAt",
        patientAllergies:
          "id, patientId, allergen, allergyType, severity, isActive, createdAt, updatedAt, _dirty, _syncedAt",
        patientPreferences:
          "id, patientId, createdAt, updatedAt, _dirty, _syncedAt",
        clinicalAlerts:
          "id, patientId, alertType, severity, acknowledged, createdAt, acknowledgedAt, _dirty, _syncedAt",
      })
      .upgrade(async (tx) => {
        // Migrate existing patients to add email, authUid, and contactVerified fields
        await tx
          .table("patients")
          .toCollection()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .modify((patient: any) => {
            // Normalize email to lowercase if it exists
            if (patient.email) {
              patient.email = String(patient.email).toLowerCase().trim();
            } else {
              patient.email = null;
            }

            // Ensure phone is normalized or null
            if (!patient.phone || String(patient.phone).trim() === "") {
              patient.phone = null;
            }

            // Add new fields with default values
            if (patient.authUid === undefined) {
              patient.authUid = null;
            }
            if (patient.contactVerified === undefined) {
              patient.contactVerified = 0;
            }
          });
      });

    // v13 — Add portal enrollment fields
    this.version(13)
      .stores({
        patients:
          "id, familyName, phone, email, authUid, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto, contactVerified, portalEnabled, lastPortalActivity",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
        meta: "key",
        gameSessions:
          "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
        gamificationWallets:
          "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
        vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
        quizQuestions: "id, topic, difficulty, updatedAt",
        triageSamples: "id, createdAt, createdBy",
        inventoryDiscrepancies:
          "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
        outboundMessages:
          "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
        messageTemplates: "key, locale, channel",
        stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
        careTasks:
          "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
        triageRecords:
          "id, patientId, visitId, priority, createdAt, createdBy, _dirty, _syncedAt",
        patientMerges: "id, winnerId, loserId, createdDay",
        dailyCounts:
          "day, registrations, vitals, consultations, dispenses, visits",
        conflictResolutions: "id, patientId, conflictType, status, resolvedAt",
        patientAllergies:
          "id, patientId, allergen, allergyType, severity, isActive, createdAt, updatedAt, _dirty, _syncedAt",
        patientPreferences:
          "id, patientId, createdAt, updatedAt, _dirty, _syncedAt",
        clinicalAlerts:
          "id, patientId, alertType, severity, acknowledged, createdAt, acknowledgedAt, _dirty, _syncedAt",
      })
      .upgrade(async (tx) => {
        // Add portal enrollment fields to existing patients
        await tx
          .table("patients")
          .toCollection()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .modify((patient: any) => {
            if (patient.portalEnabled === undefined) {
              patient.portalEnabled = 0;
            }
            if (patient.portalInvitation === undefined) {
              patient.portalInvitation = null;
            }
            if (patient.lastPortalActivity === undefined) {
              patient.lastPortalActivity = null;
            }
          });
      });

    // v14 — Add offline portal support: messages, notifications, submissions, appointments
    this.version(14)
      .stores({
        patients:
          "id, familyName, phone, email, authUid, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto, contactVerified, portalEnabled, lastPortalActivity",
        vitals:
          "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt, portalVisible",
        consultations:
          "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt, portalVisible",
        dispenses:
          "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt, portalVisible",
        inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
        visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
        queue:
          "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
        auditLogs: "id, actorRole, entity, entityId, at",
        users:
          "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
        sessions: "id, userId, createdAt, lastSeenAt",
        settings: "key",
        meta: "key",
        gameSessions:
          "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
        gamificationWallets:
          "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
        vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
        quizQuestions: "id, topic, difficulty, updatedAt",
        triageSamples: "id, createdAt, createdBy",
        inventoryDiscrepancies:
          "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
        outboundMessages:
          "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
        messageTemplates: "key, locale, channel",
        stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
        careTasks:
          "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
        triageRecords:
          "id, patientId, visitId, priority, createdAt, createdBy, _dirty, _syncedAt",
        patientMerges: "id, winnerId, loserId, createdDay",
        dailyCounts:
          "day, registrations, vitals, consultations, dispenses, visits",
        conflictResolutions: "id, patientId, conflictType, status, resolvedAt",
        patientAllergies:
          "id, patientId, allergen, allergyType, severity, isActive, createdAt, updatedAt, _dirty, _syncedAt",
        patientPreferences:
          "id, patientId, createdAt, updatedAt, _dirty, _syncedAt",
        clinicalAlerts:
          "id, patientId, alertType, severity, acknowledged, createdAt, acknowledgedAt, _dirty, _syncedAt",
        portalMessages:
          "id, patientId, senderType, read, createdAt, _dirty, _syncedAt",
        portalNotifications:
          "id, patientId, read, createdAt, _dirty, _syncedAt",
        patientSubmittedData:
          "id, patientId, submissionType, status, createdAt, _dirty, _syncedAt",
        appointments: "id, patientId, scheduledAt, status, _dirty, _syncedAt",
      })
      .upgrade(async (tx) => {
        // Add portalVisible field to existing vitals, consultations, dispenses
        await tx
          .table("vitals")
          .toCollection()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .modify((vital: any) => {
            if (vital.portalVisible === undefined) {
              vital.portalVisible = true;
            }
          });
        await tx
          .table("consultations")
          .toCollection()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .modify((consult: any) => {
            if (consult.portalVisible === undefined) {
              consult.portalVisible = true;
            }
          });
        await tx
          .table("dispenses")
          .toCollection()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .modify((dispense: any) => {
            if (dispense.portalVisible === undefined) {
              dispense.portalVisible = true;
            }
          });
      });

    // v15 — outreach site registry. Carries no data on first run; admins
    // populate it from /reports/outreach so the site filter has a stable
    // dropdown source even before any visits exist.
    this.version(15).stores({
      patients:
        "id, familyName, phone, email, authUid, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto, contactVerified, portalEnabled, lastPortalActivity",
      vitals:
        "id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt, portalVisible",
      consultations:
        "id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt, portalVisible",
      dispenses:
        "id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt, portalVisible",
      inventory: "id, itemName, updatedAt, onHandQty, _dirty, _syncedAt",
      visits: "id, patientId, startedAt, status, siteName, _dirty, _syncedAt",
      queue:
        "id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt",
      auditLogs: "id, actorRole, entity, entityId, at",
      users:
        "id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt",
      sessions: "id, userId, createdAt, lastSeenAt",
      settings: "key",
      meta: "key",
      gameSessions:
        "id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt",
      gamificationWallets:
        "volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt",
      vitalsRanges: "id, sex, metric, ageMin, ageMax, updatedAt",
      quizQuestions: "id, topic, difficulty, updatedAt",
      triageSamples: "id, createdAt, createdBy",
      inventoryDiscrepancies:
        "id, itemId, createdAt, resolvedAt, _dirty, _syncedAt",
      outboundMessages:
        "id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt",
      messageTemplates: "key, locale, channel",
      stockBatches: "id, drugId, expiryDate, updatedAt, _dirty, _syncedAt",
      careTasks: "id, patientId, status, dueDate, createdAt, _dirty, _syncedAt",
      triageRecords:
        "id, patientId, visitId, priority, createdAt, createdBy, _dirty, _syncedAt",
      patientMerges: "id, winnerId, loserId, createdDay",
      dailyCounts:
        "day, registrations, vitals, consultations, dispenses, visits",
      conflictResolutions: "id, patientId, conflictType, status, resolvedAt",
      patientAllergies:
        "id, patientId, allergen, allergyType, severity, isActive, createdAt, updatedAt, _dirty, _syncedAt",
      patientPreferences:
        "id, patientId, createdAt, updatedAt, _dirty, _syncedAt",
      clinicalAlerts:
        "id, patientId, alertType, severity, acknowledged, createdAt, acknowledgedAt, _dirty, _syncedAt",
      portalMessages:
        "id, patientId, senderType, read, createdAt, _dirty, _syncedAt",
      portalNotifications: "id, patientId, read, createdAt, _dirty, _syncedAt",
      patientSubmittedData:
        "id, patientId, submissionType, status, createdAt, _dirty, _syncedAt",
      appointments: "id, patientId, scheduledAt, status, _dirty, _syncedAt",
      sites: "id, name, active, updatedAt",
    });
  }
}

export const db = new MBHRDatabase();

// Helper functions
export const generateId = () => ulid();

// Patient dedupe and conflict resolution
export const createPatientDraft = async (p: {
  givenName: string;
  familyName: string;
  phone?: string | null;
  email?: string | null;
  dob: Date;
  sex: "male" | "female" | "other";
  address: string;
  state: string;
  lga: string;
}) => {
  const now = new Date();
  const dobDay = epochDay(p.dob);
  const phoneN = normPhone(p.phone || "");
  const nameKey = nameKeyOf(p.givenName, p.familyName);

  const rec: Patient = {
    id: generateId(),
    givenName: p.givenName,
    familyName: p.familyName,
    sex: p.sex,
    dob: p.dob.toISOString().split("T")[0],
    phone: p.phone || null,
    email: p.email ? String(p.email).toLowerCase().trim() : null,
    address: p.address,
    state: p.state,
    lga: p.lga,
    authUid: null,
    contactVerified: 0,
    createdAt: now,
    updatedAt: now,
    _dirty: 1,
  };

  // Find potential duplicates
  const candidates = await db.patients
    .where("dobDay")
    .equals(dobDay)
    .and(
      (x) =>
        !x.mergeInto &&
        ((phoneN && x.phoneN === phoneN) || x.nameKey === nameKey),
    )
    .toArray();

  return { rec, candidates };
};

// Merge patients (winner absorbs loser's data)
export const mergePatients = async (
  winnerId: string,
  loserId: string,
  mergedBy: string,
) => {
  await db.transaction("rw", db.patients, db.patientMerges, async () => {
    const now = new Date();
    const day = epochDay(now);

    // Mark loser as merged
    await db.patients.update(loserId, {
      mergeInto: winnerId,
      updatedAt: now,
      _dirty: 1,
    });

    // Record merge
    await db.patientMerges.add({
      id: generateId(),
      winnerId,
      loserId,
      mergedBy,
      createdDay: day,
      reason: "duplicate_resolution",
    });

    // Update winner's updatedAt
    await db.patients.update(winnerId, {
      updatedAt: now,
      _dirty: 1,
    });
  });
};

// Daily count helpers
export const bumpDailyCount = async (
  day: number,
  metric: keyof Omit<DailyCount, "day">,
) => {
  try {
    const existing = await db.dailyCounts.where("day").equals(day).first();
    if (existing) {
      await db.dailyCounts.update(existing.day, {
        [metric]: (existing[metric] || 0) + 1,
      });
    } else {
      const newCount: DailyCount = {
        day,
        registrations: 0,
        vitals: 0,
        consultations: 0,
        dispenses: 0,
        visits: 0,
      };
      newCount[metric] = 1;
      await db.dailyCounts.add(newCount);
    }
  } catch (error) {
    console.warn("Failed to bump daily count:", error);
  }
};

export const createAuditLog = async (
  actorRole: string,
  action: string,
  entity: string,
  entityId: string,
) => {
  await db.auditLogs.add({
    id: generateId(),
    actorRole,
    action,
    entity,
    entityId,
    at: new Date(),
  });
};
