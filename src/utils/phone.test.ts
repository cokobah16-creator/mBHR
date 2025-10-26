import { describe, it, expect } from 'vitest'
import { normalizePhone, formatPhoneForDisplay, isValidPhone, stripPhoneToDigits } from './phone'

describe('Phone Normalization Utils', () => {
  describe('normalizePhone', () => {
    it('should normalize Nigerian phone numbers starting with 0', () => {
      expect(normalizePhone('08031234567')).toBe('+2348031234567')
      expect(normalizePhone('07012345678')).toBe('+2347012345678')
      expect(normalizePhone('09087654321')).toBe('+2349087654321')
    })

    it('should normalize phone numbers already with country code', () => {
      expect(normalizePhone('2348031234567')).toBe('+2348031234567')
      expect(normalizePhone('+2348031234567')).toBe('+2348031234567')
    })

    it('should handle phone numbers with spaces and dashes', () => {
      expect(normalizePhone('0803 123 4567')).toBe('+2348031234567')
      expect(normalizePhone('0803-123-4567')).toBe('+2348031234567')
      expect(normalizePhone('0803 - 123 - 4567')).toBe('+2348031234567')
    })

    it('should handle phone numbers with parentheses and other separators', () => {
      expect(normalizePhone('(0803) 123-4567')).toBe('+2348031234567')
      expect(normalizePhone('0803.123.4567')).toBe('+2348031234567')
    })

    it('should return null for empty or invalid inputs', () => {
      expect(normalizePhone('')).toBe(null)
      expect(normalizePhone(null)).toBe(null)
      expect(normalizePhone(undefined)).toBe(null)
      expect(normalizePhone('   ')).toBe(null)
    })

    it('should handle international format', () => {
      expect(normalizePhone('+234 803 123 4567')).toBe('+2348031234567')
      expect(normalizePhone('+234-803-123-4567')).toBe('+2348031234567')
    })
  })

  describe('formatPhoneForDisplay', () => {
    it('should format E.164 numbers for display', () => {
      expect(formatPhoneForDisplay('+2348031234567')).toBe('0803 123 4567')
      expect(formatPhoneForDisplay('+2347012345678')).toBe('0701 234 5678')
    })

    it('should return empty string for null/undefined', () => {
      expect(formatPhoneForDisplay(null)).toBe('')
      expect(formatPhoneForDisplay(undefined)).toBe('')
      expect(formatPhoneForDisplay('')).toBe('')
    })

    it('should return original if not a valid Nigerian number', () => {
      expect(formatPhoneForDisplay('+14155551234')).toBe('+14155551234')
      expect(formatPhoneForDisplay('invalid')).toBe('invalid')
    })
  })

  describe('isValidPhone', () => {
    it('should validate correct Nigerian phone numbers', () => {
      expect(isValidPhone('08031234567')).toBe(true)
      expect(isValidPhone('+2348031234567')).toBe(true)
      expect(isValidPhone('2348031234567')).toBe(true)
      expect(isValidPhone('0803 123 4567')).toBe(true)
    })

    it('should reject invalid phone numbers', () => {
      expect(isValidPhone('123')).toBe(false)
      expect(isValidPhone('0803123')).toBe(false)
      expect(isValidPhone('+234803')).toBe(false)
      expect(isValidPhone('abcdefghij')).toBe(false)
      expect(isValidPhone('')).toBe(false)
      expect(isValidPhone(null)).toBe(false)
      expect(isValidPhone(undefined)).toBe(false)
    })

    it('should reject phone numbers that are too long', () => {
      expect(isValidPhone('080312345678901234')).toBe(false)
    })
  })

  describe('stripPhoneToDigits', () => {
    it('should strip phone numbers to digits only', () => {
      expect(stripPhoneToDigits('+2348031234567')).toBe('2348031234567')
      expect(stripPhoneToDigits('0803 123 4567')).toBe('08031234567')
      expect(stripPhoneToDigits('(080) 312-3456')).toBe('0803123456')
    })

    it('should return null for empty inputs', () => {
      expect(stripPhoneToDigits('')).toBe(null)
      expect(stripPhoneToDigits(null)).toBe(null)
      expect(stripPhoneToDigits(undefined)).toBe(null)
    })

    it('should handle special characters', () => {
      expect(stripPhoneToDigits('+234-803-123-4567')).toBe('2348031234567')
      expect(stripPhoneToDigits('+234 (803) 123-4567')).toBe('2348031234567')
    })
  })
})
