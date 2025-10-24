import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clinicalDecisionSupport } from './clinicalDecisionSupport';
import { db } from '@/db';
vi.mock('@/db', () => ({
    db: {
        patients: {
            get: vi.fn(),
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    reverse: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            toArray: vi.fn()
                        }))
                    }))
                }))
            }))
        },
        visits: {
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    reverse: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            toArray: vi.fn()
                        }))
                    }))
                }))
            }))
        },
        vitals: {
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    reverse: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            toArray: vi.fn()
                        }))
                    }))
                }))
            }))
        },
        consultations: {
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    reverse: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            toArray: vi.fn()
                        }))
                    }))
                }))
            }))
        },
        clinicalAlerts: {
            add: vi.fn(),
            where: vi.fn(() => ({
                equals: vi.fn(() => ({
                    reverse: vi.fn(() => ({
                        sortBy: vi.fn()
                    }))
                }))
            })),
            update: vi.fn()
        }
    }
}));
describe('Clinical Decision Support - Vitals Analysis', () => {
    it('should identify critical high fever', () => {
        const vitals = { tempC: 40.0 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.riskLevel).toBe('high');
        expect(analysis.urgentFlags).toContain('Temperature critically high');
        expect(analysis.concerns).toContain('High fever detected');
        expect(analysis.score).toBeGreaterThanOrEqual(3);
    });
    it('should identify hypertensive crisis', () => {
        const vitals = { systolic: 185, diastolic: 125 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.riskLevel).toBe('critical');
        expect(analysis.urgentFlags).toContain('Blood pressure dangerously high');
        expect(analysis.concerns).toContain('Hypertensive crisis');
    });
    it('should identify severe hypoxemia', () => {
        const vitals = { spo2: 88 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.riskLevel).toBe('critical');
        expect(analysis.urgentFlags).toContain('Oxygen saturation critically low');
        expect(analysis.recommendations).toContain('URGENT: Oxygen therapy required immediately');
    });
    it('should identify moderate fever', () => {
        const vitals = { tempC: 38.7 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.riskLevel).toBe('moderate');
        expect(analysis.concerns).toContain('Fever present');
        expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
    it('should identify stage 1 hypertension', () => {
        const vitals = { systolic: 145, diastolic: 92 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.riskLevel).toBe('moderate');
        expect(analysis.concerns).toContain('Stage 1 hypertension');
    });
    it('should identify tachycardia', () => {
        const vitals = { pulseBpm: 125 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.concerns).toContain('Tachycardia present');
    });
    it('should identify bradycardia', () => {
        const vitals = { pulseBpm: 45 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.concerns).toContain('Bradycardia detected');
    });
    it('should calculate BMI concerns for obesity', () => {
        const vitals = { bmi: 32 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.concerns).toContain('Obesity');
        expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
    it('should calculate BMI concerns for severe underweight', () => {
        const vitals = { bmi: 15.5 };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.concerns).toContain('Severe underweight');
    });
    it('should return low risk for normal vitals', () => {
        const vitals = {
            tempC: 37.0,
            pulseBpm: 75,
            systolic: 120,
            diastolic: 80,
            spo2: 98,
            bmi: 22
        };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.riskLevel).toBe('low');
        expect(analysis.concerns.length).toBe(0);
        expect(analysis.urgentFlags.length).toBe(0);
    });
    it('should handle multiple concerning vitals', () => {
        const vitals = {
            tempC: 39.0,
            systolic: 165,
            diastolic: 105,
            spo2: 92
        };
        const analysis = clinicalDecisionSupport.analyzeVitals(vitals);
        expect(analysis.riskLevel).toBe('critical');
        expect(analysis.score).toBeGreaterThanOrEqual(7);
        expect(analysis.concerns.length).toBeGreaterThanOrEqual(3);
    });
});
describe('Clinical Decision Support - Medication Adherence', () => {
    it('should predict good adherence for simple regimen', () => {
        const score = clinicalDecisionSupport.predictMedicationAdherence({
            patientId: 'patient-1',
            numberOfMedications: 2,
            dosageFrequency: '1x daily',
            chronicConditions: 1,
            age: 45
        });
        expect(score.adherenceScore).toBeGreaterThan(70);
        expect(score.followUpRecommended).toBe(false);
    });
    it('should predict poor adherence for polypharmacy', () => {
        const score = clinicalDecisionSupport.predictMedicationAdherence({
            patientId: 'patient-2',
            numberOfMedications: 8,
            dosageFrequency: '4x daily',
            chronicConditions: 3,
            age: 72,
            previousNonAdherence: true
        });
        expect(score.adherenceScore).toBeLessThan(70);
        expect(score.followUpRecommended).toBe(true);
        expect(score.riskFactors.length).toBeGreaterThan(3);
    });
    it('should penalize complex dosing schedules', () => {
        const simple = clinicalDecisionSupport.predictMedicationAdherence({
            patientId: 'p1',
            numberOfMedications: 3,
            dosageFrequency: '1x daily',
            chronicConditions: 1
        });
        const complex = clinicalDecisionSupport.predictMedicationAdherence({
            patientId: 'p2',
            numberOfMedications: 3,
            dosageFrequency: '4x daily',
            chronicConditions: 1
        });
        expect(simple.adherenceScore).toBeGreaterThan(complex.adherenceScore);
    });
    it('should provide interventions for high-risk patients', () => {
        const score = clinicalDecisionSupport.predictMedicationAdherence({
            patientId: 'patient-3',
            numberOfMedications: 6,
            dosageFrequency: '3x daily',
            chronicConditions: 2,
            distance: 'far from clinic'
        });
        expect(score.interventions.length).toBeGreaterThan(0);
        expect(score.interventions.some(i => i.includes('medication'))).toBe(true);
    });
});
describe('Clinical Decision Support - SOAP Suggestions', () => {
    it('should suggest questions for fever in subjective', () => {
        const suggestions = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'subjective',
            partialText: 'Patient complains of fever for 3 days'
        });
        expect(suggestions.suggestions.length).toBeGreaterThan(0);
        expect(suggestions.keywords).toContain('fever');
    });
    it('should suggest questions for pain in subjective', () => {
        const suggestions = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'subjective',
            partialText: 'Chest pain since morning'
        });
        expect(suggestions.suggestions.some(s => s.includes('Location'))).toBe(true);
        expect(suggestions.suggestions.some(s => s.includes('Severity'))).toBe(true);
    });
    it('should suggest physical exam findings for objective', () => {
        const suggestions = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'objective',
            partialText: ''
        });
        expect(suggestions.suggestions.length).toBeGreaterThan(0);
        expect(suggestions.suggestions.some(s => s.includes('alert'))).toBe(true);
    });
    it('should suggest diagnoses for assessment based on symptoms', () => {
        const suggestions = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'assessment',
            partialText: 'fever, cough, body aches'
        });
        expect(suggestions.suggestions.length).toBeGreaterThan(0);
        expect(suggestions.keywords.length).toBeGreaterThan(0);
    });
    it('should suggest malaria treatment in plan', () => {
        const suggestions = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'plan',
            partialText: 'malaria diagnosis confirmed'
        });
        expect(suggestions.suggestions.some(s => s.includes('ACT') || s.includes('Antimalarial'))).toBe(true);
    });
    it('should suggest hypertension management in plan', () => {
        const suggestions = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'plan',
            partialText: 'hypertension stage 2'
        });
        expect(suggestions.suggestions.some(s => s.toLowerCase().includes('antihypertensive'))).toBe(true);
        expect(suggestions.suggestions.some(s => s.toLowerCase().includes('lifestyle'))).toBe(true);
    });
    it('should provide confidence scores', () => {
        const withKeywords = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'assessment',
            partialText: 'fever and headache present'
        });
        const withoutKeywords = clinicalDecisionSupport.generateSOAPSuggestions({
            section: 'assessment',
            partialText: 'xyz'
        });
        expect(withKeywords.confidence).toBeGreaterThan(withoutKeywords.confidence);
    });
});
describe('Clinical Decision Support - Clinical Alerts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it('should create clinical alert', async () => {
        ;
        db.clinicalAlerts.add.mockResolvedValue('alert-123');
        const alertId = await clinicalDecisionSupport.createClinicalAlert({
            patientId: 'patient-1',
            alertType: 'vital_sign',
            severity: 'high',
            message: 'Abnormal vital signs',
            details: 'BP elevated'
        });
        expect(alertId).toBeTruthy();
        expect(db.clinicalAlerts.add).toHaveBeenCalled();
    });
    it('should generate alerts for critical vitals', async () => {
        ;
        db.clinicalAlerts.add.mockResolvedValue('alert-456');
        const vitals = { tempC: 40.5, systolic: 190 };
        await clinicalDecisionSupport.generateAlertsForVitals('patient-1', vitals);
        expect(db.clinicalAlerts.add).toHaveBeenCalled();
    });
    it('should not generate alerts for normal vitals', async () => {
        const vitals = {
            tempC: 37.0,
            systolic: 120,
            diastolic: 80,
            pulseBpm: 75
        };
        await clinicalDecisionSupport.generateAlertsForVitals('patient-1', vitals);
        expect(db.clinicalAlerts.add).not.toHaveBeenCalled();
    });
});
