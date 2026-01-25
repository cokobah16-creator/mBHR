# TEFCA Integration Roadmap

## Overview

This document outlines mBHR's strategy for implementing TEFCA (Trusted Exchange Framework and Common Agreement) compliance, with a focus on IAS (Individual Access Services) to enable patients to access their own health information through connected healthcare networks.

## Current Implementation Status

### Phase 1: Foundation (Complete)

The following capabilities have been implemented:

#### FHIR R4 API Endpoint
- **Location**: `supabase/functions/tefca-ias/index.ts`
- **Base URL**: `{SUPABASE_URL}/functions/v1/tefca-ias`
- **Supported Operations**:
  - `GET /metadata` - FHIR Capability Statement
  - `GET /Patient/{id}` - Read patient demographics
  - `GET /Patient?name=&birthdate=` - Search patients
  - `GET /Observation?patient=` - Query vital signs
  - `GET /MedicationRequest?patient=` - Query medications
  - `GET /Encounter?patient=` - Query visits
  - `GET /Patient/{id}/$everything` - Bulk patient export

#### Supported FHIR Resources
| Resource | US Core Profile | LOINC/SNOMED Codes |
|----------|----------------|-------------------|
| Patient | us-core-patient | N/A |
| Observation (Vitals) | us-core-vital-signs | 8480-6, 8462-4, 8867-4, 8310-5, etc. |
| MedicationRequest | us-core-medicationrequest | Text-based (RxNorm planned) |
| Encounter | us-core-encounter | AMB class code |

#### Security Features
- Exchange purpose validation (IAS, Treatment, Payment, Operations)
- Patient consent verification
- Comprehensive audit logging
- QHIN partner registry
- Rate limiting

#### Patient Portal Integration
- Health data export in FHIR format
- Data sharing preference management
- Access history viewing

### Database Tables Created
- `tefca_access_logs` - Audit trail (6-year retention)
- `tefca_qhin_partners` - QHIN registry
- `patient_data_sharing_preferences` - Patient consent preferences

---

## Roadmap

### Phase 2: IAS Enhancement (Q2 2026)

**Goal**: Full SMART on FHIR authorization for third-party patient apps

#### Planned Features
1. **SMART on FHIR Authorization Server**
   - OAuth 2.0 with PKCE support
   - Standalone launch sequence
   - EHR launch sequence
   - Scope-based access control

2. **Third-Party App Authorization**
   - App registration portal
   - Dynamic client registration
   - App approval workflow

3. **Enhanced Patient Experience**
   - In-app data sharing consent flows
   - Real-time access notifications
   - Granular resource-level permissions

4. **Additional Resources**
   - AllergyIntolerance
   - Condition (diagnosis)
   - Immunization
   - DiagnosticReport

#### Technical Requirements
- SMART App Launch Framework 2.0
- UDAP (Unified Data Access Profiles) support
- Token introspection endpoint

---

### Phase 3: QHIN Integration (Q4 2026)

**Goal**: Connect to production TEFCA network through a QHIN

#### Planned Activities
1. **QHIN Partnership**
   - Evaluate and select QHIN partner
   - Complete onboarding requirements
   - Technical integration testing

2. **Patient Identity Management**
   - Cross-network patient matching
   - Master Patient Index integration
   - Identity proofing workflows

3. **Bi-directional Exchange**
   - Receive patient data from network
   - Respond to network queries
   - Handle break-the-glass scenarios

4. **Compliance Certification**
   - TEFCA Common Agreement signing
   - SOC 2 Type II audit
   - Privacy and security assessments

---

### Phase 4: Advanced Interoperability (2027)

**Goal**: Full-featured health information exchange

#### Planned Features
1. **Bulk FHIR Operations**
   - `$export` operation for bulk data
   - Backend services authorization
   - Ndjson format support

2. **Real-time Notifications**
   - FHIR Subscriptions (R5 backport)
   - ADT event notifications
   - Care gap alerts

3. **Clinical Decision Support**
   - CDS Hooks integration
   - Medication interaction checking
   - Allergy alerts

