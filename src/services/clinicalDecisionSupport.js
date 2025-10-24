import { db } from '@/db';
class ClinicalDecisionSupportService {
    analyzeVitals(vitals) {
        const concerns = [];
        const recommendations = [];
        const urgentFlags = [];
        let score = 0;
        if (vitals.tempC) {
            if (vitals.tempC >= 39.5) {
                concerns.push('High fever detected');
                recommendations.push('Immediate cooling measures and antipyretics');
                urgentFlags.push('Temperature critically high');
                score += 3;
            }
            else if (vitals.tempC >= 38.5) {
                concerns.push('Fever present');
                recommendations.push('Monitor temperature, consider antipyretics');
                score += 2;
            }
            else if (vitals.tempC < 36.0) {
                concerns.push('Hypothermia detected');
                recommendations.push('Warming measures needed');
                urgentFlags.push('Temperature critically low');
                score += 3;
            }
        }
        if (vitals.systolic && vitals.diastolic) {
            if (vitals.systolic >= 180 || vitals.diastolic >= 120) {
                concerns.push('Hypertensive crisis');
                recommendations.push('URGENT: Immediate medical intervention required');
                urgentFlags.push('Blood pressure dangerously high');
                score += 4;
            }
            else if (vitals.systolic >= 160 || vitals.diastolic >= 100) {
                concerns.push('Stage 2 hypertension');
                recommendations.push('Antihypertensive medication recommended, lifestyle counseling');
                score += 3;
            }
            else if (vitals.systolic >= 140 || vitals.diastolic >= 90) {
                concerns.push('Stage 1 hypertension');
                recommendations.push('Monitor BP, consider medication if persistent');
                score += 2;
            }
            else if (vitals.systolic < 90 || vitals.diastolic < 60) {
                concerns.push('Hypotension detected');
                recommendations.push('Assess for dehydration or shock');
                urgentFlags.push('Low blood pressure');
                score += 3;
            }
        }
        if (vitals.pulseBpm) {
            if (vitals.pulseBpm > 120) {
                concerns.push('Tachycardia present');
                recommendations.push('Assess for anxiety, infection, dehydration, or cardiac issues');
                score += 2;
            }
            else if (vitals.pulseBpm < 50) {
                concerns.push('Bradycardia detected');
                recommendations.push('Check medications, assess cardiovascular status');
                score += 2;
            }
            else if (vitals.pulseBpm > 100) {
                concerns.push('Elevated heart rate');
                recommendations.push('Monitor and reassess after rest');
                score += 1;
            }
        }
        if (vitals.spo2) {
            if (vitals.spo2 < 90) {
                concerns.push('Severe hypoxemia');
                recommendations.push('URGENT: Oxygen therapy required immediately');
                urgentFlags.push('Oxygen saturation critically low');
                score += 4;
            }
            else if (vitals.spo2 < 94) {
                concerns.push('Mild hypoxemia');
                recommendations.push('Consider supplemental oxygen, assess respiratory function');
                score += 2;
            }
        }
        if (vitals.bmi) {
            if (vitals.bmi < 16) {
                concerns.push('Severe underweight');
                recommendations.push('Nutritional assessment and intervention needed');
                score += 2;
            }
            else if (vitals.bmi < 18.5) {
                concerns.push('Underweight');
                recommendations.push('Nutritional counseling recommended');
                score += 1;
            }
            else if (vitals.bmi >= 35) {
                concerns.push('Class II Obesity');
                recommendations.push('Weight management program, screen for metabolic syndrome');
                score += 2;
            }
            else if (vitals.bmi >= 30) {
                concerns.push('Obesity');
                recommendations.push('Lifestyle counseling, dietary modification');
                score += 1;
            }
        }
        const riskLevel = score >= 4 ? 'critical' : score >= 3 ? 'high' : score >= 2 ? 'moderate' : 'low';
        return {
            riskLevel,
            concerns,
            recommendations,
            urgentFlags,
            score
        };
    }
    async assessPatientRisk(patientId) {
        const patient = await db.patients.get(patientId);
        if (!patient)
            throw new Error('Patient not found');
        const recentVisits = await db.visits
            .where('patientId')
            .equals(patientId)
            .reverse()
            .limit(5)
            .toArray();
        const recentVitals = await db.vitals
            .where('patientId')
            .equals(patientId)
            .reverse()
            .limit(10)
            .toArray();
        const recentConsultations = await db.consultations
            .where('patientId')
            .equals(patientId)
            .reverse()
            .limit(10)
            .toArray();
        const riskFactors = [];
        const predictedComplications = [];
        const recommendedActions = [];
        if (patient.dob) {
            const age = Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
            if (age >= 65) {
                riskFactors.push({
                    factor: 'Advanced Age',
                    severity: 'moderate',
                    description: 'Elderly patients require closer monitoring'
                });
                recommendedActions.push('Comprehensive geriatric assessment');
            }
            if (age < 5) {
                riskFactors.push({
                    factor: 'Pediatric Patient',
                    severity: 'moderate',
                    description: 'Young children require specialized care'
                });
                recommendedActions.push('Growth and development monitoring');
            }
        }
        let abnormalVitalsCount = 0;
        recentVitals.forEach(vital => {
            const analysis = this.analyzeVitals(vital);
            if (analysis.riskLevel === 'high' || analysis.riskLevel === 'critical') {
                abnormalVitalsCount++;
            }
        });
        if (abnormalVitalsCount >= 3) {
            riskFactors.push({
                factor: 'Persistent Abnormal Vitals',
                severity: 'high',
                description: 'Multiple readings show concerning vital signs'
            });
            predictedComplications.push('Cardiovascular events', 'Metabolic decompensation');
            recommendedActions.push('Immediate physician review', 'Consider referral to specialist');
        }
        const diagnosisKeywords = ['diabetes', 'hypertension', 'hiv', 'tuberculosis', 'malaria', 'heart', 'kidney', 'liver'];
        const chronicConditions = recentConsultations.filter(c => diagnosisKeywords.some(keyword => c.provisionalDx.some(dx => dx.toLowerCase().includes(keyword))));
        if (chronicConditions.length >= 2) {
            riskFactors.push({
                factor: 'Multiple Chronic Conditions',
                severity: 'high',
                description: 'Comorbidities increase complexity of care'
            });
            predictedComplications.push('Drug interactions', 'Disease progression');
            recommendedActions.push('Medication review', 'Coordinated care plan');
        }
        const visitFrequency = recentVisits.length;
        if (visitFrequency >= 4) {
            riskFactors.push({
                factor: 'Frequent Healthcare Utilization',
                severity: 'moderate',
                description: 'Multiple visits may indicate uncontrolled condition'
            });
            recommendedActions.push('Review treatment effectiveness', 'Assess social determinants of health');
        }
        const overallRisk = riskFactors.some(rf => rf.severity === 'high') ? 'high' :
            riskFactors.some(rf => rf.severity === 'moderate') ? 'moderate' : 'low';
        return {
            patientId,
            overallRisk,
            riskFactors,
            predictedComplications,
            recommendedActions,
            lastAssessment: new Date()
        };
    }
    predictMedicationAdherence(patientData) {
        let adherenceScore = 100;
        const riskFactors = [];
        const interventions = [];
        if (patientData.numberOfMedications > 5) {
            adherenceScore -= 15;
            riskFactors.push('Polypharmacy (>5 medications)');
            interventions.push('Simplify medication regimen if possible', 'Provide medication organizer');
        }
        if (patientData.dosageFrequency.includes('4') || patientData.dosageFrequency.toLowerCase().includes('qid')) {
            adherenceScore -= 20;
            riskFactors.push('Complex dosing schedule (4x daily)');
            interventions.push('Consider once or twice daily alternatives');
        }
        else if (patientData.dosageFrequency.includes('3') || patientData.dosageFrequency.toLowerCase().includes('tid')) {
            adherenceScore -= 15;
            riskFactors.push('Moderate dosing complexity (3x daily)');
            interventions.push('Simplify to twice daily if possible');
        }
        if (patientData.age && patientData.age >= 65) {
            adherenceScore -= 10;
            riskFactors.push('Advanced age may affect medication management');
            interventions.push('Engage family caregiver', 'Large print labels');
        }
        if (patientData.chronicConditions >= 3) {
            adherenceScore -= 10;
            riskFactors.push('Multiple chronic conditions');
            interventions.push('Comprehensive medication review', 'Patient education on each condition');
        }
        if (patientData.previousNonAdherence) {
            adherenceScore -= 25;
            riskFactors.push('History of non-adherence');
            interventions.push('Address barriers identified in previous episodes', 'Consider adherence support program');
        }
        if (patientData.distance && (patientData.distance.includes('far') || patientData.distance.includes('remote'))) {
            adherenceScore -= 10;
            riskFactors.push('Geographic barriers to follow-up');
            interventions.push('Provide extended medication supply', 'Schedule community follow-up');
        }
        adherenceScore = Math.max(0, Math.min(100, adherenceScore));
        const followUpRecommended = adherenceScore < 70 || riskFactors.length >= 3;
        if (followUpRecommended) {
            interventions.push('Schedule follow-up within 2 weeks', 'SMS medication reminders');
        }
        return {
            patientId: patientData.patientId,
            adherenceScore,
            riskFactors,
            interventions,
            followUpRecommended
        };
    }
    generateSOAPSuggestions(input) {
        const suggestions = [];
        const keywords = [];
        const text = input.partialText.toLowerCase();
        if (input.section === 'subjective') {
            const commonSymptoms = [
                { keyword: 'fever', suggestions: ['Duration of fever?', 'Associated chills or night sweats?', 'Pattern: continuous or intermittent?'] },
                { keyword: 'pain', suggestions: ['Location and radiation?', 'Character: sharp, dull, burning?', 'Severity (1-10)?', 'Aggravating/relieving factors?'] },
                { keyword: 'cough', suggestions: ['Productive or dry?', 'Duration?', 'Hemoptysis present?', 'Associated dyspnea?'] },
                { keyword: 'headache', suggestions: ['Location?', 'Quality: throbbing, pressure, stabbing?', 'Associated visual changes or nausea?', 'Photophobia?'] },
                { keyword: 'diarrhea', suggestions: ['Frequency?', 'Consistency?', 'Blood or mucus present?', 'Associated cramping or fever?'] },
                { keyword: 'vomit', suggestions: ['Frequency?', 'Contents: food, bile, blood?', 'Associated with eating?', 'Dehydration signs?'] }
            ];
            commonSymptoms.forEach(symptom => {
                if (text.includes(symptom.keyword)) {
                    suggestions.push(...symptom.suggestions);
                    keywords.push(symptom.keyword);
                }
            });
            if (suggestions.length === 0) {
                suggestions.push('Chief complaint and duration', 'Associated symptoms', 'Previous similar episodes', 'Home remedies tried', 'Impact on daily activities');
            }
        }
        if (input.section === 'objective') {
            if (input.vitalSigns) {
                const analysis = this.analyzeVitals(input.vitalSigns);
                if (analysis.concerns.length > 0) {
                    suggestions.push(`Vital signs: ${analysis.concerns.join(', ')}`);
                }
            }
            const systemReviews = [
                'General: alert, oriented, no acute distress',
                'HEENT: normocephalic, atraumatic',
                'Cardiovascular: regular rate and rhythm',
                'Respiratory: clear to auscultation bilaterally',
                'Abdomen: soft, non-tender, non-distended',
                'Extremities: no edema, good peripheral pulses',
                'Skin: warm, dry, intact',
                'Neurological: cranial nerves II-XII grossly intact'
            ];
            if (text.length < 20) {
                suggestions.push(...systemReviews.slice(0, 4));
            }
        }
        if (input.section === 'assessment') {
            const commonDiagnoses = [
                { keywords: ['fever', 'cough'], dx: 'Upper respiratory tract infection', icd: 'J06.9' },
                { keywords: ['fever', 'headache', 'body'], dx: 'Malaria, uncomplicated', icd: 'B54' },
                { keywords: ['diarrhea', 'vomit'], dx: 'Gastroenteritis', icd: 'A09' },
                { keywords: ['high', 'blood pressure'], dx: 'Essential hypertension', icd: 'I10' },
                { keywords: ['diabetes', 'sugar'], dx: 'Type 2 diabetes mellitus', icd: 'E11' },
                { keywords: ['pain', 'joint'], dx: 'Arthralgia', icd: 'M25.5' },
                { keywords: ['skin', 'rash'], dx: 'Dermatitis', icd: 'L30.9' }
            ];
            commonDiagnoses.forEach(diagnosis => {
                if (diagnosis.keywords.some(kw => text.includes(kw))) {
                    suggestions.push(`${diagnosis.dx} (${diagnosis.icd})`);
                    keywords.push(...diagnosis.keywords);
                }
            });
            if (suggestions.length === 0) {
                suggestions.push('Primary diagnosis with ICD code', 'Differential diagnoses to consider', 'Rule out serious conditions');
            }
        }
        if (input.section === 'plan') {
            if (text.includes('malaria')) {
                suggestions.push('Antimalarial: ACT (artemether-lumefantrine) for 3 days', 'Antipyretic: Paracetamol 1g TID', 'Hydration: Oral fluids, avoid dehydration', 'Follow-up: 3 days if symptoms persist');
            }
            else if (text.includes('hypertension')) {
                suggestions.push('Antihypertensive: Amlodipine 5mg daily OR Lisinopril 10mg daily', 'Lifestyle: Low salt diet, exercise, weight loss', 'Monitor: Home BP monitoring', 'Follow-up: 2 weeks to assess response');
            }
            else if (text.includes('diabetes')) {
                suggestions.push('Metformin 500mg BID with meals', 'Diet: Low sugar, high fiber', 'Exercise: 30 min daily walking', 'Monitor: Fasting blood sugar', 'Follow-up: 4 weeks with lab results');
            }
            else if (text.includes('infection') || text.includes('bacteria')) {
                suggestions.push('Antibiotic: Amoxicillin 500mg TID for 5-7 days', 'Symptomatic relief medications', 'Rest and hydration', 'Follow-up: If no improvement in 3 days');
            }
            else {
                suggestions.push('Medications with dosage and duration', 'Non-pharmacological interventions', 'Patient education', 'Follow-up plan', 'Red flag symptoms to watch for');
            }
        }
        const confidence = keywords.length > 0 ? 0.8 : 0.5;
        return {
            section: input.section,
            suggestions: [...new Set(suggestions)].slice(0, 8),
            keywords,
            confidence
        };
    }
    async createClinicalAlert(alert) {
        const newAlert = {
            ...alert,
            id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            createdAt: new Date(),
            acknowledged: false
        };
        await db.clinicalAlerts.add(newAlert);
        return newAlert.id;
    }
    async getPatientAlerts(patientId, unacknowledgedOnly = false) {
        let query = db.clinicalAlerts.where('patientId').equals(patientId);
        const alerts = await query.reverse().sortBy('createdAt');
        if (unacknowledgedOnly) {
            return alerts.filter(a => !a.acknowledged);
        }
        return alerts;
    }
    async acknowledgeAlert(alertId, userId) {
        await db.clinicalAlerts.update(alertId, {
            acknowledged: true,
            acknowledgedBy: userId,
            acknowledgedAt: new Date()
        });
    }
    async generateAlertsForVitals(patientId, vitals) {
        const analysis = this.analyzeVitals(vitals);
        if (analysis.urgentFlags.length > 0) {
            for (const flag of analysis.urgentFlags) {
                await this.createClinicalAlert({
                    patientId,
                    alertType: 'vital_sign',
                    severity: 'critical',
                    message: flag,
                    details: `Vital signs analysis: ${analysis.concerns.join(', ')}`
                });
            }
        }
        else if (analysis.riskLevel === 'high') {
            await this.createClinicalAlert({
                patientId,
                alertType: 'vital_sign',
                severity: 'high',
                message: 'Concerning vital signs detected',
                details: analysis.concerns.join(', ')
            });
        }
    }
    async generateHighRiskAlert(patientId, riskProfile) {
        if (riskProfile.overallRisk === 'high' || riskProfile.overallRisk === 'critical') {
            await this.createClinicalAlert({
                patientId,
                alertType: 'high_risk',
                severity: riskProfile.overallRisk === 'critical' ? 'critical' : 'high',
                message: 'High-risk patient identified',
                details: `Risk factors: ${riskProfile.riskFactors.map(rf => rf.factor).join(', ')}. Recommended actions: ${riskProfile.recommendedActions.join(', ')}`
            });
        }
    }
}
export const clinicalDecisionSupport = new ClinicalDecisionSupportService();
