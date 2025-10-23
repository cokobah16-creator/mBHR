import { supabase } from '../lib/supabase';

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

export async function scheduleReminder(reminder: SMSReminder): Promise<string> {
  const { data, error } = await supabase
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
  duration: number
): Promise<void> {
  const reminderDates = calculateReminderSchedule(frequency, duration);

  const reminders = reminderDates.map(date => ({
    dispenseId,
    patientId,
    medicationName,
    dosage,
    scheduledAt: date,
    phoneNumber: patientPhone,
    message: `Reminder: Take your ${medicationName} (${dosage}) now. ${frequency}`,
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
  const { data, error } = await supabase
    .from('medication_reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) throw error;

  return data.map(r => ({
    id: r.id,
    dispenseId: r.dispense_id,
    patientId: r.patient_id,
    medicationName: r.medication_name,
    dosage: r.dosage,
    scheduledAt: new Date(r.scheduled_at),
    phoneNumber: r.phone_number,
    message: r.message,
    status: r.status,
  }));
}

export async function markReminderSent(reminderId: string): Promise<void> {
  const { error } = await supabase
    .from('medication_reminders')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .eq('id', reminderId);

  if (error) throw error;
}

export async function markReminderFailed(reminderId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('medication_reminders')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', reminderId);

  if (error) throw error;
}

export async function getPatientReminders(patientId: string): Promise<SMSReminder[]> {
  const { data, error } = await supabase
    .from('medication_reminders')
    .select('*')
    .eq('patient_id', patientId)
    .order('scheduled_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  return data.map(r => ({
    id: r.id,
    dispenseId: r.dispense_id,
    patientId: r.patient_id,
    medicationName: r.medication_name,
    dosage: r.dosage,
    scheduledAt: new Date(r.scheduled_at),
    phoneNumber: r.phone_number,
    message: r.message,
    status: r.status,
    sentAt: r.sent_at ? new Date(r.sent_at) : undefined,
    errorMessage: r.error_message,
  }));
}
