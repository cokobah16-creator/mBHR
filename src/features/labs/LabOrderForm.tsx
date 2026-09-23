import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckIcon, ExclamationTriangleIcon, SignalSlashIcon } from '@heroicons/react/20/solid'
import { db, generateId } from '@/db'
import { isSupabaseEnabled } from '@/lib/supabaseClient'
import { can } from '@/auth/roles'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatNigerianDateTime } from '@/utils/dateFormat'
import {
  createLabOrder,
  getPatientLabOrders,
  resolveLabActorId,
  type LabOrder,
} from '@/services/labs'
import { describeLabError, ORDER_STATUS_META, PRIORITY_LABEL } from './labWorklist'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

const labOrderSchema = z.object({
  testName: z.string().trim().min(1, 'Enter a test name, or choose one of the common tests'),
  testCode: z.string().optional(),
  priority: z.enum(['routine', 'urgent', 'stat']),
  notes: z.string().optional(),
})

type LabOrderFormData = z.infer<typeof labOrderSchema>

interface LabOrderFormProps {
  patientId: string
  visitId?: string
  orderedBy: string
  onSuccess?: () => void
  onCancel?: () => void
}

const commonTests = [
  { name: 'Complete Blood Count (CBC)', code: 'CBC' },
  { name: 'Basic Metabolic Panel', code: 'BMP' },
  { name: 'Comprehensive Metabolic Panel', code: 'CMP' },
  { name: 'Lipid Panel', code: 'LIPID' },
  { name: 'Hemoglobin A1C', code: 'HBA1C' },
  { name: 'Thyroid Stimulating Hormone', code: 'TSH' },
  { name: 'Urinalysis', code: 'UA' },
  { name: 'Blood Glucose', code: 'GLUCOSE' },
  { name: 'Liver Function Tests', code: 'LFT' },
  { name: 'Kidney Function Tests', code: 'RFT' },
  { name: 'HIV Test', code: 'HIV' },
  { name: 'Hepatitis B Surface Antigen', code: 'HBSAG' },
  { name: 'Malaria Rapid Test', code: 'MRDTrunc' },
  { name: 'Pregnancy Test', code: 'PREG' },
  { name: 'Stool Analysis', code: 'STOOL' },
]

const EMPTY_FORM: LabOrderFormData = { testName: '', testCode: '', priority: 'routine', notes: '' }

const FK_ORDER_HINT =
  "The lab system could not link the order to this patient, visit or your staff account. This usually means the patient's record or this visit has not synced to the cloud yet: sync this device, then try again."

const blankToUndefined = (value?: string) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

type OrdersState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Orders a lab test for a patient (embedded in the Consultation "Labs" tab).
 * Lab orders are written straight to the cloud; nothing is queued on the
 * device, so the form says so when it cannot send.
 */
