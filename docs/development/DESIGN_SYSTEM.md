# mBHR design system

mBHR is used at temporary outreach clinics: bright rooms, shared tablets,
queues of patients, intermittent power and internet. The interface should
feel calm, predictable and trustworthy. Hierarchy comes from surfaces,
borders, type and spacing. **Colour is reserved for meaning.**

Source of truth: `tailwind.config.js` (tokens) and `src/index.css`
(component classes and CSS custom properties that mirror the tokens).

## Two modes

| Mode | Where | Rules |
| --- | --- | --- |
| Clinical | Registration, queue, vitals, consultation, pharmacy, patient record, admin | Restrained. No gradients, glow, scaling, emoji or decorative icons. Colour only for state. |
| Training | Games, quests, leaderboards, prize shop, volunteer engagement | May be more colourful and animated. Must never be mixed into clinical screens. |

The patient portal uses the clinical system with more space and plainer language.

## Tokens

**Surfaces**: `bg-canvas` (page) → `bg-surface` (panels) → `bg-surface-sunken` (wells, table headers). Overlays add `shadow-xl`; content panels use `border-line`, not shadows.

**Text**: `text-ink` (primary), `text-ink-secondary`, `text-ink-muted` (captions; still AA on white), `text-ink-disabled`.

**Borders**: `border-line` (default), `border-line-strong` (controls).

**Semantic state**: `info`, `success`, `warning`, `danger`, `critical`. Each has `DEFAULT` (solid/icon), `fg` (text on soft), `soft` (background) and `line` (border).

| Meaning | Tone |
| --- | --- |
| Normal reading, completed, synced | success (or neutral, if "normal" needs no emphasis) |
| Abnormal reading, pending upload, sync conflict, low stock, long wait | warning |
| High/low vital, allergy, failure, out of stock | danger |
| Severely abnormal vital, life-threatening allergy | critical |
| In progress, informational | info |
| Offline, inactive, closed | neutral |

**Patient-flow stages**: `stage-registration`, `stage-vitals`, `stage-consult`, `stage-pharmacy` (+ `-soft`, `-line`). Use them as small markers that identify workflow position (a dot, a thin bar), never as full-card fills.

**Type**: `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-label`, `text-caption`, `text-stat`. One `h1` per page (the `PageHeader` title).

**Radius**: controls `rounded-md` (6px), panels `rounded-lg` (8px), overlays up to `rounded-2xl` (12px). `rounded-full` only for avatars, dots and pills that are genuinely round.

**Motion**: colour transitions ≤150 ms. No scale-on-press, bouncing or floating. `prefers-reduced-motion` is honoured globally.

## Components

| Need | Use |
| --- | --- |
| Page title, description, primary actions, breadcrumbs | `components/ui/PageHeader` |
| Any status or state label | `components/ui/StatusBadge` (warning/danger/critical show an icon so state is never colour-only) |
| Loading | `components/ui/Skeleton` — shaped skeletons for lists, records, queue, dashboard, consultation, pharmacy, portal |
| Nothing to show | `components/ui/EmptyState` — say what belongs here and what to do next |
| Who the patient is, allergies, abnormal vitals, stage | `components/patient/PatientContextHeader` — on every screen acting on one patient |
| Registration → vitals → consultation → pharmacy | `components/patient/PatientFlowStepper`, fed by `services/patientFlow` |
| Latest vitals, previous diagnoses, recent medicines | `components/patient/ClinicalSummaryPanel` |
| Buttons | `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost` |
| Inputs | `.field-label` + `.input-field` (+ `.field-hint` / `.field-error`); always link labels with `htmlFor`/`id` |
| Containers | `.panel` with `.panel-header` / `.panel-title` / `.panel-body`; `.card` is a bordered surface |
| Tables | `.data-table`; below `md` render a list instead of a wide table |
| Messages | `.banner-info / -success / -warning / -danger`; toasts (`useToast`) for completed actions |

## Writing

- Say what happened and what happens next: "Ticket A042 · added to the queue."
- Buttons name the action: "Dispense 15 × Amoxicillin", "Send to Consultation", "Keep record".
- Destructive confirmations name the record and list consequences.
- Never claim success before the data is saved; never label rule-based logic as "AI".

## Clinical helpers

- `utils/vitals`: `assessVitals` (BMI + flags from a vitals record), `resolveBmi` (display BMI; corrects records saved before the BMI fix), `classifyBMI` / `classifyBloodPressure` / `classifyTemperature` / `classifyPulse` / `classifySpO2`.
- `utils/allergyMatch`: medication ↔ allergen matching including drug classes.
- `features/pharmacy/fefo`: first-expired-first-out allocation across lots.