4. **Quality Reporting**
   - HEDIS measure calculation
   - QRDA export
   - Population health dashboards

---

## API Documentation

### Authentication

TEFCA requests require the following headers:

```http
X-QHIN-ID: {qhin-identifier}
X-Exchange-Purpose: individual-access|treatment|payment|operations
X-Requesting-Organization: {organization-name}
Authorization: Bearer {api-key}
```

### Example Requests

#### Get Patient by ID
```bash
curl -X GET \
  "{BASE_URL}/Patient/123e4567-e89b-12d3-a456-426614174000" \
  -H "X-QHIN-ID: demo-qhin-001" \
  -H "X-Exchange-Purpose: individual-access" \
  -H "Accept: application/fhir+json"
```

#### Search Observations
```bash
curl -X GET \
  "{BASE_URL}/Observation?patient=Patient/123&category=vital-signs&date=ge2024-01-01" \
  -H "X-QHIN-ID: demo-qhin-001" \
  -H "X-Exchange-Purpose: treatment" \
  -H "Accept: application/fhir+json"
```

#### Export All Patient Data
```bash
curl -X GET \
  "{BASE_URL}/Patient/123/$everything" \
  -H "X-QHIN-ID: demo-qhin-001" \
  -H "X-Exchange-Purpose: individual-access" \
  -H "Accept: application/fhir+json"
```

### Response Format

All responses are in FHIR R4 JSON format:

```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 5,
  "entry": [
    {
      "resource": {
        "resourceType": "Observation",
        "id": "vital-123",
        "status": "final",
        "code": {
          "coding": [{
            "system": "http://loinc.org",
            "code": "8480-6",
            "display": "Systolic blood pressure"
          }]
        },
        "valueQuantity": {
          "value": 120,
          "unit": "mmHg",
          "system": "http://unitsofmeasure.org",
          "code": "mm[Hg]"
        }
      }
    }
  ]
}
```

---

## Compliance Checklist

### TEFCA Common Agreement Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| FHIR R4 Support | Complete | US Core profiles |
| IAS Exchange Purpose | Complete | Patient self-access |
| Treatment Exchange Purpose | Complete | Provider access |
| Consent Management | Complete | Patient preferences |
| Audit Logging | Complete | 6-year retention |
| Minimum Necessary | Partial | Resource filtering planned |
| Patient Identity Matching | Partial | Local matching only |
| QHIN Connection | Planned | Phase 3 |

### US Core Profiles Implemented

- [x] Patient
- [x] Observation (Vital Signs)
- [x] Blood Pressure Panel
- [x] MedicationRequest
- [x] Encounter
- [ ] AllergyIntolerance
- [ ] Condition
- [ ] Procedure
- [ ] Immunization
- [ ] DiagnosticReport

### Security Controls

- [x] TLS 1.2+ encryption
- [x] API key authentication
- [x] Request logging
- [x] Rate limiting
- [x] Patient consent verification
- [ ] SMART on FHIR OAuth
- [ ] UDAP certificates

---

## Configuration

### Environment Variables

```env
# TEFCA Configuration (set in Supabase secrets)
TEFCA_ENABLED=true
TEFCA_ORG_NAME="Med Bridge Health Reach"
TEFCA_ORG_OID="2.16.840.1.113883.3.9999.1"
```

### QHIN Partner Configuration

Partners are registered in the `tefca_qhin_partners` table:

```sql
INSERT INTO tefca_qhin_partners (id, name, allowed_purposes, active)
VALUES ('partner-id', 'Partner Name', ARRAY['individual-access', 'treatment'], true);
```

---

## References

- [TEFCA Common Agreement](https://www.healthit.gov/topic/interoperability/policy/trusted-exchange-framework-and-common-agreement-tefca)
- [US Core Implementation Guide](https://www.hl7.org/fhir/us/core/)
- [SMART App Launch Framework](https://hl7.org/fhir/smart-app-launch/)
- [FHIR R4 Specification](https://www.hl7.org/fhir/R4/)
- [ONC Information Blocking Rule](https://www.healthit.gov/topic/information-blocking)
