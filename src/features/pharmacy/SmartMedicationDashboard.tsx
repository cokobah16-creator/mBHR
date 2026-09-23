import { useState } from 'react'
import { smartMedication } from '@/services/smartMedication'
import type { MedicationReview } from '@/services/smartMedication'
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import {
  ShieldExclamationIcon,
  BeakerIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'

const RISK_DISPLAY: Record<
  MedicationReview['overallRisk'],
  { label: string; tone: Tone; banner: string }
> = {
  danger: { label: 'Allergy conflict', tone: 'danger', banner: 'banner-danger' },
  warning: { label: 'Major interaction flagged', tone: 'warning', banner: 'banner-warning' },
  caution: { label: 'Check needed', tone: 'warning', banner: 'banner-warning' },
  safe: { label: 'No flags from built-in checks', tone: 'neutral', banner: 'banner-info' },
}

const SEVERITY_TONE: Record<string, Tone> = {
  critical: 'critical',
  major: 'danger',
  moderate: 'warning',
  minor: 'info',
}

/** Service text carries emoji markers; the UI shows its own icons instead. */
function stripMarker(text: string): string {
  return text.replace(/^(⚠️?|✓)\s*/u, '').trim()
}

/**
 * The service's all-clear line ("appears safe and appropriate") only means
 * none of the built-in rules fired. Say exactly that instead.
 */
const ALL_CLEAR_TEXT =
  'No flags from the built-in checks. This does not confirm the combination is safe — medicines not on the built-in list are not checked at all.'

export function SmartMedicationDashboard() {
  const [patientId, setPatientId] = useState('')
  const [medications, setMedications] = useState('')
  const [review, setReview] = useState<MedicationReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const performReview = async () => {
    if (!patientId || !medications) return

    setLoading(true)
    setError('')
    try {
      const medList = medications.split(',').map(m => m.trim()).filter(Boolean)
      const result = await smartMedication.performMedicationReview(patientId, medList)
      setReview(result)
    } catch (err) {
      console.error('Medication review failed:', err instanceof Error ? err.name : err)
      setReview(null)
      setError(
        'The check could not run. Make sure the patient ID belongs to a patient on this device, then try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const risk = review ? RISK_DISPLAY[review.overallRisk] : null

  return (
    <div className="space-y-4">
      <section className="panel" aria-labelledby="med-check-title">
        <div className="panel-header">
          <h2 id="med-check-title" className="panel-title flex items-center gap-2">
            <BeakerIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            Medication safety check
          </h2>
        </div>
        <div className="panel-body space-y-4">
          <div className="banner banner-info">
            <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>
              Rule-based prompts from a small built-in list, the patient’s recorded allergies
              and their dispensing history on this device. Runs offline. It is not a verified
              interaction database and can both miss and over-flag interactions — confirm with a
              current drug reference and the prescriber.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="smd-patient" className="field-label">
                Patient ID
              </label>
              <input
                id="smd-patient"
                type="text"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="input-field"
                placeholder="Record ID from the patient page"
              />
            </div>

            <div>
              <label htmlFor="smd-meds" className="field-label">
                Medicines
              </label>
              <input
                id="smd-meds"
                type="text"
                value={medications}
                onChange={(e) => setMedications(e.target.value)}
                className="input-field"
                placeholder="paracetamol, amoxicillin, ibuprofen"
                aria-describedby="smd-meds-hint"
              />
              <p id="smd-meds-hint" className="field-hint">
                Separate medicines with commas.
              </p>
            </div>
          </div>

          {error && (
            <div className="banner banner-danger" role="alert">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={performReview}
            disabled={loading || !patientId || !medications}
            className="btn-primary w-full md:w-auto"
          >
            {loading ? 'Checking…' : 'Run safety check'}
          </button>
          <p className="sr-only" role="status" aria-live="polite">
            {loading ? 'Checking medicines' : review ? 'Check complete' : ''}
          </p>
        </div>
      </section>

      {review && risk && (
        <>
          <section className="panel" aria-labelledby="med-check-summary">
            <div className="panel-header">
              <h3 id="med-check-summary" className="panel-title">
                Result
              </h3>
              <StatusBadge tone={risk.tone} icon>
                {risk.label}
              </StatusBadge>
            </div>
            <ul className="panel-body space-y-2">
              {review.recommendations.map((rec, idx) => {
                const ok = rec.includes('✓')
                return (
                  <li key={idx} className="flex items-start gap-2 text-body text-ink-secondary">
                    {ok ? (
                      <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
                    ) : (
                      <ExclamationTriangleIcon
                        className="mt-0.5 h-5 w-5 shrink-0 text-warning"
                        aria-hidden
                      />
                    )}
                    <span>{ok ? ALL_CLEAR_TEXT : stripMarker(rec)}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {review.allergyConflicts.length > 0 && (
            <section
              className="rounded-lg border border-danger-line bg-danger-soft"
              aria-labelledby="med-check-allergies"
            >
              <div className="flex items-center gap-2 border-b border-danger-line px-4 py-3">
                <ShieldExclamationIcon className="h-5 w-5 text-danger" aria-hidden />
                <h3 id="med-check-allergies" className="text-h3 text-danger-fg">
                  Possible allergy conflicts ({review.allergyConflicts.length})
                </h3>
              </div>

              <ul className="space-y-3 p-4">
                {review.allergyConflicts.map((conflict, idx) => (
                  <li key={idx} className="rounded-md border border-danger-line bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-ink">{conflict.allergyType} allergy</p>
                        <p className="mt-1 text-body text-ink-secondary">{conflict.recommendation}</p>
                      </div>
                      <StatusBadge
                        tone={conflict.severity === 'life-threatening' ? 'critical' : 'danger'}
                      >
                        {conflict.severity}
                      </StatusBadge>
                    </div>

                    {conflict.alternatives.length > 0 && (
                      <div className="mt-3 border-t border-line pt-3">
                        <p className="section-label mb-1">Alternatives to consider</p>
                        <div className="flex flex-wrap gap-2">
                          {conflict.alternatives.map((alt, i) => (
                            <span key={i} className="badge badge-neutral">
                              {alt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.interactions.length > 0 && (
            <section className="panel" aria-labelledby="med-check-interactions">
              <div className="panel-header">
                <h3 id="med-check-interactions" className="panel-title flex items-center gap-2">
                  <BeakerIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                  Interactions to check ({review.interactions.length})
                </h3>
              </div>
              <div className="panel-body space-y-3">
                <p className="text-caption text-ink-muted">
                  Flagged by built-in rules, not a verified interaction list. Pairs described as a
                  “potential interaction” have no specific rule behind them — look them up before
                  acting.
                </p>
                <ul className="space-y-3">
                  {review.interactions.map((interaction, idx) => (
                    <li key={idx} className="rounded-md border border-line p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-ink">
                            {interaction.drug1} and {interaction.drug2}
                          </p>
                          <p className="mt-1 text-body text-ink-secondary">
                            {interaction.description}
                          </p>
                        </div>
                        <StatusBadge tone={SEVERITY_TONE[interaction.severity] ?? 'neutral'} icon>
                          {interaction.severity}
                        </StatusBadge>
                      </div>

                      <div className="mt-2 border-t border-line pt-2">
                        <p className="text-label text-ink">Suggested check</p>
                        <p className="mt-1 text-body text-ink-secondary">
                          {interaction.recommendation}
                        </p>
                      </div>

                      <p className="mt-2 text-caption text-ink-muted">
                        {interaction.references.length > 0
                          ? `Source: ${interaction.references.join('; ')}`
                          : 'Source: built-in rule list (no published reference recorded)'}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="panel" aria-labelledby="med-check-adherence">
              <div className="panel-header">
                <h3 id="med-check-adherence" className="panel-title flex items-center gap-2">
                  <ChartBarIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                  Adherence estimate
                </h3>
              </div>
              <div className="panel-body space-y-4">
                <p className="text-caption text-ink-muted">
                  A rule-based score from age, the number of medicines and pharmacy visits recorded
                  on this device. Use it as a prompt to talk with the patient, not a prediction.
                </p>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-label text-ink">Score</span>
                    <span className="text-stat tabular-nums text-ink">
                      {review.adherencePrediction.score}
                      <span className="text-body text-ink-muted"> / 100</span>
                    </span>
                  </div>
                  <div
                    className="h-2 w-full rounded-full bg-surface-sunken"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={review.adherencePrediction.score}
                    aria-label="Adherence score"
                  >
                    <div
                      className="h-2 rounded-full bg-ink-muted"
                      style={{ width: `${review.adherencePrediction.score}%` }}
                    />
                  </div>
                  <p className="mt-1 text-body capitalize text-ink-secondary">
                    Likelihood of adherence: {review.adherencePrediction.likelihood.replace('-', ' ')}
                  </p>
                </div>

                {review.adherencePrediction.riskFactors.length > 0 && (
                  <div>
                    <p className="section-label mb-2">Risk factors</p>
                    <ul className="list-disc space-y-1 pl-5 text-body text-ink-secondary">
                      {review.adherencePrediction.riskFactors.map((factor, i) => (
                        <li key={i}>{factor}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {review.adherencePrediction.supportStrategies.length > 0 && (
                  <div>
                    <p className="section-label mb-2">Support to offer</p>
                    <ul className="list-disc space-y-1 pl-5 text-body text-ink-secondary">
                      {review.adherencePrediction.supportStrategies.map((strategy, i) => (
                        <li key={i}>{strategy}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            <section className="panel" aria-labelledby="med-check-list">
              <div className="panel-header">
                <h3 id="med-check-list" className="panel-title flex items-center gap-2">
                  <ClipboardDocumentListIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                  Medicines checked
                </h3>
                <span className="text-caption text-ink-muted">
                  {review.medications.length} total
                </span>
              </div>
              <ol className="divide-y divide-line">
                {review.medications.map((med, idx) => (
                  <li key={idx} className="flex items-center justify-between px-4 py-3">
                    <span className="font-medium capitalize text-ink">{med}</span>
                    <span className="text-caption tabular-nums text-ink-muted">#{idx + 1}</span>
                  </li>
                ))}
              </ol>
              {review.medications.length > 5 && (
                <div className="border-t border-line p-4">
                  <div className="banner banner-warning">
                    <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                    <span>More than 5 medicines — consider a medication review.</span>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
