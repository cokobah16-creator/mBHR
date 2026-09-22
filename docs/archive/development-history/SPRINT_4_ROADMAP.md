# Sprint 4 Roadmap: Options A, B, C Combined

**Status:** Ready to Execute
**Estimated Duration:** 2-4 weeks
**Priority Order:** A → B → C

---

## 🎯 OPTION A: Field Deployment (PRIORITY 1)

**Status:** Documentation Complete ✅
**Duration:** 1-2 weeks
**Goal:** Deploy to production and conduct field testing

### Phase A1: Production Setup (2-4 hours)
**Status:** Ready to execute

#### Tasks:
1. ✅ **Deployment Guide Created** - `docs/DEPLOYMENT_GUIDE.md`
2. ✅ **User Guide Created** - `docs/USER_GUIDE.md`
3. ✅ **Quick Reference Created** - `docs/QUICK_REFERENCE.md`
4. 🔲 **Create Supabase Production Project**
   - Sign up / login to Supabase
   - Create new project
   - Note credentials
5. 🔲 **Run Database Migrations**
   - Execute 5 migrations in SQL Editor
   - Verify all tables created
   - Check RLS policies active
6. 🔲 **Set Up Storage**
   - Verify photos bucket exists
   - Test photo upload
   - Check public access
7. 🔲 **Deploy Frontend**
   - Choose Netlify or Vercel
   - Configure environment variables
   - Deploy to production URL
8. 🔲 **Create Admin Account**
   - Add first user via Supabase Auth
   - Grant admin permissions in app_users table
   - Test login

### Phase A2: Pilot Site Setup (4-8 hours)
**Status:** Awaiting Phase A1 completion

#### Tasks:
1. 🔲 **Select Pilot Sites** (1-2 sites recommended)
2. 🔲 **Prepare Devices**
   - Install PWA on Android/iOS devices
   - Test offline functionality
   - Configure sync settings
3. 🔲 **Create User Accounts**
   - CHW accounts
   - Nurse accounts
   - Doctor accounts
   - Pharmacist accounts
4. 🔲 **Conduct Training Sessions**
   - Session 1: Introduction (30 min)
   - Session 2: Patient Registration (45 min)
   - Session 3: Clinical Workflow (1 hour)
   - Session 4: Pharmacy (45 min)
   - Session 5: Queue Management (30 min)
   - Session 6: Troubleshooting (30 min)
5. 🔲 **Test All Workflows**
   - Register test patients
   - Record vitals
   - Document consultations
   - Dispense medications
   - Test offline/online sync

### Phase A3: Monitoring & Support (Ongoing)
**Status:** Post-deployment

#### Week 1: Daily Monitoring
- [ ] Check error rates
- [ ] Monitor sync success
- [ ] Review user feedback
- [ ] Verify data integrity
- [ ] Track usage metrics

#### Week 2-4: Weekly Reviews
- [ ] Analyze usage patterns
- [ ] Identify pain points
- [ ] Plan improvements
- [ ] Update documentation
- [ ] Scale to additional sites

### Success Criteria for Option A:
- [ ] Production environment live
- [ ] 2+ pilot sites active
- [ ] 10+ trained users
- [ ] Zero data loss incidents
- [ ] <1% sync error rate
- [ ] Training materials validated

---

## 🚀 OPTION B: Advanced Features (PRIORITY 2)

**Status:** Ready for development
**Duration:** 16-20 hours
**Goal:** Add high-value features requested by users

### Feature B1: SMS Medication Reminders (4 hours)

#### Implementation:
```typescript
// New file: src/services/sms.ts
import { createClient } from '@supabase/supabase-js'

interface SMSConfig {
  apiKey: string
  senderId: string
  provider: 'twilio' | 'africas-talking' | 'infobip'
}

export async function sendMedicationReminder(
  patientPhone: string,
  medicationName: string,
  dosage: string,
  nextDose: Date
) {
  // Implementation using Supabase Edge Function
}

export async function scheduleReminders(dispenseId: string) {
  // Create reminder schedule based on prescription
}
```

