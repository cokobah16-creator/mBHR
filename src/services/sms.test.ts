import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scheduleReminder, scheduleDispenseReminders, getPendingReminders, markReminderSent, markReminderFailed } from './sms';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: 'test-id' }, error: null })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          lte: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

describe('SMS Reminder Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scheduleReminder', () => {
    it('should schedule a reminder successfully', async () => {
      const reminder = {
        patientId: 'patient-1',
        medicationName: 'Amoxicillin',
        dosage: '500mg',
        scheduledAt: new Date('2025-10-24T10:00:00Z'),
        phoneNumber: '+2348012345678',
        message: 'Take your medication',
      };

      const id = await scheduleReminder(reminder);
      expect(id).toBe('test-id');
    });

    it('should handle errors', async () => {
      const { supabase } = await import('../lib/supabase');
      vi.mocked(supabase.from).mockReturnValueOnce({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'Error' } })),
          })),
        })),
      } as any);

      const reminder = {
        patientId: 'patient-1',
        medicationName: 'Test',
        dosage: '100mg',
        scheduledAt: new Date(),
        phoneNumber: '+234',
        message: 'Test',
      };

      await expect(scheduleReminder(reminder)).rejects.toThrow();
    });
  });

  describe('scheduleDispenseReminders', () => {
    it('should schedule multiple reminders based on frequency', async () => {
      await scheduleDispenseReminders(
        'dispense-1',
        'patient-1',
        '+2348012345678',
        'Amoxicillin',
        '500mg',
        '2x daily',
        3
      );

      const { supabase } = await import('../lib/supabase');
      expect(supabase.from).toHaveBeenCalled();
    });
  });

  describe('getPendingReminders', () => {
    it('should return pending reminders', async () => {
      const reminders = await getPendingReminders();
      expect(Array.isArray(reminders)).toBe(true);
    });
  });

  describe('markReminderSent', () => {
    it('should mark reminder as sent', async () => {
      await markReminderSent('reminder-1');

      const { supabase } = await import('../lib/supabase');
      expect(supabase.from).toHaveBeenCalledWith('medication_reminders');
    });
  });

  describe('markReminderFailed', () => {
    it('should mark reminder as failed with error message', async () => {
      await markReminderFailed('reminder-1', 'Network error');

      const { supabase } = await import('../lib/supabase');
      expect(supabase.from).toHaveBeenCalledWith('medication_reminders');
    });
  });
});
