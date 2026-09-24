import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { differingFields, formatConflictValue, sameValue } from '@/features/conflicts/conflictDiff'
import { formatTimestamp, recordTypeLabel } from '@/features/conflicts/conflictLabels'
import { loadLocalRecord } from '@/features/conflicts/localContext'

export interface ConflictField {
  field: string
  label: string
  localValue: unknown
  remoteValue: unknown
  type: 'string' | 'number' | 'date' | 'object'
}

export interface ConflictData {
  entityType: string
  entityId: string
  localTimestamp: string
  remoteTimestamp: string
  conflicts: ConflictField[]
}

export type ResolutionStrategy = 'keep-local' | 'keep-remote' | 'manual'

interface Resolution {
  [field: string]: 'local' | 'remote'
}

interface ConflictResolutionModalProps {
  conflict: ConflictData
  /** May return a promise; the dialog waits for it and shows any failure. */
  onResolve: (strategy: ResolutionStrategy, resolution?: Resolution) => void | Promise<void>
  onCancel: () => void
}

const STRATEGIES: { value: ResolutionStrategy; title: string; detail: string }[] = [
  {
    value: 'keep-local',
    title: "Keep this device's values",
    detail: 'Upload this device\'s copy and replace the server copy.',
  },
  {
    value: 'keep-remote',
    title: "Keep the server's values",
    detail: "Replace this device's copy with the server copy.",
  },
  {
    value: 'manual',
    title: 'Choose field by field',
    detail: 'Pick the value to keep for each field that differs.',
  },
]

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function shortId(id: string): string {
  return `…${id.replace(/-/g, '').slice(-6).toUpperCase()}`
}

function initialResolution(conflict: ConflictData): Resolution {
  const initial: Resolution = {}
  conflict.conflicts.forEach((c) => {
    initial[c.field] = 'local'
  })
  return initial
}