export function LabOrderForm({ patientId, visitId, orderedBy, onSuccess, onCancel }: LabOrderFormProps) {
  const currentUser = useAuthStore((s) => s.currentUser)
  const { push } = useToast()
  const online = useOnlineStatus()
  const available = isSupabaseEnabled && online
  const canOrder = !!currentUser && can(currentUser.role, 'consult')

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [existing, setExisting] = useState<LabOrder[]>([])
  const [ordersState, setOrdersState] = useState<OrdersState>('idle')
  const requestRef = useRef(0)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<LabOrderFormData>({
    resolver: zodResolver(labOrderSchema),
    defaultValues: EMPTY_FORM,
  })

  const selectedTest = watch('testName')

  // The order's patient_id / visit_id must already exist in the cloud.
  const pendingSync = useLiveQuery(async () => {
    const [patient, visit] = await Promise.all([
      db.patients.get(patientId),
      visitId ? db.visits.get(visitId) : Promise.resolve(undefined),
    ])
    return {
      patient: !!patient && !patient._syncedAt,
      visit: !!visit && !visit._syncedAt,
    }
  }, [patientId, visitId])

  const loadOrders = useCallback(async () => {
    const request = ++requestRef.current
    setOrdersState('loading')
    try {
      const all = await getPatientLabOrders(patientId)
      if (request !== requestRef.current) return
      setExisting(visitId ? all.filter((o) => o.visitId === visitId) : all.slice(0, 5))
      setOrdersState('ready')
    } catch (error) {
      if (request !== requestRef.current) return
      console.error(
        "[labs] Could not load this patient's lab orders:",
        error instanceof Error ? error.name : error,
      )
      setOrdersState('error')
    }
  }, [patientId, visitId])

  useEffect(() => {
    if (available) void loadOrders()
  }, [available, loadOrders])

  const normalisedTest = (selectedTest ?? '').trim().toLowerCase()
  const duplicate = normalisedTest
    ? existing.find(
        (o) => o.status !== 'cancelled' && o.testName.trim().toLowerCase() === normalisedTest,
      )
    : undefined

  const handleQuickSelect = (testName: string, testCode: string) => {
    setValue('testName', testName, { shouldValidate: !!errors.testName })
    setValue('testCode', testCode)
  }

  const onSubmit = async (data: LabOrderFormData) => {
    setFormError('')
    // Permission and connection are checked here, not only by hiding the form.
    if (!currentUser || !can(currentUser.role, 'consult')) {
      setFormError('Your role cannot order lab tests. Record the test in the Plan instead.')
      return
    }
    if (!isSupabaseEnabled) {
      setFormError(
        'Nothing was sent. Lab orders need cloud sync, which is not set up on this device. Record the test in the Plan instead.',
      )
      return
    }
    if (!navigator.onLine) {
      setFormError(
        'Nothing was sent: this device is offline. Note the test in the Plan and order it when the connection returns.',
      )
      return
    }

    setSubmitting(true)
    try {
      const localOrderer = orderedBy && orderedBy !== 'unknown' ? orderedBy : currentUser.id
      const actorId =
        localOrderer === currentUser.id ? await resolveLabActorId(currentUser) : localOrderer

      await createLabOrder({
        patientId,
        visitId,
        orderedBy: actorId,
        testName: data.testName.trim(),
        testCode: blankToUndefined(data.testCode),
        priority: data.priority,
        status: 'ordered',
        clinicalNotes: blankToUndefined(data.notes),
      })

      push({
        id: generateId(),
        tone: 'success',
        title: 'Lab order sent',
        body: `${data.testName.trim()} · ${PRIORITY_LABEL[data.priority]}. It is now in the lab work queue.`,
      })
      reset(EMPTY_FORM)
      void loadOrders()
      onSuccess?.()
    } catch (error) {
      console.error('[labs] Lab order not sent:', error instanceof Error ? error.name : error)
      setFormError(
        describeLabError(
          error,
          'The lab order was not confirmed as sent. Check the orders listed below before ordering it again.',
          FK_ORDER_HINT,
        ),
      )
      // A request that failed on the way back may still have been stored;
      // reloading shows it (and the duplicate warning) before a retry.
      void loadOrders()
    } finally {
      setSubmitting(false)
    }
  }

  const syncNotice =
    pendingSync && (pendingSync.patient || pendingSync.visit)
      ? `${
          pendingSync.patient && pendingSync.visit
            ? "This patient's record and this visit have"
            : pendingSync.patient
              ? "This patient's record has"
              : "This visit has"
        } not synced to the cloud yet, so the lab system may refuse the order. Sync this device first if you can.`
      : null

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Order a lab test</h2>
        <span className="text-caption text-ink-muted">Sent to the lab work queue</span>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="panel-body space-y-5" noValidate aria-busy={submitting}>
        {formError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{formError}</span>
          </div>
        )}

        {!canOrder && (
          <div className="banner banner-info" role="status">
            <span>Your role cannot order lab tests. Record the test in the Plan instead.</span>
          </div>
        )}

        {!available && (
          <div className="banner banner-warning" role="status">
            <SignalSlashIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              {isSupabaseEnabled
                ? 'This device is offline. Lab orders are sent straight to the cloud and are not saved on this device, so nothing can be ordered until the connection returns.'
                : 'Lab orders need cloud sync, which is not set up on this device. Record the test in the Plan instead.'}
            </span>
          </div>
        )}

        {available && syncNotice && (
          <div className="banner banner-warning" role="status">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{syncNotice}</span>
          </div>
        )}

        <fieldset>
          <legend className="field-label">Common tests</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {commonTests.map((test) => {
              const selected = selectedTest === test.name
              return (
                <button
                  key={test.code}
                  type="button"
                  onClick={() => handleQuickSelect(test.name, test.code)}
                  aria-pressed={selected}
                  className={`flex min-h-touch-target items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    selected
                      ? 'border-primary bg-primary-soft font-medium text-primary-fg'
                      : 'border-line-strong bg-surface text-ink hover:bg-surface-hover'
                  }`}
                >
                  <span>{test.name}</span>
                  {selected && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="lab-order-test-name" className="field-label">
              Test name
            </label>
            <input
              {...register('testName')}
              id="lab-order-test-name"
              type="text"
              autoComplete="off"
              className="input-field"
              placeholder="Type a test, or choose one above"
              aria-invalid={errors.testName ? true : undefined}
              aria-describedby={
                [errors.testName ? 'lab-order-test-name-error' : '', duplicate ? 'lab-order-duplicate' : '']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
            {errors.testName && (
              <p id="lab-order-test-name-error" className="field-error" role="alert">
                {errors.testName.message}
              </p>
            )}
            {duplicate && (
              <p id="lab-order-duplicate" className="mt-1 flex items-start gap-1 text-caption text-warning-fg">
                <ExclamationTriangleIcon className="mt-px h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Already ordered {visitId ? 'for this visit' : 'for this patient'} (
                  {ORDER_STATUS_META[duplicate.status]?.label ?? duplicate.status}). Order it again only if a
                  repeat test is needed.
                </span>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="lab-order-test-code" className="field-label">
              Test code <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              {...register('testCode')}
              id="lab-order-test-code"
              type="text"
              autoComplete="off"
              className="input-field"
              placeholder="Filled in for common tests"
            />
          </div>
        </div>

        <div className="sm:max-w-xs">
          <label htmlFor="lab-order-priority" className="field-label">
            Priority
          </label>
          <select {...register('priority')} id="lab-order-priority" className="input-field">
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT (immediate)</option>
          </select>
        </div>

        <div>
          <label htmlFor="lab-order-notes" className="field-label">
            Clinical notes <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <textarea
            {...register('notes')}
            id="lab-order-notes"
            rows={3}
            className="input-field"
            placeholder="Why the test is needed, or instructions for the lab"
          />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={submitting} className="btn-secondary">
              Cancel
            </button>
          )}
          <button type="submit" disabled={submitting || !available || !canOrder} className="btn-primary">
            {submitting ? 'Sending…' : 'Order test'}
          </button>
        </div>
      </form>

      {isSupabaseEnabled && (
        <section aria-labelledby="lab-order-existing-title" className="border-t border-line px-4 py-3">
          <h3 id="lab-order-existing-title" className="section-label">
            {visitId ? 'Lab orders for this visit' : 'Recent lab orders'}
          </h3>
          <div aria-live="polite">
            {!online && ordersState !== 'ready' ? (
              <p className="mt-1 text-caption text-ink-muted">
                Not available offline. Earlier orders show here when the connection returns.
              </p>
            ) : ordersState === 'loading' && existing.length === 0 ? (
              <p className="mt-1 text-caption text-ink-muted">Loading earlier orders…</p>
            ) : ordersState === 'error' ? (
              <p className="mt-1 text-caption text-ink-muted">
                Earlier orders could not be loaded. They are listed on the Labs page.
              </p>
            ) : existing.length === 0 ? (
              <p className="mt-1 text-caption text-ink-muted">
                None yet.{!online ? ' This device is offline, so this may be out of date.' : ''}
              </p>
            ) : (
              <>
                {!online && (
                  <p className="mt-1 text-caption text-ink-muted">
                    This device is offline. Showing the list as it was when the connection dropped.
                  </p>
                )}
                <ul className="mt-1 divide-y divide-line">
                  {existing.map((o) => {
                    const meta = ORDER_STATUS_META[o.status] ?? { label: o.status, tone: 'neutral' as const }
                    return (
                      <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-body text-ink">{o.testName}</span>
                          <span className="block text-caption text-ink-muted tabular-nums">
                            {PRIORITY_LABEL[o.priority] ?? o.priority}
                            {o.orderedAt ? ` · ${formatNigerianDateTime(o.orderedAt)}` : ''}
                          </span>
                        </span>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
