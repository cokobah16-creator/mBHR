# mBHR Architecture Overview

## System Architecture

### High-Level Overview
mBHR is an offline-first Progressive Web App (PWA) for medical record management in low-resource settings.

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  ┌────────────┬──────────────┬──────────────────┐  │
│  │   Pages    │  Components  │    Features      │  │
│  └────────────┴──────────────┴──────────────────┘  │
│  ┌────────────┬──────────────┬──────────────────┐  │
│  │  Stores    │  Validation  │  Operations Queue│  │
│  │  (Zustand) │  (Zod)       │                  │  │
│  └────────────┴──────────────┴──────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │         Local Database (Dexie/IndexedDB)     │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────┐
│              Sync Layer (Bidirectional)              │
│  ┌──────────────┬──────────────┬─────────────────┐ │
│  │ Push Changes │ Pull Changes │ Conflict Resolve│ │
│  └──────────────┴──────────────┴─────────────────┘ │
└─────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────┐
│              Supabase Backend                        │
│  ┌────────────┬──────────────┬──────────────────┐  │
│  │ PostgreSQL │   Auth       │  Edge Functions  │  │
│  └────────────┴──────────────┴──────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Core Components

### 1. Data Layer (`/src/db/`)
- **Purpose**: Offline-first data persistence
- **Technology**: Dexie.js (IndexedDB wrapper)
- **Key Files**:
  - `index.ts` - Main database schema
  - `mbhr.ts` - Healthcare-specific tables
  - `gamification.ts` - Gamification features
  - `outbox.ts` - Message queue for SMS/WhatsApp

**Database Tables**:
- `patients` - Patient demographics
- `visits` - Medical visits
- `vitals` - Vital signs
- `consultations` - SOAP notes
- `dispenses` - Medication dispensing
- `inventory` - Stock management
- `tickets` - Queue management
- `gamificationWallets` - User achievement tracking

### 2. State Management (`/src/stores/`)
- **Technology**: Zustand with persistence
- **Key Stores**:
  - `auth.ts` - Authentication state
  - `patients.ts` - Patient management
  - `queue.ts` - Queue operations
  - `operationsQueue.ts` - **NEW** Offline operation queue
  - `syncStore.ts` - Sync status tracking
  - `toast.ts` - Toast notifications
  - `gamification.ts` - Achievement tracking

### 3. Validation Layer (`/src/validation/`)
- **Technology**: Zod schemas
- **Purpose**: Centralized form validation
- **Schemas**:
  - Patient registration
  - Vitals recording
  - SOAP documentation
  - Medication dispensing
  - Inventory management
  - User creation

### 4. Sync Layer (`/src/sync/`)
- **Purpose**: Bidirectional data synchronization
- **Components**:
  - `adapter.ts` - Supabase sync adapter
  - `mbhrAdapter.ts` - Healthcare-specific sync
- **Features**:
  - Cursor-based incremental sync
  - Conflict detection
  - Dirty flag tracking
  - Field-level mapping

### 5. UI Components

#### Core Components (`/src/components/`)
- Forms: Patient, Vitals, SOAP, Dispense
- ConflictResolutionModal - **NEW** Sync conflict resolution
- PatientSearch - Fuzzy search with phonetic matching
- QueueBoard - Real-time queue display
- ErrorBoundary - Error handling

#### Feature Modules (`/src/features/`)
- **Analytics**: Usage dashboards
- **Gamification**:
  - VitalsPrecisionGame
  - QueueMaestro
  - KnowledgeBlitz
  - ApprovalInbox
- **Pharmacy**:
  - FEFODispenser (First Expiry First Out)
  - EnhancedPharmacy
  - PharmacyStock
- **Triage**:
  - QuickTriage
  - TriageSprint
- **Inventory**:
  - RestockGame
  - PrizeShop

## Data Flow

### 1. Create Operation
```
User Input → Form Validation → Add to Local DB →
Mark as Dirty → Queue Operation → Background Sync
```

### 2. Read Operation
```
Read from Local DB → Display →
Background Pull from Server → Update if Changed
```

### 3. Update Operation
```
User Edit → Validation → Update Local DB →
Check for Conflicts → Resolve or Queue → Sync
```

### 4. Sync Process
```
1. Push dirty records to server
2. Pull new/updated records from server
3. Detect conflicts (same record modified)
4. Show conflict resolution UI
5. Apply resolution strategy
6. Update cursors
```

## Operations Queue System

### Purpose
Ensures reliable operation execution even with intermittent connectivity.

