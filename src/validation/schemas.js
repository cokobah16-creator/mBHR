import { z } from 'zod';
import { validatePhoneNG } from '@/utils/nigeria';
export const patientSchema = z.object({
    givenName: z.string().min(1, 'Given name is required').max(100),
    familyName: z.string().min(1, 'Family name is required').max(100),
    sex: z.enum(['male', 'female', 'other'], {
        errorMap: () => ({ message: 'Please select a valid sex' })
    }),
    dob: z.string().min(1, 'Date of birth is required').refine((date) => {
        const birthDate = new Date(date);
        const now = new Date();
        return birthDate < now;
    }, { message: 'Date of birth must be in the past' }),
    phone: z.string().refine((val) => {
        // If undefined or empty, it's valid
        if (val === undefined)
            return true;
        if (val === '')
            return true;
        if (val.trim() === '')
            return true;
        // Otherwise validate it
        return validatePhoneNG(val);
    }, {
        message: 'Invalid Nigerian phone number. Use format: 08012345678 or +2348012345678'
    }).optional(),
    email: z.string().email('Invalid email address').or(z.literal('')).optional(),
    address: z.string().min(1, 'Address is required').max(500),
    state: z.string().min(1, 'State is required'),
    lga: z.string().min(1, 'LGA is required'),
    familyId: z.string().optional()
}).refine((data) => {
    const hasPhone = data.phone && data.phone.trim() !== '';
    const hasEmail = data.email && data.email.trim() !== '';
    return !!(hasPhone || hasEmail);
}, {
    message: 'Provide at least a phone number or an email address',
    path: ['phone']
});
export const vitalsSchema = z.object({
    heightCm: z.number().min(30, 'Height must be at least 30cm').max(250, 'Height must be under 250cm').optional(),
    weightKg: z.number().min(1, 'Weight must be at least 1kg').max(300, 'Weight must be under 300kg').optional(),
    tempC: z.number().min(30, 'Temperature must be at least 30°C').max(45, 'Temperature must be under 45°C').optional(),
    pulseBpm: z.number().min(30, 'Pulse must be at least 30 bpm').max(200, 'Pulse must be under 200 bpm').optional(),
    systolic: z.number().min(60, 'Systolic BP must be at least 60').max(250, 'Systolic BP must be under 250').optional(),
    diastolic: z.number().min(30, 'Diastolic BP must be at least 30').max(150, 'Diastolic BP must be under 150').optional(),
    spo2: z.number().min(70, 'SpO2 must be at least 70%').max(100, 'SpO2 cannot exceed 100%').optional()
}).refine((data) => {
    if (data.systolic && data.diastolic) {
        return data.systolic > data.diastolic;
    }
    return true;
}, {
    message: 'Systolic blood pressure must be greater than diastolic',
    path: ['systolic']
});
export const soapSchema = z.object({
    soapSubjective: z.string().min(1, 'Subjective findings are required'),
    soapObjective: z.string().min(1, 'Objective findings are required'),
    soapAssessment: z.string().min(1, 'Assessment is required'),
    soapPlan: z.string().min(1, 'Treatment plan is required')
});
export const dispenseSchema = z.object({
    itemName: z.string().min(1, 'Medication name is required'),
    qty: z.number().min(1, 'Quantity must be at least 1').int('Quantity must be a whole number'),
    dosage: z.string().min(1, 'Dosage is required'),
    directions: z.string().min(1, 'Directions are required')
});
export const inventoryItemSchema = z.object({
    itemName: z.string().min(1, 'Item name is required'),
    unit: z.string().min(1, 'Unit is required'),
    onHandQty: z.number().min(0, 'Quantity cannot be negative'),
    reorderThreshold: z.number().min(0, 'Reorder threshold cannot be negative')
});
export const prescriptionLineSchema = z.object({
    itemId: z.string().min(1, 'Medication is required'),
    dosage: z.string().min(1, 'Dosage is required'),
    frequency: z.string().min(1, 'Frequency is required'),
    duration: z.string().min(1, 'Duration is required'),
    instructions: z.string().optional()
});
export const userSchema = z.object({
    fullName: z.string().min(1, 'Full name is required').max(200),
    role: z.enum(['nurse', 'doctor', 'pharmacist', 'admin'], {
        errorMap: () => ({ message: 'Please select a valid role' })
    }),
    pin: z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d{4}$/, 'PIN must contain only numbers')
});
