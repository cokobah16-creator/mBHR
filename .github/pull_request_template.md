## Summary

<!--
What does this change do, and why? Link the issue if there is one.
Never paste patient data (names, phone numbers, record contents) here or in
screenshots.
-->

## Clinical logic

<!--
Does this pull request touch clinical thresholds, interpretation, medication
guidance, lab interpretation, triage, vitals ranges, diagnosis support,
contraindication logic, or patient-facing medical advice?

The "Clinical logic gate" check fails when a file on the clinical-logic list
(scripts/check-clinical-logic-change.mjs) changes, unless this pull request
also updates docs/clinical/CLINICAL_LOGIC_CHANGES.md or you tick the second
box below. Text inside these comments does not count.

Tick one box. If you edit this description after the check has run, re-run
the check.
-->

- [ ] This changes clinical logic. I added a row to the change log in
      `docs/clinical/CLINICAL_LOGIC_CHANGES.md` and, for anything a
      clinician must review, an unticked item in its blocking checklist.
- [ ] No clinical logic change.

## Testing

<!--
How was this tested? Unit tests added or changed, manual steps, devices,
offline behaviour, roles tried.
-->

- [ ] `npm run typecheck`, `npm run lint` and `npm run test:run` pass

## Migrations

<!--
New files in supabase/migrations/: what each one does, whether it can be
re-run safely, how to roll it back, and whether it changes existing data.
Write "None" if there are none.
-->
