// Comprehensive Supabase sync service for bidirectional data synchronization
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/db";
import { queryCache } from "@/utils/queryCache";
import { getErrorMessage } from "@/utils/errors";

interface SyncStatus {
  lastSync: Date | null;
  pendingChanges: number;
  status: "idle" | "syncing" | "error";
  errorMessage?: string;
}

class SupabaseSync {
  private client: SupabaseClient | null = null;
  private syncStatus: SyncStatus = {
    lastSync: null,
    pendingChanges: 0,
    status: "idle",
  };
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  initialize(url: string, anonKey: string) {
    if (!url || !anonKey) return false;

    try {
      this.client = createClient(url, anonKey, {
        auth: { persistSession: true },
      });
      return true;
    } catch (error) {
      console.error("Failed to initialize Supabase client:", error);
      return false;
    }
  }

  isInitialized(): boolean {
    return this.client !== null;
  }

  onStatusChange(callback: (status: SyncStatus) => void) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener(this.syncStatus));
  }

  private updateStatus(updates: Partial<SyncStatus>) {
    this.syncStatus = { ...this.syncStatus, ...updates };
    this.notifyListeners();
  }

  async syncPatients(direction: "upload" | "download" | "both" = "both") {
    if (!this.client) throw new Error("Supabase client not initialized");

    this.updateStatus({ status: "syncing" });

    try {
      // Upload local changes
      if (direction === "upload" || direction === "both") {
        const dirtyPatients = await db.patients
          .where("_dirty")
          .equals(1)
          .toArray();

        for (const patient of dirtyPatients) {
          const { error } = await this.client.from("patients").upsert({
            id: patient.id,
            given_name: patient.givenName,
            family_name: patient.familyName,
            sex: patient.sex,
            dob: patient.dob,
            phone: patient.phone,
            address: patient.address,
            state: patient.state,
            lga: patient.lga,
            photo_url: patient.photoUrl,
            family_id: patient.familyId,
            created_at: patient.createdAt.toISOString(),
            updated_at: patient.updatedAt.toISOString(),
          });

          if (!error) {
            await db.patients.update(patient.id, {
              _dirty: 0,
              _syncedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Download remote changes
      if (direction === "download" || direction === "both") {
        const lastSync =
          this.syncStatus.lastSync?.toISOString() || "1970-01-01";

        const { data: remotePatients, error } = await this.client
          .from("patients")
          .select("*")
          .gt("updated_at", lastSync);

        if (!error && remotePatients) {
          for (const remote of remotePatients) {
            await db.patients.put({
              id: remote.id,
              givenName: remote.given_name,
              familyName: remote.family_name,
              sex: remote.sex,
              dob: remote.dob,
              phone: remote.phone,
              address: remote.address,
              state: remote.state,
              lga: remote.lga,
              photoUrl: remote.photo_url,
              familyId: remote.family_id,
              createdAt: new Date(remote.created_at),
              updatedAt: new Date(remote.updated_at),
              _dirty: 0,
              _syncedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Clear cache after sync
      queryCache.invalidatePattern(/^patients:/);

      this.updateStatus({
        lastSync: new Date(),
        pendingChanges: 0,
        status: "idle",
        errorMessage: undefined,
      });

      return { success: true };
       
    } catch (error: unknown) {
      this.updateStatus({
        status: "error",
        errorMessage: getErrorMessage(error),
      });
      return { success: false, error: getErrorMessage(error) };
    }
  }

  async syncVitals() {
    if (!this.client) throw new Error("Supabase client not initialized");

    const dirtyVitals = await db.vitals.where("_dirty").equals(1).toArray();

    for (const vital of dirtyVitals) {
      const { error } = await this.client.from("vitals").upsert({
        id: vital.id,
        patient_id: vital.patientId,
        visit_id: vital.visitId,
        height_cm: vital.heightCm,
        weight_kg: vital.weightKg,
        temp_c: vital.tempC,
        pulse_bpm: vital.pulseBpm,
        systolic: vital.systolic,
        diastolic: vital.diastolic,
        spo2: vital.spo2,
        bmi: vital.bmi,
        flags: JSON.stringify(vital.flags),
        taken_at: vital.takenAt.toISOString(),
      });

      if (!error) {
        await db.vitals.update(vital.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        });
      }
    }

    queryCache.invalidatePattern(/^vitals:/);
  }

  async syncConsultations() {
    if (!this.client) throw new Error("Supabase client not initialized");

    const dirtyConsultations = await db.consultations
      .where("_dirty")
      .equals(1)
      .toArray();

    for (const consult of dirtyConsultations) {
      const { error } = await this.client.from("consultations").upsert({
        id: consult.id,
        patient_id: consult.patientId,
        visit_id: consult.visitId,
        provider_name: consult.providerName,
        soap_subjective: consult.soapSubjective,
        soap_objective: consult.soapObjective,
        soap_assessment: consult.soapAssessment,
        soap_plan: consult.soapPlan,
        provisional_dx: JSON.stringify(consult.provisionalDx),
        created_at: consult.createdAt.toISOString(),
      });

      if (!error) {
        await db.consultations.update(consult.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        });
      }
    }

    queryCache.invalidatePattern(/^consultations:/);
  }

  async syncDispenses() {
    if (!this.client) throw new Error("Supabase client not initialized");

    const dirtyDispenses = await db.dispenses
      .where("_dirty")
      .equals(1)
      .toArray();

    for (const dispense of dirtyDispenses) {
      const { error } = await this.client.from("dispenses").upsert({
        id: dispense.id,
        patient_id: dispense.patientId,
        visit_id: dispense.visitId,
        item_name: dispense.itemName,
        qty: dispense.qty,
        dosage: dispense.dosage,
        directions: dispense.directions,
        dispensed_by: dispense.dispensedBy,
        dispensed_at: dispense.dispensedAt.toISOString(),
      });

      if (!error) {
        await db.dispenses.update(dispense.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        });
      }
    }

    queryCache.invalidatePattern(/^dispenses:/);
  }

  async syncInventory() {
    if (!this.client) throw new Error("Supabase client not initialized");

    const dirtyItems = await db.inventory.where("_dirty").equals(1).toArray();

    for (const item of dirtyItems) {
      const { error } = await this.client.from("inventory").upsert({
        id: item.id,
        item_name: item.itemName,
        unit: item.unit,
        on_hand_qty: item.onHandQty,
        reorder_threshold: item.reorderThreshold,
        updated_at: item.updatedAt.toISOString(),
      });

      if (!error) {
        await db.inventory.update(item.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString(),
        });
      }
    }

    queryCache.invalidatePattern(/^inventory:/);
  }

  async syncAll() {
    if (!this.client) return { success: false, error: "Not initialized" };

    this.updateStatus({ status: "syncing" });

    try {
      await Promise.all([
        this.syncPatients("both"),
        this.syncVitals(),
        this.syncConsultations(),
        this.syncDispenses(),
        this.syncInventory(),
      ]);

      this.updateStatus({
        lastSync: new Date(),
        pendingChanges: 0,
        status: "idle",
      });

      return { success: true };
       
    } catch (error: unknown) {
      this.updateStatus({
        status: "error",
        errorMessage: getErrorMessage(error),
      });
      return { success: false, error: getErrorMessage(error) };
    }
  }

  async getPendingChangesCount(): Promise<number> {
    const counts = await Promise.all([
      db.patients.where("_dirty").equals(1).count(),
      db.vitals.where("_dirty").equals(1).count(),
      db.consultations.where("_dirty").equals(1).count(),
      db.dispenses.where("_dirty").equals(1).count(),
      db.inventory.where("_dirty").equals(1).count(),
    ]);

    const total = counts.reduce((sum, count) => sum + count, 0);
    this.updateStatus({ pendingChanges: total });
    return total;
  }

  getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  async setupRealtimeSync(table: string, callback: () => void) {
    if (!this.client) return null;

    return this.client
      .channel(`public:${table}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
        },
        callback,
      )
      .subscribe();
  }
}

export const supabaseSync = new SupabaseSync();

// Initialize on app startup
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (url && key && url.startsWith("http")) {
  supabaseSync.initialize(url, key);
}
