import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveConflict } from './conflictResolver'
import { ConflictData } from '@/components/ConflictResolutionModal'
import { db } from '@/db'

vi.mock('@/db', () => ({
  db: {
    patients: {
      update: vi.fn(),
      put: vi.fn()
    }
  }
}))

describe('Conflict Resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockConflict: ConflictData = {
    entityType: 'patients',
    entityId: 'patient-123',
    localTimestamp: '2024-01-01T10:00:00Z',
    remoteTimestamp: '2024-01-01T11:00:00Z',
    conflicts: [
      {
        field: 'givenName',
        label: 'Given Name',
        localValue: 'John',
        remoteValue: 'Jonathan',
        type: 'string'
      },
      {
        field: 'phone',
        label: 'Phone',
        localValue: '08012345678',
        remoteValue: '08087654321',
        type: 'string'
      }
    ]
  }

  describe('keep-local strategy', () => {
    it('should mark local record as dirty to force sync', async () => {
      await resolveConflict(mockConflict, 'keep-local')

      expect(db.patients.update).toHaveBeenCalledWith(
        'patient-123',
        expect.objectContaining({
          _dirty: 1,
          _syncedAt: null
        })
      )
    })
  })

  describe('keep-remote strategy', () => {
    it('should update local record with remote data', async () => {
      const remoteData = {
        id: 'patient-123',
        given_name: 'Jonathan',
        family_name: 'Doe',
        phone: '08087654321',
        updated_at: '2024-01-01T11:00:00Z'
      }

      await resolveConflict(
        mockConflict,
        'keep-remote',
        undefined,
        undefined,
        remoteData
      )

      expect(db.patients.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'patient-123',
          givenName: 'Jonathan',
          phone: '08087654321',
          _dirty: 0,
          _syncedAt: expect.any(String)
        })
      )
    })
  })

  describe('manual strategy', () => {
    it('should merge fields based on manual resolution', async () => {
      const localData = {
        id: 'patient-123',
        givenName: 'John',
        familyName: 'Doe',
        phone: '08012345678'
      }

      const remoteData = {
        id: 'patient-123',
        given_name: 'Jonathan',
        family_name: 'Doe',
        phone: '08087654321'
      }

      const resolution = {
        givenName: 'local' as const,
        phone: 'remote' as const
      }

      await resolveConflict(
        mockConflict,
        'manual',
        resolution,
        localData,
        remoteData
      )

      expect(db.patients.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'patient-123',
          givenName: 'John',
          phone: '08087654321',
          _dirty: 1
        })
      )
    })

    it('should throw error if local or remote data missing', async () => {
      await expect(
        resolveConflict(mockConflict, 'manual', {})
      ).rejects.toThrow('Both local and remote data required')
    })
  })

  describe('field mapping', () => {
    it('should convert snake_case to camelCase', () => {
      const snakeCase = 'given_name'
      const expected = 'givenName'

      const camelCase = snakeCase.replace(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      )

      expect(camelCase).toBe(expected)
    })

    it('should convert camelCase to snake_case', () => {
      const camelCase = 'givenName'
      const expected = 'given_name'

      const snakeCase = camelCase.replace(
        /[A-Z]/g,
        letter => `_${letter.toLowerCase()}`
      )

      expect(snakeCase).toBe(expected)
    })
  })

  describe('conflict data validation', () => {
    it('should handle missing conflicts array', () => {
      const invalidConflict = {
        ...mockConflict,
        conflicts: []
      }

      expect(invalidConflict.conflicts).toHaveLength(0)
    })

    it('should handle different field types', () => {
      const typedConflict: ConflictData = {
        entityType: 'vitals',
        entityId: 'vital-123',
        localTimestamp: '2024-01-01T10:00:00Z',
        remoteTimestamp: '2024-01-01T11:00:00Z',
        conflicts: [
          {
            field: 'heightCm',
            label: 'Height',
            localValue: 170,
            remoteValue: 175,
            type: 'number'
          },
          {
            field: 'takenAt',
            label: 'Taken At',
            localValue: new Date('2024-01-01'),
            remoteValue: new Date('2024-01-02'),
            type: 'date'
          },
          {
            field: 'flags',
            label: 'Flags',
            localValue: { high_bp: true },
            remoteValue: { high_bp: false },
            type: 'object'
          }
        ]
      }

      expect(typedConflict.conflicts).toHaveLength(3)
      expect(typedConflict.conflicts[0].type).toBe('number')
      expect(typedConflict.conflicts[1].type).toBe('date')
      expect(typedConflict.conflicts[2].type).toBe('object')
    })
  })
})
