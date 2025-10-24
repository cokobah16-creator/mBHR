import { db, generateId } from './index';
import logger from '@/lib/logger';
const VITALS_RANGES = [
    // Heart Rate (HR) - beats per minute
    // Newborns and Infants
    { ageMin: 0, ageMax: 0.08, sex: 'U', metric: 'hr', min: 100, max: 160, source: 'WHO/AAP' },
    { ageMin: 0.08, ageMax: 1, sex: 'U', metric: 'hr', min: 100, max: 150, source: 'WHO/AAP' },
    { ageMin: 1, ageMax: 2, sex: 'U', metric: 'hr', min: 90, max: 140, source: 'WHO/AAP' },
    // Children
    { ageMin: 2, ageMax: 5, sex: 'U', metric: 'hr', min: 80, max: 130, source: 'WHO/AAP' },
    { ageMin: 5, ageMax: 12, sex: 'U', metric: 'hr', min: 70, max: 120, source: 'WHO/AAP' },
    { ageMin: 12, ageMax: 18, sex: 'U', metric: 'hr', min: 60, max: 100, source: 'WHO/AAP' },
    // Adults
    { ageMin: 18, ageMax: 120, sex: 'U', metric: 'hr', min: 60, max: 100, source: 'AHA' },
    // Respiratory Rate (RR) - breaths per minute
    // Newborns and Infants
    { ageMin: 0, ageMax: 0.08, sex: 'U', metric: 'rr', min: 30, max: 60, source: 'WHO/AAP' },
    { ageMin: 0.08, ageMax: 1, sex: 'U', metric: 'rr', min: 24, max: 40, source: 'WHO/AAP' },
    { ageMin: 1, ageMax: 2, sex: 'U', metric: 'rr', min: 22, max: 37, source: 'WHO/AAP' },
    // Children
    { ageMin: 2, ageMax: 5, sex: 'U', metric: 'rr', min: 20, max: 30, source: 'WHO/AAP' },
    { ageMin: 5, ageMax: 12, sex: 'U', metric: 'rr', min: 18, max: 25, source: 'WHO/AAP' },
    { ageMin: 12, ageMax: 18, sex: 'U', metric: 'rr', min: 12, max: 20, source: 'WHO/AAP' },
    // Adults
    { ageMin: 18, ageMax: 120, sex: 'U', metric: 'rr', min: 12, max: 20, source: 'WHO' },
    // Temperature (Temp) - Celsius
    // Universal ranges
    { ageMin: 0, ageMax: 1, sex: 'U', metric: 'temp', min: 36.5, max: 38.0, source: 'WHO' },
    { ageMin: 1, ageMax: 5, sex: 'U', metric: 'temp', min: 36.5, max: 37.8, source: 'WHO' },
    { ageMin: 5, ageMax: 120, sex: 'U', metric: 'temp', min: 36.1, max: 37.5, source: 'WHO' },
    // Systolic Blood Pressure (SBP) - mmHg
    // Newborns and Infants
    { ageMin: 0, ageMax: 0.08, sex: 'U', metric: 'sbp', min: 60, max: 90, source: 'AAP' },
    { ageMin: 0.08, ageMax: 1, sex: 'U', metric: 'sbp', min: 70, max: 100, source: 'AAP' },
    { ageMin: 1, ageMax: 2, sex: 'U', metric: 'sbp', min: 80, max: 105, source: 'AAP' },
    // Children
    { ageMin: 2, ageMax: 5, sex: 'U', metric: 'sbp', min: 85, max: 110, source: 'AAP' },
    { ageMin: 5, ageMax: 12, sex: 'U', metric: 'sbp', min: 90, max: 120, source: 'AAP' },
    { ageMin: 12, ageMax: 18, sex: 'M', metric: 'sbp', min: 100, max: 135, source: 'AAP' },
    { ageMin: 12, ageMax: 18, sex: 'F', metric: 'sbp', min: 95, max: 130, source: 'AAP' },
    // Adults
    { ageMin: 18, ageMax: 120, sex: 'U', metric: 'sbp', min: 90, max: 120, source: 'AHA' },
    // Diastolic Blood Pressure (DBP) - mmHg
    // Newborns and Infants
    { ageMin: 0, ageMax: 0.08, sex: 'U', metric: 'dbp', min: 30, max: 60, source: 'AAP' },
    { ageMin: 0.08, ageMax: 1, sex: 'U', metric: 'dbp', min: 35, max: 65, source: 'AAP' },
    { ageMin: 1, ageMax: 2, sex: 'U', metric: 'dbp', min: 40, max: 70, source: 'AAP' },
    // Children
    { ageMin: 2, ageMax: 5, sex: 'U', metric: 'dbp', min: 45, max: 75, source: 'AAP' },
    { ageMin: 5, ageMax: 12, sex: 'U', metric: 'dbp', min: 50, max: 80, source: 'AAP' },
    { ageMin: 12, ageMax: 18, sex: 'U', metric: 'dbp', min: 55, max: 85, source: 'AAP' },
    // Adults
    { ageMin: 18, ageMax: 120, sex: 'U', metric: 'dbp', min: 60, max: 80, source: 'AHA' },
    // Oxygen Saturation (SpO2) - percentage
    // Universal ranges (same for all ages)
    { ageMin: 0, ageMax: 120, sex: 'U', metric: 'spo2', min: 95, max: 100, source: 'WHO' }
];
export async function seedVitalsRanges() {
    try {
        logger.log('Starting vitals ranges seed...');
        // Clear existing ranges
        await db.vitalsRanges.clear();
        // Add all reference ranges
        const ranges = VITALS_RANGES.map(data => ({
            id: generateId(),
            ageMin: data.ageMin,
            ageMax: data.ageMax,
            sex: data.sex,
            metric: data.metric,
            min: data.min,
            max: data.max,
            source: data.source,
            updatedAt: new Date()
        }));
        await db.vitalsRanges.bulkAdd(ranges);
        logger.log(`Seeded ${ranges.length} vitals reference ranges`);
    }
    catch (error) {
        logger.error('Failed to seed vitals ranges', error);
        throw error;
    }
}
export function getVitalRange(ageYears, sex, metric) {
    return db.vitalsRanges
        .where('metric').equals(metric)
        .and(range => ageYears >= range.ageMin &&
        ageYears <= range.ageMax &&
        (range.sex === sex || range.sex === 'U'))
        .first();
}
export async function checkVitalInRange(ageYears, sex, metric, value) {
    const range = await getVitalRange(ageYears, sex, metric);
    if (!range) {
        return { inRange: true, low: false, high: false };
    }
    const low = value < range.min;
    const high = value > range.max;
    const inRange = !low && !high;
    return { inRange, low, high, reference: range };
}
export async function flagAbnormalVitals(ageYears, sex, vitals) {
    const flags = [];
    if (vitals.pulseBpm) {
        const hr = await checkVitalInRange(ageYears, sex, 'hr', vitals.pulseBpm);
        if (hr.low)
            flags.push('Low heart rate (bradycardia)');
        if (hr.high)
            flags.push('High heart rate (tachycardia)');
    }
    if (vitals.tempC) {
        const temp = await checkVitalInRange(ageYears, sex, 'temp', vitals.tempC);
        if (temp.low)
            flags.push('Low temperature (hypothermia)');
        if (temp.high)
            flags.push('High temperature (fever)');
    }
    if (vitals.systolic) {
        const sbp = await checkVitalInRange(ageYears, sex, 'sbp', vitals.systolic);
        if (sbp.low)
            flags.push('Low systolic BP (hypotension)');
        if (sbp.high)
            flags.push('High systolic BP (hypertension)');
    }
    if (vitals.diastolic) {
        const dbp = await checkVitalInRange(ageYears, sex, 'dbp', vitals.diastolic);
        if (dbp.low)
            flags.push('Low diastolic BP');
        if (dbp.high)
            flags.push('High diastolic BP');
    }
    if (vitals.spo2) {
        const spo2 = await checkVitalInRange(ageYears, sex, 'spo2', vitals.spo2);
        if (spo2.low)
            flags.push('Low oxygen saturation (hypoxia)');
    }
    return flags;
}
export async function getVitalsInterpretation(ageYears, sex, vitals) {
    const flags = await flagAbnormalVitals(ageYears, sex, vitals);
    let severity = 'normal';
    const recommendations = [];
    if (flags.length === 0) {
        return { severity: 'normal', flags: [], recommendations: ['All vitals within normal range'] };
    }
    // Determine severity based on flags
    const criticalFlags = flags.filter(f => f.includes('hypothermia') ||
        f.includes('hypoxia') ||
        f.includes('bradycardia') ||
        (vitals.systolic && vitals.systolic < 80));
    if (criticalFlags.length > 0 || flags.length >= 3) {
        severity = 'severe';
        recommendations.push('Urgent medical attention required');
        recommendations.push('Consider immediate stabilization');
    }
    else if (flags.length === 2) {
        severity = 'moderate';
        recommendations.push('Close monitoring required');
        recommendations.push('Consider escalation to physician');
    }
    else {
        severity = 'mild';
        recommendations.push('Monitor and reassess');
        recommendations.push('Document and track trends');
    }
    return { severity, flags, recommendations };
}
