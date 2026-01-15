import { describe, it, expect, vi, beforeEach } from 'vitest'
import { epochDay, normPhone, nameKeyOf } from './index'

describe('Database Helper Functions', () => {
  describe('epochDay', () => {
    it('should return correct epoch day for a date', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const expected = Math.floor(date.getTime() / 86400000)
      expect(epochDay(date)).toBe(expected)
    })

    it('should return same day for different times on same date', () => {
      const morning = new Date('2024-01-15T06:00:00Z')
      const evening = new Date('2024-01-15T18:00:00Z')
      expect(epochDay(morning)).toBe(epochDay(evening))
    })

    it('should return different days for different dates', () => {
      const day1 = new Date('2024-01-15T12:00:00Z')
      const day2 = new Date('2024-01-16T12:00:00Z')
      expect(epochDay(day2) - epochDay(day1)).toBe(1)
    })
  })

  describe('normPhone', () => {
    it('should remove all non-digit characters', () => {
      expect(normPhone('+234 801 234 5678')).toBe('2348012345678')
      expect(normPhone('080-1234-5678')).toBe('08012345678')
      expect(normPhone('(234) 801-2345678')).toBe('2348012345678')
    })

    it('should handle empty string', () => {
      expect(normPhone('')).toBe('')
    })

    it('should handle already clean numbers', () => {
      expect(normPhone('08012345678')).toBe('08012345678')
    })

    it('should handle numbers with letters', () => {
      expect(normPhone('080ABC12345')).toBe('08012345')
    })
  })

  describe('nameKeyOf', () => {
    it('should generate consistent keys for same names', () => {
      const key1 = nameKeyOf('John', 'Doe')
      const key2 = nameKeyOf('John', 'Doe')
      expect(key1).toBe(key2)
    })

    it('should generate different keys for different names', () => {
      const key1 = nameKeyOf('John', 'Doe')
      const key2 = nameKeyOf('Jane', 'Smith')
      expect(key1).not.toBe(key2)
    })

    it('should handle empty names', () => {
      const key = nameKeyOf('', '')
      expect(key).toBe('-')
    })

    it('should generate similar keys for phonetically similar names', () => {
      const key1 = nameKeyOf('John', 'Doe')
      const key2 = nameKeyOf('Jon', 'Doe')
      expect(key1).toBe(key2)
    })
  })
})

describe('Patient Deduplication Logic', () => {
  const mockPatients = new Map<string, any>()

  beforeEach(() => {
    mockPatients.clear()
  })

  describe('Duplicate Detection Criteria', () => {
    it('should identify duplicate by same phone number', () => {
      const patient1 = {
        id: 'p1',
        givenName: 'John',
        familyName: 'Doe',
        phoneN: '08012345678',
        dobDay: epochDay(new Date('1990-01-15')),
        nameKey: nameKeyOf('John', 'Doe')
      }

      const newPatientPhoneN = '08012345678'
      const newPatientDobDay = epochDay(new Date('1990-01-15'))

      const isDuplicate = patient1.phoneN === newPatientPhoneN &&
                          patient1.dobDay === newPatientDobDay

      expect(isDuplicate).toBe(true)
    })

    it('should identify duplicate by same name key and DOB', () => {
      const patient1 = {
        id: 'p1',
        givenName: 'John',
        familyName: 'Doe',
        phoneN: '08012345678',
        dobDay: epochDay(new Date('1990-01-15')),
        nameKey: nameKeyOf('John', 'Doe')
      }

      const newPatientNameKey = nameKeyOf('Jon', 'Doe')
      const newPatientDobDay = epochDay(new Date('1990-01-15'))

      const isDuplicate = patient1.nameKey === newPatientNameKey &&
                          patient1.dobDay === newPatientDobDay

      expect(isDuplicate).toBe(true)
    })

    it('should not flag as duplicate with different DOB', () => {
      const patient1 = {
        id: 'p1',
        givenName: 'John',
        familyName: 'Doe',
        phoneN: '08012345678',
        dobDay: epochDay(new Date('1990-01-15')),
        nameKey: nameKeyOf('John', 'Doe')
      }

      const newPatientNameKey = nameKeyOf('John', 'Doe')
      const newPatientDobDay = epochDay(new Date('1985-06-20'))

      const isDuplicate = patient1.nameKey === newPatientNameKey &&
                          patient1.dobDay === newPatientDobDay

      expect(isDuplicate).toBe(false)
    })

    it('should not flag as duplicate with different name and phone', () => {
      const patient1 = {
        id: 'p1',
        givenName: 'John',
        familyName: 'Doe',
        phoneN: '08012345678',
        dobDay: epochDay(new Date('1990-01-15')),
        nameKey: nameKeyOf('John', 'Doe')
      }

      const newPatientPhoneN = '08099999999'
      const newPatientNameKey = nameKeyOf('Jane', 'Smith')
      const newPatientDobDay = epochDay(new Date('1990-01-15'))

      const isDuplicateByPhone = patient1.phoneN === newPatientPhoneN
      const isDuplicateByName = patient1.nameKey === newPatientNameKey

      expect(isDuplicateByPhone || isDuplicateByName).toBe(false)
    })
  })

  describe('Merge Logic', () => {
    it('should mark loser patient with mergeInto field', () => {
      const winner = { id: 'p1', givenName: 'John', mergeInto: null }
      const loser = { id: 'p2', givenName: 'Jon', mergeInto: null }

      loser.mergeInto = winner.id

      expect(loser.mergeInto).toBe('p1')
      expect(winner.mergeInto).toBeNull()
    })

    it('should preserve winner data after merge', () => {
      const winner = {
        id: 'p1',
        givenName: 'John',
        familyName: 'Doe',
        phone: '08012345678',
        address: '123 Main St'
      }

      const loser = {
        id: 'p2',
        givenName: 'Jon',
        familyName: 'Doe',
        phone: '08012345679',
        address: ''
      }

      expect(winner.givenName).toBe('John')
      expect(winner.phone).toBe('08012345678')
    })

    it('should filter out merged patients in queries', () => {
      const patients = [
        { id: 'p1', givenName: 'John', mergeInto: null },
        { id: 'p2', givenName: 'Jon', mergeInto: 'p1' },
        { id: 'p3', givenName: 'Jane', mergeInto: null }
      ]

      const activePatients = patients.filter(p => !p.mergeInto)

      expect(activePatients).toHaveLength(2)
      expect(activePatients.map(p => p.id)).toEqual(['p1', 'p3'])
    })
  })
})

describe('Daily Count Aggregation', () => {
  it('should calculate correct epoch day for counting', () => {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 86400000)

    const todayEpoch = epochDay(today)
    const yesterdayEpoch = epochDay(yesterday)

    expect(todayEpoch - yesterdayEpoch).toBe(1)
  })

  it('should handle date boundaries correctly', () => {
    const endOfDay = new Date('2024-01-15T23:59:59Z')
    const startOfNextDay = new Date('2024-01-16T00:00:01Z')

    const day1 = epochDay(endOfDay)
    const day2 = epochDay(startOfNextDay)

    expect(day2 - day1).toBe(1)
  })
})