#### Database Schema:
```sql
CREATE TABLE IF NOT EXISTS medication_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispense_id uuid REFERENCES dispenses(id),
  patient_id uuid REFERENCES patients(id),
  medication_name text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE medication_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reminders"
  ON medication_reminders FOR SELECT
  TO authenticated
  USING (auth.uid() IN (
    SELECT id FROM app_users WHERE role IN ('pharmacist', 'admin')
  ));
```

#### Tasks:
- [ ] Create SMS service module
- [ ] Add reminder scheduling logic
- [ ] Create database migration
- [ ] Build reminder management UI
- [ ] Integrate with dispensing workflow
- [ ] Add SMS provider configuration
- [ ] Test delivery and tracking

### Feature B2: Lab Results Management (4 hours)

#### Database Schema:
```sql
CREATE TABLE IF NOT EXISTS lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) NOT NULL,
  visit_id uuid REFERENCES visits(id),
  ordered_by uuid REFERENCES app_users(id),
  test_name text NOT NULL,
  test_code text,
  priority text CHECK (priority IN ('routine', 'urgent', 'stat')),
  status text CHECK (status IN ('ordered', 'collected', 'processing', 'completed', 'cancelled')),
  ordered_at timestamptz DEFAULT now(),
  collected_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES lab_orders(id) NOT NULL,
  result_value text,
  result_unit text,
  reference_range text,
  interpretation text CHECK (interpretation IN ('normal', 'abnormal', 'critical')),
  result_date timestamptz NOT NULL,
  reviewed_by uuid REFERENCES app_users(id),
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
```

#### UI Components:
- Lab order form
- Results entry interface
- Results review dashboard
- Critical results alerts

#### Tasks:
- [ ] Create lab order schema
- [ ] Build lab order form
- [ ] Create results entry UI
- [ ] Add results to patient timeline
- [ ] Implement critical value alerts
- [ ] Add print functionality
- [ ] Test workflow end-to-end

### Feature B3: Appointment Scheduling (4 hours)

#### Database Schema:
```sql
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) NOT NULL,
  provider_id uuid REFERENCES app_users(id),
  appointment_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer DEFAULT 30,
  status text CHECK (status IN ('scheduled', 'confirmed', 'arrived', 'in-progress', 'completed', 'no-show', 'cancelled')),
  reason text,
  notes text,
  reminder_sent boolean DEFAULT false,
  reminder_sent_at timestamptz,
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) NOT NULL,
  appointment_type text NOT NULL,
  preferred_dates jsonb,
  reason text,
  priority text CHECK (priority IN ('routine', 'urgent')),
  status text CHECK (status IN ('waiting', 'scheduled', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
```

#### UI Components:
- Calendar view
- Appointment booking form
- Daily schedule view
- Waitlist management
- SMS reminder integration

#### Tasks:
- [ ] Create appointment schema
- [ ] Build calendar component
- [ ] Add booking interface
- [ ] Implement waitlist logic
- [ ] Integrate SMS reminders
- [ ] Add conflict detection
- [ ] Test scheduling workflow

### Feature B4: Advanced Reporting (3 hours)

#### Report Types:
1. **Daily Summary**
   - Patients registered
   - Vitals recorded
   - Consultations completed
   - Medications dispensed
   - Stock movements

2. **Monthly Statistics**
   - Patient demographics
   - Most common diagnoses
   - Medication usage
   - Stock consumption
   - User activity

3. **Custom Reports**
   - Date range selection
   - Filter by site/provider
   - Export to Excel/PDF
   - Visual charts

#### Tasks:
- [ ] Create reports module
- [ ] Build report templates
- [ ] Add export functionality
- [ ] Implement data visualization
- [ ] Test report accuracy

### Feature B5: Multi-Site Sync (5 hours)

#### Implementation:
```typescript
interface SiteConfig {
  siteId: string
  siteName: string
  location: string
  syncMode: 'full' | 'site-only'
}

// Filter queries by site
export function withSiteFilter(query: any, siteId: string) {
  return query.eq('site_id', siteId)
}

// Cross-site patient lookup
export async function searchGlobalPatients(term: string) {
  // Search across all sites
}
```

