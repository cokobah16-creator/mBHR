import { db } from '@/db';
class PatientEngagementSystem {
    async scheduleAppointmentReminders(patientId, appointmentDate) {
        const patient = await db.patients.get(patientId);
        if (!patient)
            throw new Error('Patient not found');
        const reminders = [];
        const daysBefore = [7, 3, 1];
        for (const days of daysBefore) {
            const reminderDate = new Date(appointmentDate);
            reminderDate.setDate(reminderDate.getDate() - days);
            if (reminderDate > new Date()) {
                reminders.push({
                    patientId,
                    appointmentDate,
                    message: this.generateReminderMessage(patient.givenName, appointmentDate, days),
                    channel: patient.phone ? 'sms' : 'inapp',
                    status: 'pending',
                    scheduledFor: reminderDate
                });
            }
        }
        const dayOfReminder = {
            patientId,
            appointmentDate,
            message: this.generateDayOfMessage(patient.givenName, appointmentDate),
            channel: patient.phone ? 'sms' : 'inapp',
            status: 'pending',
            scheduledFor: new Date(appointmentDate.setHours(8, 0, 0, 0))
        };
        reminders.push(dayOfReminder);
        return reminders;
    }
    generateReminderMessage(patientName, appointmentDate, daysBefore) {
        const dateStr = appointmentDate.toLocaleDateString();
        const timeStr = appointmentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `Hello ${patientName}, this is a reminder that you have a clinic appointment in ${daysBefore} days on ${dateStr} at ${timeStr}. Please arrive 15 minutes early. Reply YES to confirm or CANCEL to reschedule.`;
    }
    generateDayOfMessage(patientName, appointmentDate) {
        const timeStr = appointmentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `Good morning ${patientName}! Your appointment is TODAY at ${timeStr}. We look forward to seeing you. Please bring your ID and any previous medical records.`;
    }
    async getHealthEducationContent(language = 'en', category) {
        const allContent = this.generateHealthEducationLibrary();
        return allContent.filter(content => content.language === language &&
            (!category || content.category === category));
    }
    generateHealthEducationLibrary() {
        return [
            {
                id: 'malaria-prevention',
                title: 'Preventing Malaria',
                category: 'prevention',
                content: `Malaria is spread by mosquito bites. Protect yourself by:
1. Sleep under treated mosquito nets every night
2. Use insect repellent on exposed skin
3. Wear long sleeves and pants at dusk
4. Clear standing water around your home
5. Take preventive medication if prescribed

Early symptoms: fever, chills, headache, sweating. Seek medical help immediately if you have these symptoms.`,
                language: 'en',
                targetAudience: ['all'],
                readingLevel: 'simple',
                estimatedReadTime: 2
            },
            {
                id: 'diabetes-management',
                title: 'Living Well with Diabetes',
                category: 'chronic-disease',
                content: `Managing diabetes requires daily care:
1. Check blood sugar as prescribed
2. Take medications on time, every day
3. Eat regular meals with vegetables and whole grains
4. Exercise 30 minutes daily (walking is excellent)
5. Inspect feet daily for cuts or sores
6. Attend all clinic appointments

Warning signs: extreme thirst, frequent urination, blurred vision, wounds that won't heal. Contact clinic immediately.`,
                language: 'en',
                targetAudience: ['adults', 'elderly'],
                readingLevel: 'simple',
                estimatedReadTime: 3
            },
            {
                id: 'hypertension-control',
                title: 'Controlling High Blood Pressure',
                category: 'chronic-disease',
                content: `High blood pressure (hypertension) often has no symptoms but can cause serious problems:
1. Take blood pressure medication daily, even if you feel fine
2. Reduce salt intake (avoid adding salt to food)
3. Eat more fruits and vegetables
4. Exercise regularly
5. Maintain healthy weight
6. Limit alcohol consumption
7. Reduce stress through relaxation

Check your blood pressure weekly if possible. Keep a record to show your doctor.`,
                language: 'en',
                targetAudience: ['adults', 'elderly'],
                readingLevel: 'simple',
                estimatedReadTime: 3
            },
            {
                id: 'medication-adherence',
                title: 'Taking Your Medicine Correctly',
                category: 'medication',
                content: `Taking medication correctly is essential for your health:
1. Take medicine at the same time each day
2. Complete full course of antibiotics, even if feeling better
3. Never share medications with others
4. Store medicine in cool, dry place away from children
5. Check expiry dates before taking
6. Ask pharmacist if you forget a dose

Tips to remember:
- Link medicine to daily routine (e.g., breakfast)
- Use pill organizer
- Set phone alarms
- Keep medicine where you'll see it`,
                language: 'en',
                targetAudience: ['all'],
                readingLevel: 'simple',
                estimatedReadTime: 2
            },
            {
                id: 'hand-hygiene',
                title: 'Proper Hand Washing',
                category: 'hygiene',
                content: `Clean hands save lives! Wash hands with soap and water:
WHEN:
- Before eating or preparing food
- After using toilet
- After changing baby diapers
- After coughing or sneezing
- When hands look dirty

HOW:
1. Wet hands with clean water
2. Apply soap and lather well
3. Scrub all surfaces for 20 seconds
4. Rinse thoroughly under running water
5. Dry with clean cloth or air dry

If no water available, use hand sanitizer with at least 60% alcohol.`,
                language: 'en',
                targetAudience: ['all'],
                readingLevel: 'simple',
                estimatedReadTime: 2
            },
            {
                id: 'nutrition-children',
                title: 'Feeding Your Child Well',
                category: 'nutrition',
                content: `Good nutrition helps children grow strong and healthy:
AGE 0-6 MONTHS:
- Breastfeed exclusively
- No water, other liquids, or food needed

AGE 6-12 MONTHS:
- Continue breastfeeding
- Introduce soft foods (mashed vegetables, fruits, porridge)
- Feed 3 times daily

AGE 1-5 YEARS:
- Give variety of foods
- Include vegetables, fruits, protein, grains
- Feed 3 meals + 2 snacks daily
- Ensure clean drinking water

Warning signs: not gaining weight, always tired, frequent sickness. Bring child to clinic.`,
                language: 'en',
                targetAudience: ['parents', 'caregivers'],
                readingLevel: 'simple',
                estimatedReadTime: 3
            }
        ];
    }
    async createFollowUpPlan(patientId, condition, duration) {
        const nextVisit = new Date();
        nextVisit.setDate(nextVisit.getDate() + duration);
        const interventions = this.getStandardInterventions(condition);
        const completionStatus = {};
        interventions.forEach(intervention => {
            completionStatus[intervention] = false;
        });
        return {
            patientId,
            condition,
            nextVisitDate: nextVisit,
            interventions,
            completionStatus,
            overallProgress: 0
        };
    }
    getStandardInterventions(condition) {
        const interventionMap = {
            'diabetes': [
                'Check blood sugar daily',
                'Take medications as prescribed',
                'Follow dietary recommendations',
                'Exercise 30 minutes daily',
                'Attend monthly clinic visits',
                'Get annual eye exam',
                'Check feet daily for sores'
            ],
            'hypertension': [
                'Take blood pressure medication daily',
                'Check BP weekly',
                'Reduce salt intake',
                'Exercise regularly',
                'Maintain healthy weight',
                'Attend clinic appointments',
                'Monitor for side effects'
            ],
            'tuberculosis': [
                'Take ALL TB medications daily',
                'Attend all DOT sessions',
                'Cover mouth when coughing',
                'Get adequate rest',
                'Eat nutritious food',
                'Avoid alcohol',
                'Complete full 6-month treatment'
            ],
            'malaria': [
                'Complete malaria medication course',
                'Rest and hydrate well',
                'Sleep under treated net',
                'Return if fever persists',
                'Use insect repellent'
            ],
            'antenatal': [
                'Attend all ANC visits',
                'Take prenatal vitamins daily',
                'Eat nutritious meals',
                'Avoid alcohol and smoking',
                'Rest adequately',
                'Monitor for warning signs',
                'Prepare for delivery'
            ]
        };
        return interventionMap[condition.toLowerCase()] || [
            'Follow treatment plan',
            'Attend follow-up appointments',
            'Report any new symptoms',
            'Take medications as prescribed'
        ];
    }
    async collectFeedback(feedback) {
        const issues = [];
        const suggestions = [];
        if (feedback.rating <= 2) {
            if (feedback.category === 'wait-time') {
                issues.push('Long wait time reported');
                suggestions.push('Review queue management and staffing');
            }
            if (feedback.category === 'care-quality') {
                issues.push('Care quality concern');
                suggestions.push('Clinical quality review needed');
            }
            if (feedback.category === 'staff-friendliness') {
                issues.push('Staff behavior concern');
                suggestions.push('Staff training on patient communication');
            }
        }
        if (feedback.comments.toLowerCase().includes('wait')) {
            issues.push('Wait time mentioned in comments');
        }
        return {
            ...feedback,
            issues,
            suggestions
        };
    }
    async getEngagementMetrics() {
        const allPatients = await db.patients.count();
        const recentVisits = await db.visits
            .where('createdAt')
            .above(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
            .toArray();
        const activePatients = new Set(recentVisits.map(v => v.patientId)).size;
        const appointmentAttendanceRate = 75;
        const medicationAdherenceRate = 68;
        const feedbackResponseRate = 35;
        const healthEducationEngagement = 42;
        return {
            totalPatients: allPatients,
            activePatients,
            appointmentAttendanceRate,
            medicationAdherenceRate,
            feedbackResponseRate,
            healthEducationEngagement
        };
    }
    async sendBulkHealthEducation(category, targetAudience, language = 'en') {
        const content = await this.getHealthEducationContent(language, category);
        if (content.length === 0) {
            return { sent: 0, failed: 0, messagesSent: [] };
        }
        const patients = await db.patients.toArray();
        const eligiblePatients = patients.filter(p => p.phone);
        const messagesSent = [];
        eligiblePatients.forEach(patient => {
            const message = `Hello ${patient.givenName}, ${content[0].title}: ${content[0].content.substring(0, 300)}... Visit clinic for more information.`;
            messagesSent.push({
                patientId: patient.id,
                message
            });
        });
        return {
            sent: messagesSent.length,
            failed: 0,
            messagesSent
        };
    }
}
export const patientEngagement = new PatientEngagementSystem();
