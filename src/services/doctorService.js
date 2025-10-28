import { supabase } from '@/lib/supabase';
export const doctorService = {
    async createPatientFlag(flag) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        const { data, error } = await supabase
            .from('patient_flags')
            .insert({
            ...flag,
            status: 'open'
        })
            .select()
            .single();
        if (error) {
            console.error('Error creating patient flag:', error);
            return null;
        }
        return data;
    },
    async getPatientFlags(params) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        let query = supabase
            .from('patient_flags')
            .select('*')
            .eq('org_id', params.org_id)
            .order('created_at', { ascending: false });
        if (params.site_id) {
            query = query.eq('site_id', params.site_id);
        }
        if (params.event_id) {
            query = query.eq('event_id', params.event_id);
        }
        if (params.to_station) {
            query = query.eq('to_station', params.to_station);
        }
        if (params.status) {
            query = query.eq('status', params.status);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching patient flags:', error);
            return [];
        }
        return data || [];
    },
    async resolvePatientFlag(flagId, resolvedBy, resolutionNote) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        const { error } = await supabase
            .from('patient_flags')
            .update({
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            resolved_by: resolvedBy,
            resolution_note: resolutionNote
        })
            .eq('id', flagId);
        if (error) {
            console.error('Error resolving patient flag:', error);
            return false;
        }
        return true;
    },
    async createReferral(referral) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        const { data, error } = await supabase
            .from('referrals')
            .insert(referral)
            .select()
            .single();
        if (error) {
            console.error('Error creating referral:', error);
            return null;
        }
        return data;
    },
    async getReferrals(params) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        let query = supabase
            .from('referrals')
            .select('*')
            .eq('org_id', params.org_id)
            .order('created_at', { ascending: false });
        if (params.site_id) {
            query = query.eq('site_id', params.site_id);
        }
        if (params.patient_id) {
            query = query.eq('patient_id', params.patient_id);
        }
        if (params.status) {
            query = query.eq('status', params.status);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching referrals:', error);
            return [];
        }
        return data || [];
    },
    async scheduleFollowUp(followUp) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        const { data, error } = await supabase
            .from('follow_up_schedules')
            .insert(followUp)
            .select()
            .single();
        if (error) {
            console.error('Error scheduling follow-up:', error);
            return null;
        }
        return data;
    },
    async getFollowUpSchedules(params) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        let query = supabase
            .from('follow_up_schedules')
            .select('*')
            .eq('org_id', params.org_id)
            .order('scheduled_date', { ascending: true });
        if (params.site_id) {
            query = query.eq('site_id', params.site_id);
        }
        if (params.patient_id) {
            query = query.eq('patient_id', params.patient_id);
        }
        if (params.status) {
            query = query.eq('status', params.status);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching follow-up schedules:', error);
            return [];
        }
        return data || [];
    },
    async getPrescriptionTemplates(org_id, condition) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        let query = supabase
            .from('prescription_templates')
            .select('*')
            .eq('org_id', org_id)
            .eq('is_active', true)
            .order('name');
        if (condition) {
            query = query.eq('condition', condition);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching prescription templates:', error);
            return [];
        }
        return data || [];
    },
    async getSiteFormulary(site_id, searchTerm) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        let query = supabase
            .from('site_formulary')
            .select('*')
            .eq('site_id', site_id)
            .eq('is_active', true)
            .order('medication_name');
        if (searchTerm) {
            query = query.ilike('medication_name', `%${searchTerm}%`);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching site formulary:', error);
            return [];
        }
        return data || [];
    },
    async getDoctorAnalytics(event_id, doctor_id) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        const { data, error } = await supabase
            .from('doctor_analytics')
            .select('*')
            .eq('event_id', event_id)
            .eq('doctor_id', doctor_id)
            .maybeSingle();
        if (error) {
            console.error('Error fetching doctor analytics:', error);
            return null;
        }
        return data;
    },
    async updateDoctorAnalytics(event_id, doctor_id, updates) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        const { error } = await supabase
            .from('doctor_analytics')
            .upsert({
            event_id,
            doctor_id,
            ...updates,
            updated_at: new Date().toISOString()
        });
        if (error) {
            console.error('Error updating doctor analytics:', error);
            return false;
        }
        return true;
    },
    async getProtocols(params) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        let query = supabase
            .from('protocol_library')
            .select('*')
            .eq('org_id', params.org_id)
            .eq('is_active', true)
            .order('title');
        if (params.condition) {
            query = query.eq('condition', params.condition);
        }
        if (params.category) {
            query = query.eq('category', params.category);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching protocols:', error);
            return [];
        }
        return data || [];
    },
    async createConsultationReview(review) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        const { data, error } = await supabase
            .from('consultation_reviews')
            .insert(review)
            .select()
            .single();
        if (error) {
            console.error('Error creating consultation review:', error);
            return null;
        }
        return data;
    },
    async getConsultationReviews(params) {
        if (!supabase)
            throw new Error('Supabase not initialized');
        let query = supabase
            .from('consultation_reviews')
            .select('*')
            .eq('org_id', params.org_id)
            .order('created_at', { ascending: false });
        if (params.reviewed_doctor_id) {
            query = query.eq('reviewed_doctor_id', params.reviewed_doctor_id);
        }
        if (params.review_status) {
            query = query.eq('review_status', params.review_status);
        }
        const { data, error } = await query;
        if (error) {
            console.error('Error fetching consultation reviews:', error);
            return [];
        }
        return data || [];
    }
};