#### Database Updates:
```sql
ALTER TABLE patients ADD COLUMN site_id text;
ALTER TABLE visits ADD COLUMN site_id text;
ALTER TABLE consultations ADD COLUMN site_id text;
ALTER TABLE dispenses ADD COLUMN site_id text;

CREATE INDEX idx_patients_site ON patients(site_id);
CREATE INDEX idx_visits_site ON visits(site_id);
```

#### Tasks:
- [ ] Add site_id to all tables
- [ ] Implement site filtering
- [ ] Create cross-site search
- [ ] Add site management UI
- [ ] Test multi-site sync
- [ ] Document site setup

### Success Criteria for Option B:
- [ ] All 5 features implemented
- [ ] Tests passing
- [ ] Documentation updated
- [ ] User acceptance testing complete
- [ ] Production deployment ready

---

## 🔧 OPTION C: Code Polish & Optimization (PRIORITY 3)

**Status:** Ready for optimization
**Duration:** 8-12 hours
**Goal:** Maximize quality, performance, and reliability

### Task C1: Increase Test Coverage to 80% (4 hours)

#### Current Coverage:
- Total tests: 49
- Passing: 32 (65%)
- Coverage: ~50%

#### Target:
- Add 30-40 more tests
- Coverage: 80%+
- All critical paths tested

#### Areas Needing Tests:
1. **Database Operations** (10 tests)
   - Patient CRUD operations
   - Vitals validation
   - Consultation workflow
   - Dispense workflow
   - Inventory updates

2. **Sync Logic** (8 tests)
   - Push changes edge cases
   - Pull changes edge cases
   - Conflict resolution scenarios
   - Queue processing

3. **UI Components** (12 tests)
   - Form validation
   - Photo capture
   - Queue board
   - Patient search
   - Conflict modal

4. **Integration Tests** (10 tests)
   - End-to-end workflows
   - Offline/online transitions
   - Multi-user scenarios

#### Tasks:
- [ ] Audit existing test coverage
- [ ] Write missing unit tests
- [ ] Add integration tests
- [ ] Fix failing tests
- [ ] Run coverage report
- [ ] Document test strategy

### Task C2: Add Error Tracking (Sentry) (2 hours)

#### Implementation:
```bash
npm install @sentry/react @sentry/tracing
```

```typescript
// src/main.tsx
import * as Sentry from "@sentry/react";
import { BrowserTracing } from "@sentry/tracing";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  integrations: [new BrowserTracing()],
  tracesSampleRate: 0.1,
  beforeSend(event, hint) {
    // Filter out non-critical errors
    if (event.level === 'warning') return null;
    return event;
  },
});
```

#### Features:
- Automatic error capture
- User context tracking
- Performance monitoring
- Release tracking
- Source maps

#### Tasks:
- [ ] Install Sentry SDK
- [ ] Configure Sentry project
- [ ] Add to main.tsx
- [ ] Test error reporting
- [ ] Configure alerts
- [ ] Document usage

### Task C3: Performance Monitoring (2 hours)

#### Metrics to Track:
1. **Load Performance**
   - First Contentful Paint (FCP)
   - Largest Contentful Paint (LCP)
   - Time to Interactive (TTI)
   - Total Blocking Time (TBT)

2. **Runtime Performance**
   - List render time
   - Search latency
   - Sync duration
   - Photo upload time

3. **Resource Usage**
   - Bundle size
   - Memory usage
   - IndexedDB size
   - Network requests

#### Implementation:
```typescript
// src/utils/performance.ts
export class PerformanceMonitor {
  static measureRender(componentName: string, callback: () => void) {
    const start = performance.now();
    callback();
    const end = performance.now();
    console.log(`${componentName} render: ${end - start}ms`);
  }

  static measureAsync(name: string, promise: Promise<any>) {
    const start = performance.now();
    return promise.finally(() => {
      const end = performance.now();
      console.log(`${name}: ${end - start}ms`);
    });
  }
}
```

#### Tasks:
- [ ] Add performance utilities
- [ ] Instrument key operations
- [ ] Set up monitoring dashboard
- [ ] Create performance budget
- [ ] Document benchmarks

### Task C4: Bundle Size Optimization (2 hours)

#### Current: 979 KB
#### Target: <900 KB (-8%)

#### Strategies:
1. **Tree Shaking**
   - Audit unused imports
   - Remove dead code
   - Use ES modules

