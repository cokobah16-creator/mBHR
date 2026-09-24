import { supabase } from '../lib/supabase';
import { composeSms } from './messageTemplates';

/**
 * Medication reminders stored on the mBHR server (Supabase table
 * medication_reminders). These need the server to be configured and the
 * device to be online; reminders saved on this device live in the outbox
 * (see services/notificationWorker).
 */
export interface SMSReminder {
  id?: string;
  dispenseId?: string;
  patientId: string;
  medicationName: string;
  dosage: string;
  scheduledAt: Date;
  phoneNumber: string;
  message: string;
  status?: 'pending' | 'sent' | 'failed';
  sentAt?: Date;
  errorMessage?: string;
}

export interface ReminderStatusCounts {
  total: number;
  pending: number;
  sent: number;
  failed: number;
}

/** Thrown when the server is not configured on this device. */
export const REMINDER_SERVER_UNAVAILABLE = 'reminder_server_unavailable';

function client() {
  if (!supabase) {
    const error = new Error(REMINDER_SERVER_UNAVAILABLE);
    error.name = 'ReminderServerUnavailable';
    throw error;
  }
  return supabase;
}

// Row shape returned by select('*') on medication_reminders.
interface ReminderRow {
  id: string;
  dispense_id?: string | null;
  patient_id: string;
  medication_name: string;
  dosage: string;
  scheduled_at: string;
  phone_number: string;
  message: string;
  status: 'pending' | 'sent' | 'failed';
  sent_at?: string | null;
  error_message?: string | null;
}

function fromRow(r: ReminderRow): SMSReminder {
  return {
    id: r.id,
    dispenseId: r.dispense_id ?? undefined,
    patientId: r.patient_id,
    medicationName: r.medication_name,
    dosage: r.dosage,
    scheduledAt: new Date(r.scheduled_at),
    phoneNumber: r.phone_number,
    message: r.message,
    status: r.status,
    sentAt: r.sent_at ? new Date(r.sent_at) : undefined,
    errorMessage: r.error_message ?? undefined,
  };
}

export async function scheduleReminder(reminder: SMSReminder): Promise<string> {
  const { data, error } = await client()
    .from('medication_reminders')
    .insert({
      dispense_id: reminder.dispenseId,
      patient_id: reminder.patientId,
      medication_name: reminder.medicationName,
      dosage: reminder.dosage,
      scheduled_at: reminder.scheduledAt.toISOString(),
      phone_number: reminder.phoneNumber,
      message: reminder.message,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data.id;
}

export async function scheduleDispenseReminders(
  dispenseId: string,
  patientId: string,
  patientPhone: string,
  medicationName: string,
  dosage: string,
  frequency: string,
  duration: number,
  opts: { patientName?: string; locale?: string } = {}
): Promise<void> {
  const reminderDates = calculateReminderSchedule(frequency, duration);

  const message = await composeSms('medication_reminder', opts.locale, {
    patient_name: opts.patientName || 'Patient',
    medication: medicationName,
    dosage,
  });

  const reminders = reminderDates.map(date => ({
    dispenseId,
    patientId,
    medicationName,
    dosage,
    scheduledAt: date,
    phoneNumber: patientPhone,
    message,
  }));

  for (const reminder of reminders) {
    await scheduleReminder(reminder);
  }
}

function calculateReminderSchedule(frequency: string, durationDays: number): Date[] {
  const dates: Date[] = [];
  const now = new Date();

  const timesPerDay = parseFrequency(frequency);
  const totalDoses = timesPerDay * durationDays;

  const hoursPerDose = 24 / timesPerDay;

  for (let i = 0; i < totalDoses; i++) {
    const reminderDate = new Date(now);
    reminderDate.setHours(now.getHours() + (hoursPerDose * i));
    dates.push(reminderDate);
  }

  return dates;
}

function parseFrequency(frequency: string): number {
  const lower = frequency.toLowerCase();

  if (lower.includes('once') || lower.includes('1x') || lower.includes('daily')) return 1;
  if (lower.includes('twice') || lower.includes('2x') || lower.includes('bid')) return 2;
  if (lower.includes('three') || lower.includes('3x') || lower.includes('tid')) return 3;
  if (lower.includes('four') || lower.includes('4x') || lower.includes('qid')) return 4;

  const match = frequency.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

export async function getPendingReminders(): Promise<SMSReminder[]> {
  const { data, error } = await client()
    .from('medication_reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) throw error;

  return (data as ReminderRow[]).map(fromRow);
}

/**
 * Most recent server reminders in every state (newest scheduled first), so
 * staff can see what was sent and what failed, not only what is due.
 */
export async function getRecentReminders(limit = 200): Promise<SMSReminder[]> {
  const { data, error } = await client()
    .from('medication_reminders')
    .select('*')
    .order('scheduled_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as ReminderRow[]).map(fromRow);
}

/**
 * Count of server reminders per stored status. Uses exact counts: reading
 * every row would stop at the server's row limit (1000 by default) and
 * under-count without saying so.
 */
export async function getReminderStatusCounts(): Promise<ReminderStatusCounts> {
  const countWhere = async (status?: SMSReminder['status']): Promise<number> => {
    const query = client()
      .from('medication_reminders')
      .select('id', { count: 'exact', head: true });
    const { count, error } = await (status ? query.eq('status', status) : query);
    if (error) throw error;
    return count ?? 0;
  };

  const [total, pending, sent, failed] = await Promise.all([
    countWhere(),
    countWhere('pending'),
    countWhere('sent'),
    countWhere('failed'),
  ]);
  return { total, pending, sent, failed };
}

/**
 * Records a reminder as sent. `note` is stored in error_message (the table's
 * only free-text column) when the reminder was not sent by the SMS provider,
 * e.g. staff recording that the patient got it another way.
 */
export async function markReminderSent(reminderId: string, note?: string): Promise<void> {
  const { error } = await client()
    .from('medication_reminders')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      ...(note ? { error_message: note } : {}),
    })
    .eq('id', reminderId);

  if (error) throw error;
}

export async function markReminderFailed(reminderId: string, errorMessage: string): Promise<void> {
  const { error } = await client()
    .from('medication_reminders')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', reminderId);

  if (error) throw error;
}

export async function getPatientReminders(patientId: string): Promise<SMSReminder[]> {
  const { data, error } = await client()
    .from('medication_reminders')
    .select('*')
    .eq('patient_id', patientId)
    .order('scheduled_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  return (data as ReminderRow[]).map(fromRow);
}
