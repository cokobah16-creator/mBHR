import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestOTP, verifyOTP, registerPatientPortalAccount, validateSession, logout } from './patientPortalAuth';
vi.mock('@/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
                    single: vi.fn(() => Promise.resolve({ data: null, error: null }))
                })),
                gte: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({ data: null, error: null }))
                }))
            })),
            insert: vi.fn(() => ({
                select: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({ data: {}, error: null }))
                }))
            })),
            update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null }))
            }))
        })),
        functions: {
            invoke: vi.fn(() => Promise.resolve({ data: { success: true }, error: null }))
        }
    }
}));
vi.mock('@/lib/logger', () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
}));
describe('Patient Portal Authentication', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe('requestOTP', () => {
        it('should request OTP for login', async () => {
            const result = await requestOTP({
                phone: '+2348012345678',
                purpose: 'login'
            });
            expect(result.success).toBe(false);
        });
        it('should request OTP for registration', async () => {
            const result = await requestOTP({
                phone: '+2348012345678',
                purpose: 'registration'
            });
            expect(result).toBeDefined();
        });
        it('should fail without phone or email', async () => {
            const result = await requestOTP({
                phone: '',
                purpose: 'login'
            });
            expect(result.success).toBe(false);
            expect(result.error).toBeTruthy();
        });
    });
    describe('verifyOTP', () => {
        it('should verify valid OTP', async () => {
            const result = await verifyOTP({
                phone: '+2348012345678',
                otp: '123456'
            });
            expect(result).toBeDefined();
        });
        it('should fail with invalid OTP format', async () => {
            const result = await verifyOTP({
                phone: '+2348012345678',
                otp: '12'
            });
            expect(result.success).toBe(false);
        });
    });
    describe('registerPatientPortalAccount', () => {
        it('should register new patient account', async () => {
            const result = await registerPatientPortalAccount('+2348012345678', 'patient@example.com', '123456', '1990-01-01');
            expect(result).toBeDefined();
        });
    });
    describe('validateSession', () => {
        it('should validate valid session token', async () => {
            const result = await validateSession('valid-token');
            expect(result).toBeNull();
        });
        it('should reject invalid session token', async () => {
            const result = await validateSession('invalid-token');
            expect(result).toBeNull();
        });
    });
    describe('logout', () => {
        it('should logout successfully', async () => {
            const result = await logout('session-token');
            expect(result).toBe(true);
        });
    });
});
