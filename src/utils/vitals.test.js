import { describe, it, expect } from 'vitest';
import { calculateBMI, flagVitals, getFlagColor, getFlagLabel } from './vitals';
describe('vitals utilities', () => {
    describe('calculateBMI', () => {
        it('should calculate BMI correctly for normal values', () => {
            const bmi = calculateBMI(70, 175);
            expect(bmi).toBeCloseTo(22.9, 1);
        });
        it('should return 0 for zero height', () => {
            expect(calculateBMI(70, 0)).toBe(0);
        });
        it('should return 0 for negative height', () => {
            expect(calculateBMI(70, -175)).toBe(0);
        });
        it('should return 0 for zero weight', () => {
            expect(calculateBMI(0, 175)).toBe(0);
        });
        it('should return 0 for negative weight', () => {
            expect(calculateBMI(-70, 175)).toBe(0);
        });
        it('should round to one decimal place', () => {
            const bmi = calculateBMI(68, 170);
            const decimalPlaces = (bmi.toString().split('.')[1] || '').length;
            expect(decimalPlaces).toBeLessThanOrEqual(1);
        });
        it('should calculate underweight BMI correctly', () => {
            const bmi = calculateBMI(45, 175);
            expect(bmi).toBeLessThan(18.5);
        });
        it('should calculate obese BMI correctly', () => {
            const bmi = calculateBMI(110, 175);
            expect(bmi).toBeGreaterThanOrEqual(30);
        });
    });
    describe('flagVitals', () => {
        describe('blood pressure flags', () => {
            it('should flag high BP when systolic >= 140', () => {
                const flags = flagVitals({ systolic: 140, diastolic: 80 });
                expect(flags).toContain('high_bp');
            });
            it('should flag high BP when diastolic >= 90', () => {
                const flags = flagVitals({ systolic: 120, diastolic: 90 });
                expect(flags).toContain('high_bp');
            });
            it('should flag low BP when systolic < 90', () => {
                const flags = flagVitals({ systolic: 85, diastolic: 70 });
                expect(flags).toContain('low_bp');
            });
            it('should flag low BP when diastolic < 60', () => {
                const flags = flagVitals({ systolic: 110, diastolic: 55 });
                expect(flags).toContain('low_bp');
            });
            it('should not flag normal BP', () => {
                const flags = flagVitals({ systolic: 120, diastolic: 80 });
                expect(flags).not.toContain('high_bp');
                expect(flags).not.toContain('low_bp');
            });
        });
        describe('temperature flags', () => {
            it('should flag high temperature >= 38.0', () => {
                const flags = flagVitals({ temperature: 38.0 });
                expect(flags).toContain('high_temp');
            });
            it('should flag low temperature < 35.0', () => {
                const flags = flagVitals({ temperature: 34.5 });
                expect(flags).toContain('low_temp');
            });
            it('should not flag normal temperature', () => {
                const flags = flagVitals({ temperature: 36.5 });
                expect(flags).not.toContain('high_temp');
                expect(flags).not.toContain('low_temp');
            });
        });
        describe('pulse flags', () => {
            it('should flag high pulse >= 100', () => {
                const flags = flagVitals({ pulse: 100 });
                expect(flags).toContain('high_pulse');
            });
            it('should flag low pulse < 60', () => {
                const flags = flagVitals({ pulse: 55 });
                expect(flags).toContain('low_pulse');
            });
            it('should not flag normal pulse', () => {
                const flags = flagVitals({ pulse: 72 });
                expect(flags).not.toContain('high_pulse');
                expect(flags).not.toContain('low_pulse');
            });
        });
        describe('SpO2 flags', () => {
            it('should flag low SpO2 < 95', () => {
                const flags = flagVitals({ spo2: 92 });
                expect(flags).toContain('low_spo2');
            });
            it('should not flag normal SpO2', () => {
                const flags = flagVitals({ spo2: 98 });
                expect(flags).not.toContain('low_spo2');
            });
            it('should not flag borderline SpO2 of 95', () => {
                const flags = flagVitals({ spo2: 95 });
                expect(flags).not.toContain('low_spo2');
            });
        });
        describe('BMI flags', () => {
            it('should flag low BMI < 18.5 (underweight)', () => {
                const flags = flagVitals({ bmi: 17.5 });
                expect(flags).toContain('low_bmi');
            });
            it('should flag high BMI >= 30 (obese)', () => {
                const flags = flagVitals({ bmi: 32 });
                expect(flags).toContain('high_bmi');
            });
            it('should not flag normal BMI', () => {
                const flags = flagVitals({ bmi: 24 });
                expect(flags).not.toContain('low_bmi');
                expect(flags).not.toContain('high_bmi');
            });
            it('should not flag overweight but non-obese BMI', () => {
                const flags = flagVitals({ bmi: 28 });
                expect(flags).not.toContain('high_bmi');
            });
        });
        describe('multiple flags', () => {
            it('should return multiple flags for critical patient', () => {
                const flags = flagVitals({
                    systolic: 180,
                    diastolic: 110,
                    temperature: 39.5,
                    pulse: 120,
                    spo2: 88,
                    bmi: 35
                });
                expect(flags).toContain('high_bp');
                expect(flags).toContain('high_temp');
                expect(flags).toContain('high_pulse');
                expect(flags).toContain('low_spo2');
                expect(flags).toContain('high_bmi');
                expect(flags.length).toBe(5);
            });
            it('should return empty array for healthy vitals', () => {
                const flags = flagVitals({
                    systolic: 120,
                    diastolic: 80,
                    temperature: 36.6,
                    pulse: 72,
                    spo2: 98,
                    bmi: 22
                });
                expect(flags).toHaveLength(0);
            });
        });
        describe('undefined values', () => {
            it('should handle all undefined values', () => {
                const flags = flagVitals({});
                expect(flags).toHaveLength(0);
            });
            it('should only check defined values', () => {
                const flags = flagVitals({ systolic: 150 });
                expect(flags).toContain('high_bp');
                expect(flags).toHaveLength(1);
            });
        });
    });
    describe('getFlagColor', () => {
        it('should return red colors for critical flags', () => {
            const criticalFlags = ['high_bp', 'low_bp', 'high_temp', 'low_temp', 'high_pulse', 'low_pulse', 'low_spo2'];
            criticalFlags.forEach(flag => {
                const color = getFlagColor(flag);
                expect(color).toContain('red');
            });
        });
        it('should return yellow colors for BMI flags', () => {
            expect(getFlagColor('low_bmi')).toContain('yellow');
            expect(getFlagColor('high_bmi')).toContain('yellow');
        });
        it('should return gray for unknown flags', () => {
            expect(getFlagColor('unknown_flag')).toContain('gray');
        });
    });
    describe('getFlagLabel', () => {
        it('should return correct labels for all flags', () => {
            expect(getFlagLabel('high_bp')).toBe('High BP');
            expect(getFlagLabel('low_bp')).toBe('Low BP');
            expect(getFlagLabel('high_temp')).toBe('Fever');
            expect(getFlagLabel('low_temp')).toBe('Hypothermia');
            expect(getFlagLabel('high_pulse')).toBe('High HR');
            expect(getFlagLabel('low_pulse')).toBe('Low HR');
            expect(getFlagLabel('low_spo2')).toBe('Low O2');
            expect(getFlagLabel('low_bmi')).toBe('Underweight');
            expect(getFlagLabel('high_bmi')).toBe('Obese');
        });
        it('should return flag name for unknown flags', () => {
            expect(getFlagLabel('unknown_flag')).toBe('unknown_flag');
        });
    });
});
