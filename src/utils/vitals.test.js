import { describe, it, expect } from 'vitest';
import { calculateBMI, flagVitals } from './vitals';
describe('Vitals Utilities', () => {
    describe('calculateBMI', () => {
        it('should calculate BMI correctly', () => {
            const bmi = calculateBMI(70, 175);
            expect(bmi).toBeCloseTo(22.86, 1);
        });
        it('should handle edge cases', () => {
            expect(calculateBMI(0, 175)).toBe(0);
            expect(calculateBMI(70, 0)).toBe(0);
            expect(calculateBMI(50, 150)).toBeCloseTo(22.22, 1);
        });
        it('should return correct BMI for various weights and heights', () => {
            expect(calculateBMI(80, 180)).toBeCloseTo(24.69, 1);
            expect(calculateBMI(60, 160)).toBeCloseTo(23.44, 1);
            expect(calculateBMI(100, 170)).toBeCloseTo(34.60, 1);
        });
    });
    describe('flagVitals', () => {
        it('should flag high blood pressure', () => {
            const flags = flagVitals({
                systolic: 150,
                diastolic: 95,
                pulse: 75,
                temperature: 37,
                spo2: 98,
                bmi: 22,
            });
            expect(flags).toContain('high_bp');
        });
        it('should flag low blood pressure', () => {
            const flags = flagVitals({
                systolic: 85,
                diastolic: 55,
                pulse: 75,
                temperature: 37,
                spo2: 98,
                bmi: 22,
            });
            expect(flags).toContain('low_bp');
        });
        it('should flag high temperature', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 75,
                temperature: 39,
                spo2: 98,
                bmi: 22,
            });
            expect(flags).toContain('high_temp');
        });
        it('should flag low temperature', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 75,
                temperature: 34,
                spo2: 98,
                bmi: 22,
            });
            expect(flags).toContain('low_temp');
        });
        it('should flag high pulse', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 105,
                temperature: 37,
                spo2: 98,
                bmi: 22,
            });
            expect(flags).toContain('high_pulse');
        });
        it('should flag low pulse', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 55,
                temperature: 37,
                spo2: 98,
                bmi: 22,
            });
            expect(flags).toContain('low_pulse');
        });
        it('should flag low oxygen saturation', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 75,
                temperature: 37,
                spo2: 92,
                bmi: 22,
            });
            expect(flags).toContain('low_spo2');
        });
        it('should flag high BMI', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 75,
                temperature: 37,
                spo2: 98,
                bmi: 32,
            });
            expect(flags).toContain('high_bmi');
        });
        it('should flag low BMI', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 75,
                temperature: 37,
                spo2: 98,
                bmi: 17,
            });
            expect(flags).toContain('low_bmi');
        });
        it('should return empty array for normal vitals', () => {
            const flags = flagVitals({
                systolic: 120,
                diastolic: 80,
                pulse: 75,
                temperature: 37,
                spo2: 98,
                bmi: 22,
            });
            expect(flags).toEqual([]);
        });
        it('should flag multiple abnormalities', () => {
            const flags = flagVitals({
                systolic: 150,
                diastolic: 95,
                pulse: 105,
                temperature: 39,
                spo2: 92,
                bmi: 32,
            });
            expect(flags.length).toBeGreaterThan(1);
            expect(flags).toContain('high_bp');
            expect(flags).toContain('high_pulse');
            expect(flags).toContain('high_temp');
            expect(flags).toContain('low_spo2');
            expect(flags).toContain('high_bmi');
        });
    });
});
