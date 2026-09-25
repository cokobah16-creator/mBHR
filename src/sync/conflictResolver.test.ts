import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveConflict } from './conflictResolver'
import { ConflictData } from '@/components/ConflictResolutionModal'
import { db } from '@/db'

vi.mock('@/db', () => ({
  db: {
    patients: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn()
    },
    patientAllergies: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn()
    }
  }
}))

type MockFn = ReturnType<typeof vi.fn>
const patients = db.patients as unknown as { get: MockFn; update: MockFn; put: MockFn }

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

    it('records the server version the decision was made against', async () => {
      await resolveConflict(mockConflict, 'keep-local', undefined, undefined, {
        id: 'patient-123',
        row_version: '12'
      })

      expect(db.patients.update).toHaveBeenCalledWith(
        'patient-123',
        expect.objectContaining({ _dirty: 1, _serverVersion: 12 })
      )
    })

    it('leaves the version alone when the server copy was not available', async () => {
      await resolveConflict(mockConflict, 'keep-local')

      const changes = patients.update.mock.calls[0][1] as Record<string, unknown>
      expect(changes).not.toHaveProperty('_serverVersion')
    })

    it('records the server updated_at the decision was made against', async () => {
      await resolveConflict(
        { ...mockConflict, entityType: 'patient_allergies', entityId: 'allergy-1' },
        'keep-local',
        undefined,
        undefined,
        { id: 'allergy-1', updated_at: '2024-01-01T11:30:00.123456+00:00' }
      )

      expect(db.patientAllergies.update).toHaveBeenCalledWith(
        'allergy-1',
        expect.objectContaining({
          _dirty: 1,
          _serverUpdatedAt: '2024-01-01T11:30:00.123456+00:00'
        })
      )
    })

    it('uses the updated_at the conflict was raised on when the server copy was not available', async () => {
      await resolveConflict(
        { ...mockConflict, entityType: 'patient_allergies', entityId: 'allergy-1' },
        'keep-local'
      )

      expect(db.patientAllergies.update).toHaveBeenCalledWith(
        'allergy-1',
        expect.objectContaining({ _serverUpdatedAt: '2024-01-01T11:00:00Z' })
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

    it('keeps fields that exist only on this device', async () => {
      patients.get.mockResolvedValueOnce({
        id: 'patient-123',
        givenName: 'John',
        nameKey: 'JN-T',
        mergeInto: 'patient-999',
        _dirty: 1
      })

      await resolveConflict(mockConflict, 'keep-remote', undefined, undefined, {
        id: 'patient-123',
        given_name: 'Jonathan',
        updated_at: '2024-01-01T11:00:00Z'
      })

      expect(db.patients.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'patient-123',
          givenName: 'Jonathan',
          nameKey: 'JN-T',
          mergeInto: 'patient-999',
          _dirty: 0
        })
      )
    })

    it('writes allergy conflicts to the local allergy table', async () => {
      const allergyConflict: ConflictData = {
        ...mockConflict,
        entityType: 'patient_allergies',
        entityId: 'allergy-1'
      }

      await resolveConflict(allergyConflict, 'keep-remote', undefined, undefined, {
        id: 'allergy-1',
        patient_id: 'patient-123',
        allergy_type: 'medication',
        updated_at: '2024-01-01T11:00:00Z'
      })

      expect(db.patientAllergies.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'allergy-1',
          patientId: 'patient-123',
          allergyType: 'medication',
          _dirty: 0
        })
      )
    })

    it('records the server updated_at of the copy it applied', async () => {
      await resolveConflict(mockConflict, 'keep-remote', undefined, undefined, {
        id: 'patient-123',
        given_name: 'Jonathan',
        updated_at: '2024-01-01T11:30:00.123456+00:00'
      })

      expect(db.patients.put).toHaveBeenCalledWith(
        expect.objectContaining({
          _dirty: 0,
          _serverUpdatedAt: '2024-01-01T11:30:00.123456+00:00'
        })
      )
    })

    it('throws if remote data is missing', async () => {
      await expect(resolveConflict(mockConflict, 'keep-remote')).rejects.toThrow(
        'Remote data not available'
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

      patients.update.mockResolvedValueOnce(1)

      await resolveConflict(
        mockConflict,
        'manual',
        resolution,
        localData,
        remoteData
      )

      // Updates only the chosen fields; a put would replace the whole record.
      expect(db.patients.update).toHaveBeenCalledWith(
        'patient-123',
        expect.objectContaining({
          givenName: 'John',
          phone: '08087654321',
          _dirty: 1,
          _syncedAt: null
        })
      )
      expect(db.patients.put).not.toHaveBeenCalled()
    })

    it('leaves fields that were not chosen untouched', async () => {
      patients.update.mockResolvedValueOnce(1)

      await resolveConflict(
        mockConflict,
        'manual',
        { phone: 'remote' },
        { id: 'patient-123', givenName: 'John', phone: '08012345678' },
        { id: 'patient-123', given_name: 'Jonathan', phone: '08087654321' }
      )

      const changes = patients.update.mock.calls[0][1] as Record<string, unknown>
      expect(changes.phone).toBe('08087654321')
      expect(changes).not.toHaveProperty('givenName')
      expect(changes).not.toHaveProperty('id')
    })

    it('records the server updated_at the choice was made against', async () => {
      patients.update.mockResolvedValueOnce(1)

      await resolveConflict(
        mockConflict,
        'manual',
        { phone: 'remote' },
        { id: 'patient-123', phone: '08012345678' },
        { id: 'patient-123', phone: '08087654321', updated_at: '2024-01-01T11:30:00Z' }
      )

      const changes = patients.update.mock.calls[0][1] as Record<string, unknown>
      expect(changes._serverUpdatedAt).toBe('2024-01-01T11:30:00Z')
    })

    it('fails when the record is no longer on this device', async () => {
      patients.update.mockResolvedValueOnce(0)

      await expect(
        resolveConflict(
          mockConflict,
          'manual',
          { phone: 'remote' },
          { id: 'patient-123', phone: '08012345678' },
          { id: 'patient-123', phone: '08087654321' }
        )
      ).rejects.toThrow('LocalRecordMissing')
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
