import { supabase } from '../lib/supabase';

export interface Appointment {
  id?: string;
  patientId: string;
  providerId?: string;
  appointmentType: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: 'scheduled' | 'confirmed' | 'arrived' | 'in-progress' | 'completed' | 'no-show' | 'cancelled';
  reason?: string;
  notes?: string;
  reminderSent?: boolean;
  reminderSentAt?: Date;
  createdBy: string;
}

export interface WaitlistEntry {
  id?: string;
  patientId: string;
  appointmentType: string;
  preferredDates?: Date[];
  reason?: string;
  priority: 'routine' | 'urgent';
  status: 'waiting' | 'scheduled' | 'cancelled';
}

export async function createAppointment(appointment: Appointment): Promise<string> {
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      patient_id: appointment.patientId,
      provider_id: appointment.providerId,
      appointment_type: appointment.appointmentType,
      scheduled_at: appointment.scheduledAt.toISOString(),
      duration_minutes: appointment.durationMinutes,
      status: 'scheduled',
      reason: appointment.reason,
      notes: appointment.notes,
      created_by: appointment.createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return data.id;
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: Appointment['status']
): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId);

  if (error) throw error;
}

export async function rescheduleAppointment(
  appointmentId: string,
  newDateTime: Date
): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({
      scheduled_at: newDateTime.toISOString(),
      status: 'scheduled',
    })
    .eq('id', appointmentId);

  if (error) throw error;
}

export async function cancelAppointment(appointmentId: string, reason?: string): Promise<void> {
  const updates: any = { status: 'cancelled' };
  if (reason) {
    updates.notes = reason;
  }

  const { error } = await supabase
    .from('appointments')
    .update(updates)
    .eq('id', appointmentId);

  if (error) throw error;
}

export async function getPatientAppointments(patientId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('patient_id', patientId)
    .order('scheduled_at', { ascending: false });

  if (error) throw error;

  return data.map(a => ({
    id: a.id,
    patientId: a.patient_id,
    providerId: a.provider_id,
    appointmentType: a.appointment_type,
    scheduledAt: new Date(a.scheduled_at),
    durationMinutes: a.duration_minutes,
    status: a.status,
    reason: a.reason,
    notes: a.notes,
    reminderSent: a.reminder_sent,
    reminderSentAt: a.reminder_sent_at ? new Date(a.reminder_sent_at) : undefined,
    createdBy: a.created_by,
  }));
}

export async function getUpcomingAppointments(providerId?: string): Promise<Appointment[]> {
  let query = supabase
    .from('appointments')
    .select('*')
    .in('status', ['scheduled', 'confirmed'])
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (providerId) {
    query = query.eq('provider_id', providerId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return data.map(a => ({
    id: a.id,
    patientId: a.patient_id,
    providerId: a.provider_id,
    appointmentType: a.appointment_type,
    scheduledAt: new Date(a.scheduled_at),
    durationMinutes: a.duration_minutes,
    status: a.status,
    reason: a.reason,
    notes: a.notes,
    reminderSent: a.reminder_sent,
    reminderSentAt: a.reminder_sent_at ? new Date(a.reminder_sent_at) : undefined,
    createdBy: a.created_by,
  }));
}

export async function getTodayAppointments(providerId?: string): Promise<Appointment[]> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  let query = supabase
    .from('appointments')
    .select('*')
    .gte('scheduled_at', startOfDay.toISOString())
    .lte('scheduled_at', endOfDay.toISOString())
    .order('scheduled_at', { ascending: true });

  if (providerId) {
    query = query.eq('provider_id', providerId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return data.map(a => ({
    id: a.id,
    patientId: a.patient_id,
    providerId: a.provider_id,
    appointmentType: a.appointment_type,
    scheduledAt: new Date(a.scheduled_at),
    durationMinutes: a.duration_minutes,
    status: a.status,
    reason: a.reason,
    notes: a.notes,
    reminderSent: a.reminder_sent,
    reminderSentAt: a.reminder_sent_at ? new Date(a.reminder_sent_at) : undefined,
    createdBy: a.created_by,
  }));
}

export async function checkAvailability(
  providerId: string,
  dateTime: Date,
  durationMinutes: number
): Promise<boolean> {
  const startTime = dateTime;
  const endTime = new Date(dateTime.getTime() + durationMinutes * 60000);

  const { data, error } = await supabase
    .from('appointments')
    .select('id')
    .eq('provider_id', providerId)
    .in('status', ['scheduled', 'confirmed', 'in-progress'])
    .or(`scheduled_at.gte.${startTime.toISOString()},scheduled_at.lt.${endTime.toISOString()}`);

  if (error) throw error;

  return data.length === 0;
}

export async function addToWaitlist(entry: WaitlistEntry): Promise<string> {
  const { data, error } = await supabase
    .from('waitlist')
    .insert({
      patient_id: entry.patientId,
      appointment_type: entry.appointmentType,
      preferred_dates: entry.preferredDates?.map(d => d.toISOString()),
      reason: entry.reason,
      priority: entry.priority,
      status: 'waiting',
    })
    .select()
    .single();

  if (error) throw error;
  return data.id;
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  const { data, error } = await supabase
    .from('waitlist')
    .select('*')
    .eq('status', 'waiting')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;

  return data.map(w => ({
    id: w.id,
    patientId: w.patient_id,
    appointmentType: w.appointment_type,
    preferredDates: w.preferred_dates?.map((d: string) => new Date(d)),
    reason: w.reason,
    priority: w.priority,
    status: w.status,
  }));
}

export async function updateWaitlistStatus(
  waitlistId: string,
  status: WaitlistEntry['status']
): Promise<void> {
  const { error } = await supabase
    .from('waitlist')
    .update({ status })
    .eq('id', waitlistId);

  if (error) throw error;
}

export async function scheduleFromWaitlist(
  waitlistId: string,
  appointmentData: Omit<Appointment, 'id'>
): Promise<string> {
  const appointmentId = await createAppointment(appointmentData);

  await updateWaitlistStatus(waitlistId, 'scheduled');

  return appointmentId;
}