2. **Code Splitting**
   - Lazy load heavy features
   - Split by route
   - Dynamic imports

3. **Dependency Optimization**
   - Replace heavy libraries
   - Use lighter alternatives
   - Remove duplicates

4. **Asset Optimization**
   - Compress images
   - Minify CSS
   - Optimize fonts

#### Tasks:
- [ ] Analyze bundle with vite-bundle-visualizer
- [ ] Identify heavy dependencies
- [ ] Implement lazy loading
- [ ] Optimize assets
- [ ] Verify size reduction

### Task C5: Accessibility Audit (2 hours)

#### WCAG 2.1 Compliance:
- [ ] **Perceivable**
  - All images have alt text
  - Color contrast ratios meet AA
  - Text is resizable
  - Audio prompts available

- [ ] **Operable**
  - All functions keyboard accessible
  - Touch targets ≥44x44px
  - No keyboard traps
  - Skip navigation available

- [ ] **Understandable**
  - Clear error messages
  - Consistent navigation
  - Form labels present
  - Instructions provided

- [ ] **Robust**
  - Valid HTML
  - ARIA roles correct
  - Works with screen readers
  - Mobile responsive

#### Tools:
- Lighthouse accessibility audit
- axe DevTools
- Screen reader testing (NVDA/JAWS)

#### Tasks:
- [ ] Run Lighthouse audit
- [ ] Fix accessibility issues
- [ ] Test with screen readers
- [ ] Document findings
- [ ] Verify compliance

### Success Criteria for Option C:
- [ ] Test coverage ≥80%
- [ ] Sentry integrated and working
- [ ] Performance metrics tracked
- [ ] Bundle size <900 KB
- [ ] WCAG 2.1 AA compliant

---

## 📊 COMBINED ROADMAP TIMELINE

### Week 1: Option A (Field Deployment)
**Days 1-2:**
- Set up production Supabase
- Deploy frontend
- Create admin accounts

**Days 3-4:**
- Prepare pilot devices
- Create user accounts
- Initial training sessions

**Day 5:**
- Go live with pilot sites
- Monitor closely
- Gather initial feedback

### Week 2: Option A (Support) + Option C Start
**Days 1-3:**
- Daily monitoring of pilot sites
- Address issues quickly
- Collect user feedback

**Days 4-5:**
- Start test coverage expansion
- Install Sentry
- Begin performance monitoring

### Week 3: Option B (Feature Development)
**Days 1-2:**
- SMS medication reminders
- Lab results management

**Days 3-4:**
- Appointment scheduling
- Advanced reporting

**Day 5:**
- Multi-site sync
- Integration testing

### Week 4: Option C (Polish) + Wrap-up
**Days 1-2:**
- Complete test coverage
- Bundle size optimization
- Accessibility audit

**Days 3-4:**
- Performance tuning
- Documentation updates
- Final testing

**Day 5:**
- Deploy all features
- Final review
- Celebration! 🎉

---

## 🎯 SUCCESS METRICS

### Option A (Deployment):
- ✅ Production environment live
- ✅ 2+ pilot sites operational
- ✅ 10+ trained users
- ✅ <1% sync error rate
- ✅ Zero data loss

### Option B (Features):
- ✅ 5 new features launched
- ✅ User acceptance testing passed
- ✅ Documentation complete
- ✅ Performance unchanged

### Option C (Quality):
- ✅ 80%+ test coverage
- ✅ Error tracking active
- ✅ Bundle <900 KB
- ✅ Performance improved
- ✅ WCAG AA compliant

---

## 🚀 GETTING STARTED

### To begin Option A (Recommended):
1. Review `docs/DEPLOYMENT_GUIDE.md`
2. Create Supabase account
3. Follow deployment steps
4. Set up pilot site
5. Conduct training

### To begin Option B:
1. Choose first feature (SMS recommended)
2. Review implementation plan
3. Create database migration
4. Build UI components
5. Test thoroughly

### To begin Option C:
1. Run test coverage report
2. Install Sentry
3. Audit performance
4. Optimize bundle
5. Test accessibility

---

**All documentation is now complete and ready for execution!**

*Choose your starting point based on priorities and resources available.*
