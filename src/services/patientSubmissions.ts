import { supabase } from '@/lib/supabase'
import { db, generateId, PatientSubmittedData } from '@/db'
import * as logger from '@/lib/logger'

export interface SubmissionData {
  symptoms?: {
    description: string
    severity: 'mild' | 'moderate' | 'severe'
    duration: string
    onsetDate?: string
  }
  medications?: {
    name: string
    dosage: string
    frequency: string
    startDate?: string
    isNew: boolean
  }[]
  allergies?: {
    allergen: string
    reaction: string
    severity: 'mild' | 'moderate' | 'severe' | 'life-threatening'
  }[]
  lifestyle?: {
    smokingStatus?: 'never' | 'former' | 'current'
    alcoholUse?: 'none' | 'occasional' | 'moderate' | 'heavy'
    exerciseFrequency?: 'none' | 'occasional' | 'regular' | 'daily'
    dietNotes?: string
  }
  vitals?: {
    bloodPressure?: string
    weight?: number
    temperature?: number
    notes?: string
  }
  other?: Record<string, unknown>
}

export interface CreateSubmissionInput {
  patientId: string
  portalUserId?: string
  submissionType: PatientSubmittedData['submissionType']
  data: SubmissionData
  notes?: string
}

export interface ReviewSubmissionInput {
  submissionId: string
  status: 'approved' | 'rejected'
  reviewedBy: string
  reviewNotes?: string
  mergedToRecordId?: string
}

export async function createPatientSubmission(
  input: CreateSubmissionInput
): Promise<PatientSubmittedData | null> {
  const now = new Date()
  const submission: PatientSubmittedData = {
    id: generateId(),
    patientId: input.patientId,
    portalUserId: input.portalUserId,
    submissionType: input.submissionType,
    data: input.data as Record<string, unknown>,
    notes: input.notes,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    _dirty: 1
  }

  try {
    await db.patientSubmittedData.add(submission)

    if (supabase) {
      const { error } = await supabase
        .from('patient_submitted_data')
        .insert({
          id: submission.id,
          patient_id: submission.patientId,
          portal_user_id: submission.portalUserId,
          submission_type: submission.submissionType,
          data: submission.data,
          notes: submission.notes,
          status: submission.status,
          created_at: submission.createdAt.toISOString(),
          updated_at: submission.updatedAt.toISOString()
        })

      if (error) {
        logger.error('Failed to sync submission to Supabase:', error)
      } else {
        await db.patientSubmittedData.update(submission.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      }
    }

    return submission
  } catch (error) {
    logger.error('Failed to create patient submission:', error)
    return null
  }
}

export async function getPatientSubmissions(
  patientId: string,
  status?: PatientSubmittedData['status']
): Promise<PatientSubmittedData[]> {
  try {
    let query = db.patientSubmittedData.where('patientId').equals(patientId)

    if (status) {
      query = query.and(s => s.status === status)
    }

    return await query.reverse().sortBy('createdAt')
  } catch (error) {
    logger.error('Failed to get patient submissions:', error)
    return []
  }
}

export async function getPendingSubmissionsForReview(): Promise<PatientSubmittedData[]> {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('patient_submitted_data')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) {
        logger.error('Failed to fetch pending submissions:', error)
        return await db.patientSubmittedData.where('status').equals('pending').toArray()
      }

      return (data || []).map(s => ({
        id: s.id,
        patientId: s.patient_id,
        portalUserId: s.portal_user_id,
        submissionType: s.submission_type,
        data: s.data,
        notes: s.notes,
        status: s.status,
        reviewedBy: s.reviewed_by,
        reviewedAt: s.reviewed_at ? new Date(s.reviewed_at) : undefined,
        reviewNotes: s.review_notes,
        mergedToRecordId: s.merged_to_record_id,
        createdAt: new Date(s.created_at),
        updatedAt: new Date(s.updated_at)
      }))
    }

    return await db.patientSubmittedData.where('status').equals('pending').toArray()
  } catch (error) {
    logger.error('Failed to get pending submissions:', error)
    return []
  }
}

export async function reviewSubmission(
  input: ReviewSubmissionInput
): Promise<boolean> {
  const now = new Date()

  try {
    await db.patientSubmittedData.update(input.submissionId, {
      status: input.status,
      reviewedBy: input.reviewedBy,
      reviewedAt: now,
      reviewNotes: input.reviewNotes,
      mergedToRecordId: input.mergedToRecordId,
      updatedAt: now,
      _dirty: 1
    })

    if (supabase) {
      const { error } = await supabase
        .from('patient_submitted_data')
        .update({
          status: input.status,
          reviewed_by: input.reviewedBy,
          reviewed_at: now.toISOString(),
          review_notes: input.reviewNotes,
          merged_to_record_id: input.mergedToRecordId,
          updated_at: now.toISOString()
        })
        .eq('id', input.submissionId)

      if (error) {
        logger.error('Failed to sync submission review to Supabase:', error)
      } else {
        await db.patientSubmittedData.update(input.submissionId, {
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      }
    }

    return true
  } catch (error) {
    logger.error('Failed to review submission:', error)
    return false
  }
}

export async function mergeSubmissionToAllergies(
  submissionId: string,
  patientId: string,
  reviewedBy: string
): Promise<boolean> {
  try {
    const submission = await db.patientSubmittedData.get(submissionId)
    if (!submission || submission.submissionType !== 'allergies') {
      return false
    }

    const allergiesData = submission.data as { allergies?: SubmissionData['allergies'] }
    if (!allergiesData.allergies) {
      return false
    }

    const now = new Date()

    for (const allergy of allergiesData.allergies) {
      await db.patientAllergies.add({
        id: generateId(),
        patientId,
        allergen: allergy.allergen,
        allergyType: 'other',
        reaction: allergy.reaction,
        severity: allergy.severity,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: 'patient-submitted',
        _dirty: 1
      })
    }

    await reviewSubmission({
      submissionId,
      status: 'approved',
      reviewedBy,
      reviewNotes: 'Merged to patient allergies',
      mergedToRecordId: patientId
    })

    return true
  } catch (error) {
    logger.error('Failed to merge submission to allergies:', error)
    return false
  }
}

export async function syncPendingSubmissions(): Promise<void> {
  if (!supabase) return

  try {
    const dirtySubmissions = await db.patientSubmittedData
      .where('_dirty')
      .equals(1)
      .toArray()

    for (const submission of dirtySubmissions) {
      const { error } = await supabase
        .from('patient_submitted_data')
        .upsert({
          id: submission.id,
          patient_id: submission.patientId,
          portal_user_id: submission.portalUserId,
          submission_type: submission.submissionType,
          data: submission.data,
          notes: submission.notes,
          status: submission.status,
          reviewed_by: submission.reviewedBy,
          reviewed_at: submission.reviewedAt?.toISOString(),
          review_notes: submission.reviewNotes,
          merged_to_record_id: submission.mergedToRecordId,
          created_at: submission.createdAt.toISOString(),
          updated_at: submission.updatedAt.toISOString()
        })

      if (!error) {
        await db.patientSubmittedData.update(submission.id, {
          _dirty: 0,
          _syncedAt: new Date().toISOString()
        })
      }
    }

    logger.log(`Synced ${dirtySubmissions.length} patient submissions`)
  } catch (error) {
    logger.error('Failed to sync pending submissions:', error)
  }
}
