# Med Bridge Health Reach (mBHR)

An offline-first Progressive Web App (PWA) for Nigerian medical outreach programs.

## Features

- **Offline-First**: Works completely offline with IndexedDB storage
- **Secure Authentication**: PIN-based login with PBKDF2 hashing
- **Role-Based Access**: Admin, Doctor, Nurse, Pharmacist, Volunteer roles
- **Patient Management**: Registration, vitals, consultations, dispensing
- **Queue Management**: Track patients through care stages
- **PWA Support**: Installable, works offline, responsive design
- **Nigerian Context**: States/LGAs, phone formatting, cultural considerations
- **Televisits**: Patients request video visits from the portal; staff schedule them and share a Jitsi link by SMS

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run type checking
npm run typecheck

# Run linting
npm run lint
```

## First Run Setup

Production builds ship with no staff accounts, so the first time the app opens
on a device it sends you to `/setup` to create the administrator:

1. Open the app in your browser
2. Enter the administrator's full name
3. Choose and confirm a 6-digit PIN — it is stored only on this device and
   cannot be recovered, so write it down somewhere safe
4. You are signed in automatically; add the rest of the staff from **Users**

The setup screen refuses to run once any staff account exists, so it cannot be
used to mint an admin on a device that is already provisioned.

Development builds (`npm run dev`) seed demo staff instead and skip setup; those
demo PINs are listed in the login page's debug panel and never exist in a
production build.

## Architecture

- **Frontend**: React 18 + TypeScript + Vite
- **Routing**: React Router v6
- **State**: Zustand stores
- **Database**: Dexie (IndexedDB wrapper)
- **Styling**: Tailwind CSS
- **Forms**: React Hook Form + Zod validation
- **i18n**: i18next (English + Nigerian languages)
- **PWA**: Workbox service worker

## Database Schema

- `users` - System users with roles and PIN authentication
- `patients` - Patient demographics and contact info
- `visits` - Patient visit sessions
- `vitals` - Vital signs with auto-flagging
- `consultations` - SOAP notes and diagnoses
- `dispenses` - Medication dispensing records
- `inventory` - Stock management
- `queue` - Patient flow through care stages
- `sessions` - User authentication sessions
- `settings` - App configuration
- `auditLogs` - Activity tracking

## Security Features

- PIN-based authentication with PBKDF2-SHA256 hashing
- Exponential backoff after failed login attempts
- Role-based access control
- Audit logging for all actions
- No guest access - authentication required

## Offline Capabilities

- Complete functionality without internet
- Local data storage in IndexedDB
- Service worker for offline caching
- Background sync when online (optional)

## Nigerian Localization

- Nigerian states and LGAs data
- Phone number formatting (+234)
- Multi-language support (EN, Hausa, Yoruba, Igbo)
- Cultural design considerations

## Optional Cloud Sync

To enable cloud sync, add Supabase configuration to `.env`:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key

# Optional on Vercel with Supabase integration:
# If only SUPABASE_URL / SUPABASE_ANON_KEY are set, the Vite build now maps
# them automatically to the client VITE_ variables.
```

Then run the SQL migration to create the database schema:

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of `supabase/migrations/create_sync_schema.sql`
4. Execute the migration

The app will automatically detect the configuration and enable background sync!

### Migration File Location

The complete SQL migration is located at:

```
supabase/migrations/create_sync_schema.sql
```

This migration creates all necessary tables, indexes, and Row Level Security policies for syncing your offline data with Supabase.

## Acceptance Tests

### A1: First Run Setup

- A device with no staff account is redirected from `/login` to `/setup`
- Create the admin with a confirmed 6-digit PIN
- Create additional users
- Login with offline PIN
- Dashboard shows with offline badge

### A2: Patient Registration

- Register patient with photo
- Start visit
- Patient appears in queue

### A3: Vitals Recording

- Enter vital signs
- BMI auto-calculates
- Abnormal values trigger flags

### A4: Consultation

- Add SOAP notes
- Record provisional diagnosis
- Save offline

### A5: Pharmacy

- Dispense medication
- Inventory decrements
- Low stock warnings

### A6: Offline Resilience

- Disable internet
- Hard refresh
- Data persists
- Register new patient

### A7: Data Export

- Export CSV files
- Verify data integrity

### A8: Online Sync (Optional)

- Add Supabase keys
- Online login available
- Offline PIN still works
- Sync logs activity

## Development

The app is built with strict TypeScript, ESLint, and includes error boundaries to catch JSX mistakes early.

Key directories:

- `/src/db` - Database schema and utilities
- `/src/stores` - Zustand state management
- `/src/components` - Reusable UI components
- `/src/pages` - Route components
- `/src/utils` - Helper functions
- `/src/i18n` - Internationalization

## License

Built for the Dr. Isioma Okobah Foundation medical outreach programs.
