import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getPatientDashboard,
  getPatientMedicalHistory,
  getVisitDetails,
  getPatientNotifications,
  markNotificationAsRead,
  getPatientMessages,
  sendMessage,
  markMessageAsRead
} from './patientPortalData'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null }))
        })),
        order: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
        })),
        range: vi.fn(() => Promise.resolve({ data: [], error: null })),
        limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: {}, error: null }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null }))
      }))
    }))
  }
}))

vi.mock('@/lib/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn()
}))

describe('Patient Portal Data Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getPatientDashboard', () => {
    it('should return dashboard data for patient', async () => {
      const result = await getPatientDashboard('portal-user-id', 'patient-id')

      expect(result).toBeNull()
    })
  })

  describe('getPatientMedicalHistory', () => {
    it('should return medical history with pagination', async () => {
      const result = await getPatientMedicalHistory('portal-user-id', 'patient-id', 10, 0)

      expect(result).toBeDefined()
    })
  })

  describe('getVisitDetails', () => {
    it('should return visit details', async () => {
      const result = await getVisitDetails('portal-user-id', 'patient-id', 'visit-id')

      expect(result).toBeNull()
    })
  })

  describe('getPatientNotifications', () => {
    it('should return all notifications', async () => {
      const result = await getPatientNotifications('portal-user-id', 'patient-id', false)

      expect(result).toEqual([])
    })

    it('should return only unread notifications', async () => {
      const result = await getPatientNotifications('portal-user-id', 'patient-id', true)

      expect(result).toEqual([])
    })
  })

  describe('markNotificationAsRead', () => {
    it('should mark notification as read', async () => {
      const result = await markNotificationAsRead('portal-user-id', 'patient-id', 'notification-id')

      expect(result).toBe(true)
    })
  })

  describe('getPatientMessages', () => {
    it('should return all messages', async () => {
      const result = await getPatientMessages('portal-user-id', 'patient-id', false)

      expect(result).toEqual([])
    })

    it('should return only unread messages', async () => {
      const result = await getPatientMessages('portal-user-id', 'patient-id', true)

      expect(result).toEqual([])
    })
  })

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const result = await sendMessage(
        'portal-user-id',
        'patient-id',
        'Test Subject',
        'Test message body',
        'normal'
      )

      expect(result).toBeNull()
    })

    it('should send message with parent for threading', async () => {
      const result = await sendMessage(
        'portal-user-id',
        'patient-id',
        'Re: Test Subject',
        'Reply message',
        'normal',
        'parent-message-id'
      )

      expect(result).toBeNull()
    })
  })

  describe('markMessageAsRead', () => {
    it('should mark message as read', async () => {
      const result = await markMessageAsRead('portal-user-id', 'patient-id', 'message-id')

      expect(result).toBe(true)
    })
  })
})
