/**
 * Patient Portal Enrollment Service
 *
 * Handles portal account enrollment, invitation sending, and status management
 * Integrates with the existing Supabase patient portal authentication system
 */
import { db } from '@/db';
import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/utils/phone';
import { MessageQueue } from '@/db/outbox';
import * as logger from '@/lib/logger';
const RATE_LIMIT_MS = Number(import.meta.env.VITE_INVITE_RATE_MS || 60000); // Default 60 seconds
const MAX_RETRIES = 3;
/**
 * Enable portal access for a patient
 */
export async function enablePortalAccess(patientId, options = {}) {
    try {
        const patient = await db.patients.get(patientId);
        if (!patient) {
            return { success: false, error: 'Patient not found' };
        }
        // Validate contact information
        if (!patient.email && !patient.phone) {
            return { success: false, error: 'Patient must have at least an email or phone number' };
        }
        // Check if terms were accepted
        if (!options.termsAccepted) {
            return { success: false, error: 'Terms and conditions must be accepted' };
        }
        // Update patient record to enable portal
        await db.patients.update(patientId, {
            portalEnabled: 1,
            updatedAt: new Date(),
            _dirty: 1
        });
        // Create patient portal user account in Supabase
        try {
            // Check if portal user already exists
            const { data: existingPortalUser } = await supabase
                .from('patient_portal_users')
                .select('id')
                .eq('patient_id', patientId)
                .maybeSingle();
            if (!existingPortalUser) {
                // Create new portal user account
                const { error: createError } = await supabase
                    .from('patient_portal_users')
                    .insert({
                    patient_id: patientId,
                    phone_number: normalizePhone(patient.phone) || '',
                    email: patient.email || null,
                    account_status: 'active',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
                if (createError) {
                    logger.error('Error creating portal user:', createError);
                    // Don't fail the enrollment - we can retry later
                    logger.warn('Portal user creation failed, will retry on sync');
                }
                else {
                    logger.info('Portal user account created for patient:', patientId);
                }
            }
        }
        catch (supabaseError) {
            logger.warn('Failed to create portal user in Supabase (will retry):', supabaseError);
            // Don't fail the operation - the sync will handle it later
        }
        logger.info('Portal access enabled for patient:', patientId);
        // Send invitation if requested
        if (options.sendInviteNow) {
            return await sendPortalInvitation(patientId);
        }
        return { success: true };
    }
    catch (error) {
        logger.error('Error enabling portal access:', error);
        return { success: false, error: error.message || 'Failed to enable portal access' };
    }
}
/**
 * Disable portal access for a patient
 */
export async function disablePortalAccess(patientId) {
    try {
        await db.patients.update(patientId, {
            portalEnabled: 0,
            updatedAt: new Date(),
            _dirty: 1
        });
        logger.info('Portal access disabled for patient:', patientId);
        return { success: true };
    }
    catch (error) {
        logger.error('Error disabling portal access:', error);
        return { success: false, error: error.message || 'Failed to disable portal access' };
    }
}
/**
 * Send portal invitation to a patient
 */
export async function sendPortalInvitation(patientId) {
    try {
        const patient = await db.patients.get(patientId);
        if (!patient) {
            return { success: false, error: 'Patient not found' };
        }
        if (!patient.portalEnabled) {
            return { success: false, error: 'Portal access is not enabled for this patient' };
        }
        // Check rate limiting
        const canSend = await checkRateLimit(patient);
        if (!canSend.allowed) {
            return { success: false, error: canSend.message };
        }
        const contactMethod = patient.email ? 'email' : patient.phone ? 'phone' : null;
        if (!contactMethod) {
            return { success: false, error: 'No contact method available' };
        }
        // Update invitation record
        const invitation = {
            lastSentAt: new Date().toISOString(),
            lastStatus: 'queued',
            failureReason: null,
            count: (patient.portalInvitation?.count || 0) + 1
        };
        await db.patients.update(patientId, {
            portalInvitation: invitation,
            updatedAt: new Date(),
            _dirty: 1
        });
        // Queue the invitation message for offline-first delivery
        if (import.meta.env.DEV) {
            // In development, log the OTP to console
            logger.info(`[DEV] Portal invitation for ${patient.givenName} ${patient.familyName}`);
            logger.info(`[DEV] Contact: ${patient.email || patient.phone}`);
            logger.info(`[DEV] Patient can login at /patient/login`);
            // Mark as sent immediately in dev mode
            await db.patients.update(patientId, {
                portalInvitation: { ...invitation, lastStatus: 'sent' },
                _dirty: 1
            });
            return { success: true, demoOTP: '(Check Supabase for OTP or use test mode)' };
        }
        // Production: Queue message for actual delivery
        const templateKey = 'portal.invitation';
        await MessageQueue.queueMessage(patientId, patient.email || patient.phone, templateKey, {
            patientName: `${patient.givenName} ${patient.familyName}`,
            portalUrl: `${window.location.origin}/patient/login`
        }, {
            channel: patient.email ? 'sms' : 'sms', // Default to SMS, email can be added later
            locale: 'en'
        });
        logger.info('Portal invitation queued for patient:', patientId);
        return { success: true };
    }
    catch (error) {
        logger.error('Error sending portal invitation:', error);
        // Update invitation status to failed
        const patient = await db.patients.get(patientId);
        if (patient?.portalInvitation) {
            await db.patients.update(patientId, {
                portalInvitation: {
                    ...patient.portalInvitation,
                    lastStatus: 'failed',
                    failureReason: error.message || 'Unknown error'
                },
                _dirty: 1
            });
        }
        return { success: false, error: error.message || 'Failed to send invitation' };
    }
}
/**
 * Check if invitation can be resent (rate limiting)
 */
async function checkRateLimit(patient) {
    if (!patient.portalInvitation?.lastSentAt) {
        return { allowed: true };
    }
    const lastSent = new Date(patient.portalInvitation.lastSentAt).getTime();
    const now = Date.now();
    const timeSince = now - lastSent;
    if (timeSince < RATE_LIMIT_MS) {
        const waitMs = RATE_LIMIT_MS - timeSince;
        const waitMinutes = Math.ceil(waitMs / 60000);
        return {
            allowed: false,
            message: `Please wait ${waitMinutes} minute${waitMinutes !== 1 ? 's' : ''} before resending`,
            waitMs
        };
    }
    return { allowed: true };
}
/**
 * Get portal status for a patient
 */
export async function getPortalStatus(patientId) {
    try {
        const patient = await db.patients.get(patientId);
        if (!patient)
            return null;
        const rateLimit = await checkRateLimit(patient);
        const contactMethod = patient.email ? 'email' : patient.phone ? 'phone' : undefined;
        return {
            enabled: patient.portalEnabled === 1,
            verified: patient.contactVerified === 1,
            lastLogin: patient.lastPortalActivity ? new Date(patient.lastPortalActivity) : undefined,
            lastInviteSent: patient.portalInvitation?.lastSentAt
                ? new Date(patient.portalInvitation.lastSentAt)
                : undefined,
            inviteStatus: patient.portalInvitation?.lastStatus,
            inviteCount: patient.portalInvitation?.count || 0,
            contactMethod,
            canResend: rateLimit.allowed && patient.portalEnabled === 1,
            nextResendTime: rateLimit.waitMs
                ? new Date(Date.now() + rateLimit.waitMs)
                : undefined
        };
    }
    catch (error) {
        logger.error('Error getting portal status:', error);
        return null;
    }
}
/**
 * Link authenticated Supabase user to patient record
 */
export async function linkAuthUserToPatient(authUid, patientId) {
    try {
        const patient = await db.patients.get(patientId);
        if (!patient) {
            return { success: false, error: 'Patient not found' };
        }
        // Check if another patient is already linked to this auth UID
        const existingLink = await db.patients
            .where('authUid')
            .equals(authUid)
            .first();
        if (existingLink && existingLink.id !== patientId) {
            return { success: false, error: 'This account is already linked to another patient' };
        }
        // Update local record
        await db.patients.update(patientId, {
            authUid,
            contactVerified: 1,
            lastPortalActivity: new Date().toISOString(),
            updatedAt: new Date(),
            _dirty: 1
        });
        // Sync to Supabase
        try {
            await supabase
                .from('patients')
                .update({
                auth_uid: authUid,
                contact_verified: true,
                last_portal_activity: new Date().toISOString()
            })
                .eq('id', patientId);
        }
        catch (supabaseError) {
            logger.warn('Failed to sync auth link to Supabase (will retry):', supabaseError);
            // Don't fail the operation - the sync will happen later
        }
        logger.info('Auth user linked to patient:', { authUid, patientId });
        return { success: true };
    }
    catch (error) {
        logger.error('Error linking auth user to patient:', error);
        return { success: false, error: error.message || 'Failed to link account' };
    }
}
/**
 * Find patients eligible for bulk portal enrollment
 * (have contact info but portal not enabled)
 */
export async function findEligiblePatients(filters = {}) {
    try {
        let query = db.patients.where('portalEnabled').equals(0);
        const patients = await query.toArray();
        // Filter by contact method and other criteria
        return patients.filter(p => {
            // Must have contact info
            const hasEmail = p.email && p.email.trim() !== '';
            const hasPhone = p.phone && p.phone.trim() !== '';
            if (filters.contactMethod === 'email' && !hasEmail)
                return false;
            if (filters.contactMethod === 'phone' && !hasPhone)
                return false;
            if (filters.contactMethod === 'any' && !hasEmail && !hasPhone)
                return false;
            if (!hasEmail && !hasPhone)
                return false;
            // Filter by date range
            if (filters.startDate && p.createdAt < filters.startDate)
                return false;
            if (filters.endDate && p.createdAt > filters.endDate)
                return false;
            // Filter by state
            if (filters.state && p.state !== filters.state)
                return false;
            return true;
        });
    }
    catch (error) {
        logger.error('Error finding eligible patients:', error);
        return [];
    }
}
/**
 * Bulk enable portal access for multiple patients
 */
export async function bulkEnablePortalAccess(patientIds, options = {}) {
    const batchSize = options.batchSize || 50;
    const results = {
        success: 0,
        failed: 0,
        errors: []
    };
    for (let i = 0; i < patientIds.length; i += batchSize) {
        const batch = patientIds.slice(i, i + batchSize);
        await Promise.all(batch.map(async (patientId) => {
            try {
                const result = await enablePortalAccess(patientId, {
                    sendInviteNow: options.sendInvitations,
                    termsAccepted: true // Bulk operations assume consent
                });
                if (result.success) {
                    results.success++;
                }
                else {
                    results.failed++;
                    results.errors.push({ patientId, error: result.error || 'Unknown error' });
                }
            }
            catch (error) {
                results.failed++;
                results.errors.push({ patientId, error: error.message || 'Unknown error' });
            }
            if (options.onProgress) {
                options.onProgress(results.success + results.failed, patientIds.length);
            }
        }));
        // Rate limit between batches
        if (i + batchSize < patientIds.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return results;
}