### Features
- **Priority-based**: High, normal, low priority operations
- **Retry logic**: Exponential backoff (1s → 2s → 4s → 8s max)
- **Failure handling**: Max retry limits, error tracking
- **Persistence**: Survives page reloads
- **Metrics**: Track success/failure rates

### Flow
```
Operation Added → Queued (pending) → Processing →
Success (completed) | Failure (retry or failed)
```

## Conflict Resolution

### Detection
Conflicts occur when:
1. Record modified locally (dirty flag set)
2. Same record modified on server (newer updated_at)
3. Push attempt finds version mismatch

### Resolution Strategies
1. **Keep Local**: Overwrite server with local changes
2. **Keep Remote**: Discard local changes
3. **Manual**: Field-by-field selection

### UI Features
- Side-by-side comparison
- Timestamp display
- Visual field selection
- Type-aware formatting

## Internationalization (i18n)

### Supported Languages
- English (en)
- Hausa (ha)
- Igbo (ig)
- Pidgin (pcm)
- Yoruba (yo)

### Implementation
- **Library**: i18next + react-i18next
- **Location**: `/src/i18n/locales/`
- **Features**:
  - Language detection
  - Dynamic loading
  - Audio prompts for low-literacy users

## PWA Features

### Service Worker
- Workbox-based
- Precaches critical assets (974KB)
- Runtime caching strategies
- Background sync

### Offline Support
- Full CRUD operations offline
- Automatic sync on reconnection
- Queue pending operations
- Conflict resolution on sync

### Install Prompt
- Custom install UI
- Platform detection (iOS/Android/Desktop)
- One-time prompt with persistence

## Security

### Authentication
- PIN-based login
- Role-based access control (RBAC)
- Roles: nurse, doctor, pharmacist, admin
- Temporary admin elevation

### Row-Level Security (RLS)
- Supabase RLS policies
- User isolation
- Audit logging
- Site-based data filtering

### Data Protection
- Client-side encryption for sensitive fields
- No sensitive data in localStorage
- Secure transmission (HTTPS)
- Session timeout handling

## Performance Optimizations

### Bundle Size
- Code splitting by route
- Lazy loading for features
- Tree shaking
- Vendor chunking
- Total: 974KB (gzipped)

### Database Performance
- Indexed queries
- Compound indexes for common queries
- Query result caching
- Pagination for large datasets

### UI Performance
- Virtual scrolling for long lists
- Debounced search
- Optimistic updates
- Memoized components
- Touch-optimized interactions

## Testing Strategy

### Unit Tests (Vitest)
- Validation schemas
- Utility functions
- Store actions
- Component logic

### Integration Tests
- Database operations
- Sync adapter
- Form submissions
- Navigation flows

### E2E Tests (Playwright)
- User workflows
- Cross-browser testing
- Mobile responsive
- Offline scenarios

### Coverage Requirements
- 60% minimum coverage
- Focus on critical paths
- Integration over unit tests

## Deployment

### Build Process
```bash
npm run build
```
- TypeScript compilation
- Vite bundling
- PWA manifest generation
- Service worker generation
- Asset optimization

### Hosting
- Static file hosting
- Supabase backend
- CDN for assets
- Edge functions for serverless logic

## Future Enhancements

### Planned Features
1. Photo capture and storage
2. Signature capture for consent
3. Biometric authentication
4. Voice commands
5. Barcode scanning for medications
6. Lab results integration
7. Telemedicine support
8. Automated reporting
9. Machine learning for triage
10. Multi-site sync coordination

### Technical Improvements
1. Strict TypeScript throughout
2. 80% test coverage
3. Performance monitoring
4. Error tracking (Sentry)
5. Analytics dashboard
6. A/B testing framework
7. Feature flags
8. Database migrations automation

## Development Guidelines

### Code Organization
- Feature-based structure
- Shared utilities in `/src/utils/`
- Centralized types in `/src/types/`
- Co-located tests with source files

### Naming Conventions
- Components: PascalCase
- Files: camelCase or kebab-case
- Constants: UPPER_SNAKE_CASE
- Database tables: snake_case

### Best Practices
1. Offline-first design
2. Progressive enhancement
3. Accessibility (WCAG 2.1 AA)
4. Mobile-first responsive
5. Error boundaries
6. Loading states
7. Optimistic updates
8. Graceful degradation

## Resources

- [Project README](../README.md)
- [Sprint 2 Complete](../SPRINT_2_COMPLETE.md)
- [Testing Guide](./TESTING_GUIDE.md)
- [Supabase Docs](https://supabase.com/docs)
- [Dexie.js Docs](https://dexie.org)
- [React Docs](https://react.dev)
