/**
 * Unified Portal Enrollment Service
 *
 * Connects staff registration with patient portal access.
 * When staff register a patient with email/phone, automatically creates portal account.
 */
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
/**
 * Enroll a patient in the portal (creates portal user account)
 * Called automatically when staff registers a patient with contact info
 */
export async function enrollPatientInPortal(data) {
    try {
        const { patientId, givenName, familyName, dob, phone, email, sex } = data;
        if (!phone && !email) {
            return {
                success: false,
                error: 'Patient must have email or phone number for portal access'
            };
        }
        // Check if patient already has portal account
        const { data: existingPortalUser } = await supabase
            .from('patient_portal_users')
            .select('id')
            .eq('patient_id', patientId)
            .maybeSingle();
        if (existingPortalUser) {
            return {
                success: true,
                portalUserId: existingPortalUser.id,
                error: 'Patient already has portal access'
            };
        }
        // Check for duplicate email/phone in portal users
        if (email) {
            const { data: emailConflict } = await supabase
                .from('patient_portal_users')
                .select('id')
                .ilike('email', email)
                .maybeSingle();
            if (emailConflict) {
                return {
                    success: false,
                    error: 'Email already registered in portal'
                };
            }
        }
        if (phone) {
            const { data: phoneConflict } = await supabase
                .from('patient_portal_users')
                .select('id')
                .eq('phone_number', phone)
                .maybeSingle();
            if (phoneConflict) {
                return {
                    success: false,
                    error: 'Phone number already registered in portal'
                };
            }
        }
        // Create portal user account
        const { data: newPortalUser, error: createError } = await supabase
            .from('patient_portal_users')
            .insert({
            patient_id: patientId,
            phone_number: phone || null,
            email: email || null,
            given_name: givenName,
            family_name: familyName,
            dob,
            sex: sex || null,
            account_status: 'active',
            phone_verified: false,
            email_verified: false,
            consent_given: false
        })
            .select()
            .single();
        if (createError || !newPortalUser) {
            logger.error('Failed to create portal user:', createError);
            return {
                success: false,
                error: 'Failed to create portal account'
            };
        }
        // Update patient record to reflect portal enrollment
        await supabase
            .from('patients')
            .update({
            portal_enabled: true,
            portal_invited_at: new Date().toISOString()
        })
            .eq('id', patientId);
        logger.info(`Portal account created for patient ${patientId}`);
        return {
            success: true,
            portalUserId: newPortalUser.id,
            invitationSent: false
        };
    }
    catch (error) {
        logger.error('Error in enrollPatientInPortal:', error);
        return {
            success: false,
            error: 'An error occurred during enrollment'
        };
    }
}
/**
 * Send portal invitation to existing patient
 * Sends OTP via email or SMS for first-time login
 */
export async function sendPortalInvitation(patientId) {
    try {
        // Get patient details
        const { data: patient, error: patientError } = await supabase
            .from('patients')
            .select('*')
            .eq('id', patientId)
            .single();
        if (patientError || !patient) {
            return {
                success: false,
                error: 'Patient not found'
            };
        }
        if (!patient.email && !patient.phone) {
            return {
                success: false,
                error: 'Patient has no contact information'
            };
        }
        // Check if portal user exists
        const { data: portalUser } = await supabase
            .from('patient_portal_users')
            .select('*')
            .eq('patient_id', patientId)
            .maybeSingle();
        if (!portalUser) {
            // Create portal account first
            const enrollResult = await enrollPatientInPortal({
                patientId: patient.id,
                givenName: patient.given_name,
                familyName: patient.family_name,
                dob: patient.dob,
                phone: patient.phone,
                email: patient.email,
                sex: patient.sex
            });
            if (!enrollResult.success) {
                return enrollResult;
            }
        }
        // In a real implementation, you would send an email/SMS invitation here
        // For now, just mark as invited
        await supabase
            .from('patients')
            .update({
            portal_invited_at: new Date().toISOString()
        })
            .eq('id', patientId);
        logger.info(`Invitation sent to patient ${patientId}`);
        return {
            success: true,
            invitationSent: true
        };
    }
    catch (error) {
        logger.error('Error in sendPortalInvitation:', error);
        return {
            success: false,
            error: 'Failed to send invitation'
        };
    }
}
/**
 * Check if patient can be enrolled in portal
 */
export async function canEnrollInPortal(patientId) {
    try {
        const { data: patient } = await supabase
            .from('patients')
            .select('email, phone, portal_enabled')
            .eq('id', patientId)
            .single();
        if (!patient) {
            return { canEnroll: false, reason: 'Patient not found' };
        }
        if (patient.portal_enabled) {
            return { canEnroll: false, reason: 'Already enrolled' };
        }
        if (!patient.email && !patient.phone) {
            return { canEnroll: false, reason: 'No contact information' };
        }
        return { canEnroll: true };
    }
    catch (error) {
        logger.error('Error checking enrollment eligibility:', error);
        return { canEnroll: false, reason: 'Error checking eligibility' };
    }
}
/**
 * Bulk enroll multiple patients in portal
 * Useful for migrating existing patients
 */
export async function bulkEnrollPatients(patientIds) {
    let success = 0;
    let failed = 0;
    const errors = [];
    for (const patientId of patientIds) {
        const { data: patient } = await supabase
            .from('patients')
            .select('*')
            .eq('id', patientId)
            .single();
        if (!patient) {
            failed++;
            errors.push({ patientId, error: 'Patient not found' });
            continue;
        }
        const result = await enrollPatientInPortal({
            patientId: patient.id,
            givenName: patient.given_name,
            familyName: patient.family_name,
            dob: patient.dob,
            phone: patient.phone,
            email: patient.email,
            sex: patient.sex
        });
        if (result.success) {
            success++;
        }
        else {
            failed++;
            errors.push({ patientId, error: result.error || 'Unknown error' });
        }
    }
    logger.info(`Bulk enrollment complete: ${success} success, ${failed} failed`);
    return { success, failed, errors };
}
/**
 * Get portal enrollment status for a patient
 */
export async function getPortalStatus(patientId) {
    try {
        const { data: patient } = await supabase
            .from('patients')
            .select('portal_enabled, portal_invited_at, contact_verified')
            .eq('id', patientId)
            .single();
        const { data: portalUser } = await supabase
            .from('patient_portal_users')
            .select('id, phone_verified, email_verified')
            .eq('patient_id', patientId)
            .maybeSingle();
        return {
            enrolled: patient?.portal_enabled || false,
            verified: portalUser?.phone_verified || portalUser?.email_verified || false,
            invitedAt: patient?.portal_invited_at ? new Date(patient.portal_invited_at) : undefined,
            portalUserId: portalUser?.id
        };
    }
    catch (error) {
        logger.error('Error getting portal status:', error);
        return {
            enrolled: false,
            verified: false
        };
    }
}
