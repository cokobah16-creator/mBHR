# Admin PIN System

## Overview

The mBHR application uses a secure PIN-based authentication system for offline operation. Each user has a 6-digit PIN that is hashed using PBKDF2 with a random salt before being stored in the local IndexedDB database.

## Default Admin PINs

The following PINs are created automatically when the database is seeded:

| User Name | Role | PIN | Admin Access | Permanent |
|-----------|------|-----|--------------|-----------|
| Admin User | admin | `123456` | Yes | No |
| Dr. Sarah Johnson | doctor | `234567` | No | No |
| Nurse Mary | nurse | `345678` | No | No |
| Pharmacist John | pharmacist | `456789` | No | No |
| Volunteer Mike | volunteer | `567890` | No | No |
| Kristopher Okobah | admin | `070398` | Yes | Yes |

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

1. **Check the browser console** - Look for seed logs:
   ```
   🌱 Starting database seeding...
   🌱 Creating demo users...
   Creating user: Admin User, PIN: 123456
   ✅ Users created with PINs: 123456, 234567, 345678, 456789, 567890, 070398
   ```

2. **Clear the database** - Use the "Reset local data" button on the login page:
   - This clears IndexedDB and localStorage
   - The app will reload and reseed automatically

3. **Check for errors** - Look for authentication errors:
   ```
   [auth] Found users: 6
   [auth] Checking PIN for user: Admin User admin
   [auth] PIN valid for Admin User: true
   ```

4. **Verify database state** - Click "Show debug" on login page to see:
   - Number of active users
   - Partial salt and hash values
   - List of known PINs

### Common Issues:

**"No users found"**
- Database hasn't been seeded
- Click "Reset local data" to reseed

**"Invalid PIN" with correct PIN**
- Database might be corrupted
- Salt/hash mismatch (shouldn't happen with current implementation)
- Try "Reset local data"

**Lockout after 5 attempts**
- Wait 15 minutes or clear browser data
- Use "Reset local data" to immediately clear lockout

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
  console.log('Invalid PIN format:', pin)
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

## Testing

The system includes detailed logging for debugging:

1. **Seed logs** show user creation with PIN/salt/hash
2. **Auth logs** show PIN verification attempts
3. **Debug panel** shows active users and hash computation

All PINs should work immediately after a database reset. If they don't, check the browser console for detailed error messages.
