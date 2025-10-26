/**
 * Portal Background Sync Worker
 *
 * Handles automatic processing of queued portal invitations
 * and syncing portal activity between local DB and Supabase
 */

import { db } from '@/db'
import { supabase } from '@/lib/supabase'
import { MessageQueue, outboxDb } from '@/db/outbox'
import * as logger from '@/lib/logger'

let isProcessing = false
let syncIntervalId: number | null = null

/**
 * Process queued portal invitations from outbox
 */
export async function processPortalInvitationQueue(): Promise<{
  processed: number
  succeeded: number
  failed: number
}> {
  if (isProcessing) {
    logger.info('Portal sync already in progress, skipping...')
    return { processed: 0, succeeded: 0, failed: 0 }
  }

  isProcessing = true
  let processed = 0
  let succeeded = 0
  let failed = 0

  try {
    // Get pending messages from outbox
    const pendingMessages = await MessageQueue.getPendingMessages(20)

    for (const message of pendingMessages) {
      try {
        processed++

        // For development, just mark as sent
        if (import.meta.env.DEV) {
          await MessageQueue.markSent(message.id)

          // Update patient invitation status
          await db.patients.where('id').equals(message.patientId).modify((patient) => {
            if (patient.portalInvitation) {
              patient.portalInvitation.lastStatus = 'sent'
              patient._dirty = 1
            }
          })

          succeeded++
          logger.info(`[DEV] Processed portal invitation for patient: ${message.patientId}`)
          continue
        }

        // Production: Call actual SMS/Email service
        // TODO: Implement actual SMS/Email delivery
        // For now, mark as sent
        await MessageQueue.markSent(message.id)

        await db.patients.where('id').equals(message.patientId).modify((patient) => {
          if (patient.portalInvitation) {
            patient.portalInvitation.lastStatus = 'sent'
            patient._dirty = 1
          }
        })

        succeeded++
      } catch (error: any) {
        failed++
        logger.error(`Failed to process invitation for patient ${message.patientId}:`, error)
        await MessageQueue.markFailed(message.id, error.message || 'Unknown error')

        // Update patient invitation status
        await db.patients.where('id').equals(message.patientId).modify((patient) => {
          if (patient.portalInvitation) {
            patient.portalInvitation.lastStatus = 'failed'
            patient.portalInvitation.failureReason = error.message || 'Unknown error'
            patient._dirty = 1
          }
        })
      }
    }

    if (processed > 0) {
      logger.info(`Portal invitation queue processed: ${succeeded} succeeded, ${failed} failed`)
    }
  } catch (error) {
    logger.error('Error processing portal invitation queue:', error)
  } finally {
    isProcessing = false
  }

  return { processed, succeeded, failed }
}

/**
 * Sync portal activity from Supabase to local DB
 * Updates lastPortalActivity and contactVerified status
 */
export async function syncPortalActivityFromSupabase(): Promise<{
  synced: number
  errors: number
}> {
  let synced = 0
  let errors = 0

  try {
    // Check if online
    if (!navigator.onLine) {
      logger.info('Offline, skipping portal activity sync')
      return { synced: 0, errors: 0 }
    }

    // Get all patients with portal enabled
    const patientsWithPortal = await db.patients
      .where('portalEnabled')
      .equals(1)
      .toArray()

    if (patientsWithPortal.length === 0) {
      return { synced: 0, errors: 0 }
    }

    // Query Supabase for portal activity updates
    const patientIds = patientsWithPortal.map(p => p.id)

    try {
      const { data: supabasePatients, error } = await supabase
        .from('patients')
        .select('id, auth_uid, contact_verified, last_portal_activity')
        .in('id', patientIds)

      if (error) {
        logger.error('Error fetching portal activity from Supabase:', error)
        return { synced: 0, errors: patientIds.length }
      }

      // Update local records with Supabase data
      for (const supabasePatient of supabasePatients || []) {
        try {
          const localPatient = patientsWithPortal.find(p => p.id === supabasePatient.id)
          if (!localPatient) continue

          // Check if there are updates
          const hasUpdates =
            supabasePatient.auth_uid !== localPatient.authUid ||
            (supabasePatient.contact_verified && localPatient.contactVerified === 0) ||
            (supabasePatient.last_portal_activity &&
              supabasePatient.last_portal_activity !== localPatient.lastPortalActivity)

          if (hasUpdates) {
            await db.patients.update(supabasePatient.id, {
              authUid: supabasePatient.auth_uid || undefined,
              contactVerified: supabasePatient.contact_verified ? 1 : 0,
              lastPortalActivity: supabasePatient.last_portal_activity || undefined,
              updatedAt: new Date()
            })

            synced++
            logger.info(`Synced portal activity for patient: ${supabasePatient.id}`)
          }
        } catch (error) {
          errors++
          logger.error(`Error syncing patient ${supabasePatient.id}:`, error)
        }
      }

      if (synced > 0) {
        logger.info(`Portal activity sync complete: ${synced} patients updated`)
      }
    } catch (error) {
      logger.error('Error in Supabase query:', error)
      errors = patientIds.length
    }
  } catch (error) {
    logger.error('Error syncing portal activity:', error)
  }

  return { synced, errors }
}

/**
 * Run full portal sync cycle
 * 1. Process invitation queue
 * 2. Sync activity from Supabase
 */
export async function runPortalSync(): Promise<void> {
  logger.info('Starting portal sync cycle...')

  const queueResult = await processPortalInvitationQueue()
  const activityResult = await syncPortalActivityFromSupabase()

  logger.info('Portal sync cycle complete:', {
    invitations: queueResult,
    activity: activityResult
  })
}

/**
 * Start automatic background sync
 * Runs every 30 seconds while app is active
 */
export function startPortalSyncWorker(intervalSeconds: number = 30): void {
  if (syncIntervalId !== null) {
    logger.warn('Portal sync worker already running')
    return
  }

  logger.info(`Starting portal sync worker (every ${intervalSeconds}s)`)

  // Run initial sync
  runPortalSync()

  // Set up periodic sync
  syncIntervalId = window.setInterval(() => {
    if (navigator.onLine) {
      runPortalSync()
    } else {
      logger.info('Offline, skipping scheduled portal sync')
    }
  }, intervalSeconds * 1000)

  // Sync when going back online
  window.addEventListener('online', handleOnline)
}

/**
 * Stop automatic background sync
 */
export function stopPortalSyncWorker(): void {
  if (syncIntervalId !== null) {
    clearInterval(syncIntervalId)
    syncIntervalId = null
    logger.info('Portal sync worker stopped')
  }

  window.removeEventListener('online', handleOnline)
}

/**
 * Handle online event
 */
function handleOnline() {
  logger.info('Connection restored, running portal sync...')
  runPortalSync()
}

/**
 * Get sync worker status
 */
export function getPortalSyncStatus(): {
  isRunning: boolean
  isProcessing: boolean
} {
  return {
    isRunning: syncIntervalId !== null,
    isProcessing
  }
}

// Initialize sync worker when module loads (if in browser context)
if (typeof window !== 'undefined') {
  // Wait for app to be ready
  window.addEventListener('load', () => {
    // Start sync worker 5 seconds after page load
    setTimeout(() => {
      startPortalSyncWorker(30)
    }, 5000)
  })
}
