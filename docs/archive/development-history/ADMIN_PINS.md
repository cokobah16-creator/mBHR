# Admin PIN System

## Overview

The mBHR application uses a secure PIN-based authentication system for offline operation. Each user has a 6-digit PIN that is hashed using PBKDF2 with a random salt before being stored in the local IndexedDB database.

## Demo PINs (development only)

`npm run dev` seeds these demo accounts so the app can be tried locally.
Production builds create **no** accounts: a new device goes to first-run
setup (`/setup`), where the first administrator chooses their own PIN.
Real PINs must never be written into this repository.

| User Name | Role | PIN |
|-----------|------|-----|
| Admin User | admin | `123456` |
| Dr. Sarah Johnson | doctor | `234567` |
| Nurse Mary | nurse | `345678` |
| Pharmacist John | pharmacist | `456789` |
| Volunteer Mike | volunteer | `567890` |

## Security Features

- **PBKDF2 Hashing**: Uses 100,000 iterations of PBKDF2 with SHA-256
- **Random Salts**: Each user has a unique 128-bit random salt
- **No Plaintext Storage**: PINs are never stored in plaintext
- **Lockout Protection**: 5 failed attempts trigger a 15-minute lockout

## How the System Works

### 1. Database Seeding (`src/db/seed.ts`)

When the app first starts and the database is empty:
1. The seed function generates a random salt for each user
2. It derives the PIN hash using PBKDF2
3. Only the salt and hash are stored in the database

### 2. Login Process (`src/stores/auth.ts`)

When a user attempts to login:
1. The entered PIN is validated (must be 6 digits)
2. All active users are retrieved from the database
3. For each user, the system:
   - Uses the stored salt to hash the entered PIN
   - Compares the computed hash with the stored hash
   - If they match, authentication succeeds

### 3. PIN Hashing (`src/utils/pin.ts`)

The PIN hashing utility provides:
- `derivePinHash(pin, salt)` - Computes PBKDF2 hash
- `newSaltB64()` - Generates new random salt
- `verifyPin(pin, hash, salt)` - Verifies a PIN against stored hash

## Troubleshooting

### If PINs don't work:

1. **Check the browser console** for authentication errors from the auth store.
   PINs are never logged.

2. **Reset the device** (administrator approval required):
   - Sign in as an admin, open **Settings** → **Device recovery**, then
     re-enter your admin PIN. It is not available from the login page.
   - If no administrator can sign in, the only option left is clearing this
     site's data in the browser settings, which loses anything not yet synced.
   - This deletes every patient, visit and staff account on the device,
     including anything not yet synced, and the device returns to first-run
     setup.

### Common Issues:

**"Invalid PIN" with correct PIN**
- Database might be corrupted — ask an administrator to reset the device from
  **Settings** (see above if no administrator can sign in)

**Lockout after 5 attempts**
- Wait 15 minutes. Wrong admin PINs in the reset form count towards the same
  lockout.

## Development Notes

### Adding New Users

To add new default users, edit `src/db/seed.ts`:

```typescript
const users = [
  {
    fullName: 'New User',
    role: 'doctor' as const,
    pin: '111222',  // 6 digits
    adminAccess: false,
    adminPermanent: false
  },
  // ... existing users
]
```

### Changing PIN Requirements

Edit validation in `src/stores/auth.ts`:

```typescript
if (!/^\d{6}$/.test(pin)) {  // Change regex for different format
  state.incrementFailedAttempts()
  return false
}
```

### Adjusting Security Parameters

Edit `src/utils/pin.ts`:

```typescript
const PBKDF2_ITERATIONS = 100_000  // Higher = more secure but slower
const SALT_LENGTH = 16  // 16 bytes = 128 bits
```

## Confidentiality

The login page has no debug panel: it never shows staff names, salts or
hashes, and PINs are never written to the console.