function fieldList(labels: string[]): string {
  if (labels.length === 0) return 'no fields'
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

export function ConflictResolutionModal({
  conflict,
  onResolve,
  onCancel,
}: ConflictResolutionModalProps) {
  const [strategy, setStrategy] = useState<ResolutionStrategy>('keep-local')
  const [manualResolution, setManualResolution] = useState<Resolution>(() =>
    initialResolution(conflict),
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The caller may pass the next conflict into the same open dialog: start
  // it fresh rather than carrying over the previous record's choices.
  const conflictKey = `${conflict.entityType}:${conflict.entityId}`
  const [shownKey, setShownKey] = useState(conflictKey)
  if (shownKey !== conflictKey) {
    setShownKey(conflictKey)
    setStrategy('keep-local')
    setManualResolution(initialResolution(conflict))
    setConfirming(false)
    setError(null)
  }
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const confirmRef = useRef<HTMLHeadingElement>(null)

  const fields = differingFields(conflict.conflicts)
  const shown = fields.length > 0 ? fields : conflict.conflicts
  const recordLabel = recordTypeLabel(conflict.entityType).toLowerCase()

  // What this device holds now. A download during the same sync can already
  // have replaced the values shown under "This device"; say so rather than
  // promise to keep values the device no longer has.
  // undefined = still checking, null = not stored on this device.
  const [deviceRecord, setDeviceRecord] = useState<Record<string, unknown> | null | undefined>(
    undefined,
  )
  const { entityType, entityId } = conflict
  useEffect(() => {
    let cancelled = false
    setDeviceRecord(undefined)
    loadLocalRecord(entityType, entityId)
      .then((record) => {
        if (!cancelled) setDeviceRecord(record)
      })
      .catch(() => {
        if (!cancelled) setDeviceRecord(null)
      })
    return () => {
      cancelled = true
    }
  }, [entityType, entityId])

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    ;(confirming ? confirmRef : titleRef).current?.focus()
  }, [confirming])

  const setFieldResolution = (field: string, side: 'local' | 'remote') => {
    setManualResolution((prev) => ({ ...prev, [field]: side }))
  }

  const localCount = shown.filter((f) => manualResolution[f.field] === 'local').length
  const remoteCount = shown.filter((f) => manualResolution[f.field] === 'remote').length
  const allChosen = shown.every((f) => manualResolution[f.field])

  const summary: string[] = (() => {
    const names = fieldList(shown.map((f) => f.label))
    if (strategy === 'keep-local') {
      return [
        `This device's copy of the ${recordLabel} is kept and marked to upload.`,
        `At the next successful sync it replaces the server copy for ${names}.`,
      ]
    }
    if (strategy === 'keep-remote') {
      return [
        `This device's copy of the ${recordLabel} is replaced with the server copy.`,
        `Changes to ${names} made on this device and not yet uploaded are discarded.`,
      ]
    }
    return [
      `This device's copy gets the values you chose: ${localCount} from this device and ${remoteCount} from the server.`,
      'It is then marked to upload, and replaces the server copy at the next successful sync.',
    ]
  })()

  // Fields whose "This device" value (as reported) is no longer on the device.
  const keptFromDevice =
    strategy === 'keep-local'
      ? shown
      : strategy === 'manual'
        ? shown.filter((f) => manualResolution[f.field] === 'local')
        : []
  const staleLabels = deviceRecord
    ? keptFromDevice
        .filter((f) => !sameValue(deviceRecord[f.field], f.localValue, f.type))
        .map((f) => f.label)
    : []
  const deviceWarnings: string[] = []
  if (deviceRecord === null) {
    deviceWarnings.push(
      `This ${recordLabel} record was not found on this device, so there is no device copy to keep or replace here.`,
    )
  } else if (staleLabels.length > 0) {
    deviceWarnings.push(
      `This device no longer holds the values shown under "This device" for ${fieldList(staleLabels)}. They may have been replaced when the sync downloaded the server copy.`,
      'Confirming uploads what this device holds now, not the values shown. To restore the values shown, resolve this conflict on the Sync conflicts page instead.',
    )
  }

  const handleResolve = async () => {
    setBusy(true)
    setError(null)
    try {
      if (strategy === 'manual') {
        await onResolve(strategy, manualResolution)
      } else {
        await onResolve(strategy)
      }
    } catch (e) {
      console.error('Conflict resolution failed:', e instanceof Error ? e.name : 'unknown')
      setError(
        "This choice could not be applied on this device. Try again, or review it later under Sync conflicts.",
      )
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (busy) return
      e.stopPropagation()
      if (confirming) setConfirming(false)
      else onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !root.contains(active) || active === titleRef.current || active === confirmRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-ink/40"
          onClick={() => {
            if (!busy) onCancel()
          }}
          aria-hidden
        />

        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sync-conflict-title"
          aria-describedby="sync-conflict-desc"
          onKeyDown={onKeyDown}
          className="relative w-full max-w-4xl rounded-lg border border-line bg-surface shadow-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <ExclamationTriangleIcon className="mt-1 h-6 w-6 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0">
                <h2
                  id="sync-conflict-title"
                  ref={titleRef}
                  tabIndex={-1}
                  className="text-h2 text-ink focus:outline-none"
                >
                  Sync conflict: record changed in two places
                </h2>
                <p className="text-body text-ink-muted">
                  {recordTypeLabel(conflict.entityType)} · record {shortId(conflict.entityId)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="Close without resolving"
              className="btn-ghost min-w-touch-target shrink-0 px-2"
            >
              <XMarkIcon className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="space-y-5 px-4 py-4 sm:px-6">
            <p id="sync-conflict-desc" className="banner banner-info">
              This record was changed on this device and on the server since the last
              sync. Choose which values to keep. Nothing is changed until you confirm.
            </p>

            {!confirming ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                    <p className="text-label text-ink">This device</p>
                    <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
                      <ClockIcon className="h-3.5 w-3.5" aria-hidden />
                      {formatTimestamp(conflict.localTimestamp)
                        ? `Saved ${formatTimestamp(conflict.localTimestamp)}`
                        : 'Time not recorded'}
                    </p>
                  </div>
                  <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                    <p className="text-label text-ink">Server</p>
                    <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
                      <ClockIcon className="h-3.5 w-3.5" aria-hidden />
                      {formatTimestamp(conflict.remoteTimestamp)
                        ? `Saved ${formatTimestamp(conflict.remoteTimestamp)}`
                        : 'Time not recorded'}
                    </p>
                  </div>
                </div>

                <fieldset className="space-y-2">
                  <legend className="field-label">How to resolve</legend>
                  {STRATEGIES.map((s) => (
                    <label
                      key={s.value}
                      className={`flex min-h-touch-target cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                        strategy === s.value
                          ? 'border-primary bg-primary-soft'
                          : 'border-line-strong hover:bg-surface-hover'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sync-conflict-strategy"
                        value={s.value}
                        checked={strategy === s.value}
                        onChange={() => setStrategy(s.value)}
                        className="mt-1 h-4 w-4"
                      />
                      <span className="text-body">
                        <span className="block font-medium text-ink">{s.title}</span>
                        <span className="block text-caption text-ink-muted">{s.detail}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                <section aria-labelledby="sync-conflict-fields" className="space-y-3">
                  <h3 id="sync-conflict-fields" className="text-h3 text-ink">
                    {shown.length} field{shown.length === 1 ? '' : 's'} differ
                  </h3>
                  {shown.map((field) => {
                    const local = formatConflictValue(field.localValue, field.type)
                    const remote = formatConflictValue(field.remoteValue, field.type)
                    if (strategy !== 'manual') {
                      const keep = strategy === 'keep-local' ? 'local' : 'remote'
                      return (
                        <div key={field.field} className="overflow-hidden rounded-md border border-line">
                          <p className="border-b border-line bg-surface-sunken px-3 py-2 text-label text-ink">
                            {field.label}
                          </p>
                          <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                            {(['local', 'remote'] as const).map((side) => (
                              <div
                                key={side}
                                className={`space-y-1 p-3 ${keep === side ? 'bg-primary-soft' : ''}`}
                              >
                                <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-ink-muted">
                                  {side === 'local' ? 'This device' : 'Server'}
                                  {keep === side && (
                                    <span className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal text-primary-fg">
                                      <CheckCircleIcon className="h-4 w-4" aria-hidden />
                                      Kept
                                    </span>
                                  )}
                                </p>
                                <pre className="whitespace-pre-wrap break-words font-mono text-body text-ink">
                                  {side === 'local' ? local : remote}
                                </pre>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <fieldset key={field.field} className="overflow-hidden rounded-md border border-line">
                        <legend className="sr-only">{`${field.label}: choose which value to keep`}</legend>
                        <p className="border-b border-line bg-surface-sunken px-3 py-2 text-label text-ink" aria-hidden>
                          {field.label}
                        </p>
                        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                          {(['local', 'remote'] as const).map((side) => {
                            const selected = manualResolution[field.field] === side
                            return (
                              <label
                                key={side}
                                className={`flex min-h-touch-target cursor-pointer flex-col gap-1 p-3 transition-colors ${
                                  selected ? 'bg-primary-soft' : 'hover:bg-surface-hover'
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`sync-conflict-${field.field}`}
                                    value={side}
                                    checked={selected}
                                    onChange={() => setFieldResolution(field.field, side)}
                                    className="h-4 w-4"
                                  />
                                  <span className="text-caption font-semibold uppercase tracking-wide text-ink-muted">
                                    {side === 'local' ? 'This device' : 'Server'}
                                  </span>
                                  {selected && (
                                    <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium text-primary-fg">
                                      <CheckCircleIcon className="h-4 w-4" aria-hidden />
                                      Selected
                                    </span>
                                  )}
                                </span>
                                <pre className="whitespace-pre-wrap break-words font-mono text-body text-ink">
                                  {side === 'local' ? local : remote}
                                </pre>
                              </label>
                            )
                          })}
                        </div>
                      </fieldset>
                    )
                  })}
                </section>
              </>
            ) : (
              <section aria-labelledby="sync-conflict-confirm" className="space-y-3">
                <button
                  type="button"
                  className="btn-ghost -ml-3"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  <ArrowLeftIcon className="h-4 w-4" aria-hidden />
                  Back to choices
                </button>
                <h3
                  id="sync-conflict-confirm"
                  ref={confirmRef}
                  tabIndex={-1}
                  className="text-h3 text-ink focus:outline-none"
                >
                  Confirm: {STRATEGIES.find((s) => s.value === strategy)?.title}
                </h3>
                <p className="section-label">On this device</p>
                <ul className="list-disc space-y-1 pl-5 text-body text-ink">
                  {summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {deviceRecord === undefined && (
                  <p role="status" className="text-caption text-ink-muted">
                    Checking this device's copy…
                  </p>
                )}
                {deviceWarnings.length > 0 && (
                  <div className="banner banner-warning">
                    <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                    <div className="space-y-1">
                      {deviceWarnings.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-caption text-ink-muted">
                  If this conflict was also added to the shared Sync conflicts list, it
                  stays open there until someone resolves it.
                </p>
              </section>
            )}

            {error && (
              <div className="banner banner-danger" role="alert">
                <p>{error}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            {confirming ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="btn-secondary"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleResolve}
                  disabled={busy}
                  className="btn-primary"
                >
                  {busy ? 'Applying…' : 'Confirm and apply'}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setConfirming(true)
                  }}
                  disabled={busy || (strategy === 'manual' && !allChosen)}
                  className="btn-primary"
                >
                  Review choice
                </button>
              </>
            )}
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {busy ? 'Applying…' : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
