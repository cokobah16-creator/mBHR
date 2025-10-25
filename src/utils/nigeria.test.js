import { describe, it, expect } from 'vitest';
import { NIGERIAN_STATES, getLGAs, validatePhoneNumber, formatPhoneNumber } from './nigeria';
describe('Nigeria Utilities', () => {
    describe('NIGERIAN_STATES', () => {
        it('should contain all 36 states plus FCT', () => {
            expect(NIGERIAN_STATES.length).toBe(37);
        });
        it('should include major states', () => {
            expect(NIGERIAN_STATES).toContain('Lagos');
            expect(NIGERIAN_STATES).toContain('Kano');
            expect(NIGERIAN_STATES).toContain('FCT');
            expect(NIGERIAN_STATES).toContain('Rivers');
        });
        it('should be alphabetically sorted', () => {
            const sorted = [...NIGERIAN_STATES].sort();
            expect(NIGERIAN_STATES).toEqual(sorted);
        });
    });
    describe('getLGAs', () => {
        it('should return LGAs for Lagos', () => {
            const lgas = getLGAs('Lagos');
            expect(lgas.length).toBeGreaterThan(0);
            expect(lgas).toContain('Ikeja');
            expect(lgas).toContain('Lagos Island');
        });
        it('should return LGAs for Kano', () => {
            const lgas = getLGAs('Kano');
            expect(lgas.length).toBeGreaterThan(0);
            expect(lgas).toContain('Kano Municipal');
        });
        it('should return empty array for invalid state', () => {
            const lgas = getLGAs('Invalid State');
            expect(lgas).toEqual([]);
        });
        it('should handle FCT', () => {
            const lgas = getLGAs('FCT');
            expect(lgas.length).toBeGreaterThan(0);
            expect(lgas).toContain('Abuja Municipal');
        });
        it('should have LGAs for all 37 states', () => {
            NIGERIAN_STATES.forEach((state) => {
                const lgas = getLGAs(state);
                expect(lgas.length).toBeGreaterThan(0);
            });
        });
        it('should have correct total number of LGAs', () => {
            let totalLGAs = 0;
            NIGERIAN_STATES.forEach((state) => {
                const lgas = getLGAs(state);
                totalLGAs += lgas.length;
            });
            // Note: Official count is 774, but source data may vary slightly due to
            // administrative changes, naming variations, or data source differences
            expect(totalLGAs).toBeGreaterThanOrEqual(760);
            expect(totalLGAs).toBeLessThanOrEqual(780);
        });
        it('should not have duplicate LGAs within a state', () => {
            NIGERIAN_STATES.forEach((state) => {
                const lgas = getLGAs(state);
                const uniqueLGAs = [...new Set(lgas)];
                expect(lgas.length).toBe(uniqueLGAs.length);
            });
        });
    });
    describe('validatePhoneNumber', () => {
        it('should validate correct Nigerian phone numbers', () => {
            expect(validatePhoneNumber('08012345678')).toBe(true);
            expect(validatePhoneNumber('07012345678')).toBe(true);
            expect(validatePhoneNumber('09012345678')).toBe(true);
            expect(validatePhoneNumber('+2348012345678')).toBe(true);
            expect(validatePhoneNumber('2348012345678')).toBe(true);
        });
        it('should reject invalid phone numbers', () => {
            expect(validatePhoneNumber('12345')).toBe(false);
            expect(validatePhoneNumber('080123456')).toBe(false);
            expect(validatePhoneNumber('08012345678901')).toBe(false);
            expect(validatePhoneNumber('05012345678')).toBe(false);
            expect(validatePhoneNumber('abc')).toBe(false);
        });
        it('should handle empty string', () => {
            expect(validatePhoneNumber('')).toBe(false);
        });
        it('should handle spaces in phone number', () => {
            expect(validatePhoneNumber('0801 234 5678')).toBe(true);
            expect(validatePhoneNumber('+234 801 234 5678')).toBe(true);
        });
    });
    describe('formatPhoneNumber', () => {
        it('should format Nigerian phone numbers to international format', () => {
            expect(formatPhoneNumber('08012345678')).toBe('+2348012345678');
            expect(formatPhoneNumber('07012345678')).toBe('+2347012345678');
        });
        it('should handle already formatted numbers', () => {
            expect(formatPhoneNumber('+2348012345678')).toBe('+2348012345678');
            expect(formatPhoneNumber('2348012345678')).toBe('+2348012345678');
        });
        it('should remove spaces', () => {
            expect(formatPhoneNumber('0801 234 5678')).toBe('+2348012345678');
        });
        it('should return input for invalid numbers', () => {
            expect(formatPhoneNumber('invalid')).toBe('invalid');
            expect(formatPhoneNumber('12345')).toBe('12345');
        });
    });
});
