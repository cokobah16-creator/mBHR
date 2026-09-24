# mBHR documentation

Med Bridge Health Reach is an offline-first clinical record and patient-flow
app for medical outreach clinics. Start with the [project README](../README.md).

## Architecture and design

- [Architecture](./architecture/ARCHITECTURE.md)
- [Design system](./development/DESIGN_SYSTEM.md) — tokens, components and the rules for colour, status and layout
- [Caching strategy](./architecture/CACHING_STRATEGY.md) · [Scaling plan](./architecture/SCALING_PLAN.md)
- [PHI field encryption spike](./security/PHI_ENCRYPTION_SPIKE.md)

## Running an outreach

- [User guide](./guides/USER_GUIDE.md) · [Quick reference](./guides/QUICK_REFERENCE.md)
- [Quick reference card](./guides/QUICK_REFERENCE_CARD.md)
- [Issuing tickets](./guides/ISSUE_TICKET_QUICK_GUIDE.md)
- [Doctor features](./clinical/DOCTOR_FEATURES_GUIDE.md)
- [Televisits](./clinical/TELEVISITS.md)

## Patient portal

- [Specification](./patient-portal/PATIENT_PORTAL_SPEC.md) · [Implementation](./patient-portal/PATIENT_PORTAL_IMPLEMENTATION.md)
- [Access guide](./patient-portal/PATIENT_PORTAL_ACCESS_GUIDE.md) · [User guide](./patient-portal/PATIENT_PORTAL_USER_GUIDE.md)
- [Enrolment quick start](./guides/PORTAL_ENROLLMENT_QUICKSTART.md) · [Sending invitations](./guides/SEND_INVITATION_INSTRUCTIONS.md)
- [Deployment](./patient-portal/PATIENT_PORTAL_DEPLOYMENT.md)

## Deployment and operations

- [Deployment guide](./deployment/DEPLOYMENT_GUIDE.md) · [Going live](./deployment/GOING_LIVE.md)
- [Secrets](./deployment/SECRETS_SETUP_GUIDE.md) · [Email](./deployment/EMAIL_SETUP_GUIDE.md) · [SMS (Termii)](./deployment/SMS_SETUP_TERMII.md)
- [Production hardening checklist](./security/PRODUCTION_HARDENING_CHECKLIST.md) · [Restore runbook](./deployment/RESTORE_RUNBOOK.md)

## Development

- [Developer quick start](./development/DEVELOPER_QUICKSTART.md)
- [Testing guide](./testing/TESTING_GUIDE.md) · [Translations](./development/MULTILINGUAL_GUIDE.md)

## Interoperability

- [TEFCA roadmap](./interoperability/TEFCA_ROADMAP.md)

## Legal

- [Privacy notice and terms — review status](./legal/README.md)
- [Legal readiness checklist](./legal/LEGAL_READINESS_CHECKLIST.md) — 20 common legal-readiness items, where mBHR stands on each, and the file-level steps to close each gap

## Archive

[`archive/development-history`](./archive/development-history/) keeps the
sprint reports, fix summaries and status notes written during development.
They describe the app as it was at the time and may be out of date; some
contain claims (for example "AI-powered") that the current product no
longer makes.
