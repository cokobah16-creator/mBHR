# Test Session Management

## Quick Test (2 Minutes)

### 1. Clear Cache
```javascript
// Open browser console (F12)
localStorage.removeItem('mbhr-auth')
console.log('Cache cleared')
```

### 2. Login
- Go to `/login`
- Enter PIN: `111111` (or your admin PIN)
- Should login successfully

### 3. Check Session Created
```javascript
// In console
const auth = JSON.parse(localStorage.getItem('mbhr-auth') || '{}')
console.log('Session expires:', new Date(auth.state?.sessionExpiresAt))
console.log('Hours remaining:', (auth.state?.sessionExpiresAt - Date.now()) / 1000 / 60 / 60)
// Should show ~12 hours
```

### 4. Test Persistence
1. Refresh page (F5)
2. **Expected:** Still logged in
3. **Console:** `[Auth] Session restored successfully`

### 5. Test Activity Extension
```javascript
// In console, check current expiry
const before = JSON.parse(localStorage.getItem('mbhr-auth')).state.sessionExpiresAt

// Wait 1 second, click around the app

// Check if updated
const after = JSON.parse(localStorage.getItem('mbhr-auth')).state.sessionExpiresAt

console.log('Extended?', after > before)
// If < 1 hour remaining, should be true
```

---

## Full Test (5 Minutes)

### Test 1: Fresh Login
```javascript
// 1. Clear everything
localStorage.clear()

// 2. Login via UI

// 3. Verify session
const auth = JSON.parse(localStorage.getItem('mbhr-auth')).state
console.log('Authenticated:', auth.isAuthenticated)
console.log('User:', auth.currentUser?.fullName)
console.log('Expires:', new Date(auth.sessionExpiresAt))

// Expected: All should be populated
```

### Test 2: Page Reload
```javascript
// 1. Login first

// 2. Check session expiry
const before = JSON.parse(localStorage.getItem('mbhr-auth')).state.sessionExpiresAt
console.log('Before reload:', new Date(before))

// 3. Refresh page (F5)

// 4. Check session restored
const after = JSON.parse(localStorage.getItem('mbhr-auth')).state.sessionExpiresAt
console.log('After reload:', new Date(after))
console.log('Still logged in:', !!after)

// Expected: Still logged in, same expiry time
```

### Test 3: Grace Period
```javascript
// 1. Manually set expiry to recent past (simulate expired)
const auth = JSON.parse(localStorage.getItem('mbhr-auth'))
auth.state.sessionExpiresAt = Date.now() - 120000  // 2 minutes ago
localStorage.setItem('mbhr-auth', JSON.stringify(auth))

// 2. Refresh page

// 3. Check session
const renewed = JSON.parse(localStorage.getItem('mbhr-auth')).state.sessionExpiresAt
console.log('Renewed?', renewed > Date.now())

// Expected: Session auto-renewed (within grace period)
```

### Test 4: True Expiry
```javascript
// 1. Set expiry to long ago (beyond grace period)
const auth = JSON.parse(localStorage.getItem('mbhr-auth'))
auth.state.sessionExpiresAt = Date.now() - 600000  // 10 minutes ago
localStorage.setItem('mbhr-auth', JSON.stringify(auth))

// 2. Refresh page

// 3. Check session
const expired = JSON.parse(localStorage.getItem('mbhr-auth')).state?.isAuthenticated
console.log('Logged out?', !expired)

// Expected: Logged out, redirected to /login
```

### Test 5: Activity Tracking
```javascript
// 1. Login

// 2. Manually set expiry to 30 minutes from now
const auth = JSON.parse(localStorage.getItem('mbhr-auth'))
auth.state.sessionExpiresAt = Date.now() + (30 * 60 * 1000)
localStorage.setItem('mbhr-auth', JSON.stringify(auth))

// 3. Click around, scroll, type

// 4. Check if extended
setTimeout(() => {
  const newAuth = JSON.parse(localStorage.getItem('mbhr-auth'))
  const hoursRemaining = (newAuth.state.sessionExpiresAt - Date.now()) / 1000 / 60 / 60
  console.log('Hours remaining:', hoursRemaining)
  console.log('Extended?', hoursRemaining > 11)  // Should be ~12 hours
}, 2000)

// Expected: Session extended to 12 hours
```

---

## Automated Test Script

```javascript
// Copy-paste this entire block into browser console

(async function testSessionManagement() {
  console.log('🧪 Testing Session Management...\n')

  // Test 1: Clear and verify
  console.log('Test 1: Clear Cache')
  localStorage.removeItem('mbhr-auth')
  console.log('✅ Cache cleared\n')

  // Test 2: Check session structure after login
  console.log('Test 2: Login and check structure')
  console.log('👉 Please login via UI, then run next test\n')

  return {
    test3: () => {
      console.log('Test 3: Verify session created')
      const auth = JSON.parse(localStorage.getItem('mbhr-auth') || '{}')
      if (!auth.state?.isAuthenticated) {
        console.log('❌ Not logged in')
        return
      }
      console.log('✅ Authenticated:', auth.state.currentUser?.fullName)
      console.log('✅ Session expires:', new Date(auth.state.sessionExpiresAt))
      const hours = (auth.state.sessionExpiresAt - Date.now()) / 1000 / 60 / 60
      console.log('✅ Hours remaining:', hours.toFixed(1))
      console.log(hours > 10 ? '✅ Duration looks good' : '⚠️ Duration seems short')
    },

    test4: () => {
      console.log('\nTest 4: Refresh page test')
      console.log('👉 Refresh page (F5), then check console logs')
      console.log('Expected: [Auth] Session restored successfully\n')
    },

    test5: () => {
      console.log('\nTest 5: Grace period test')
      const auth = JSON.parse(localStorage.getItem('mbhr-auth'))
      auth.state.sessionExpiresAt = Date.now() - 120000
      localStorage.setItem('mbhr-auth', JSON.stringify(auth))
      console.log('✅ Set expiry to 2 minutes ago')
      console.log('👉 Refresh page (F5), should auto-renew\n')
    },

    test6: () => {
      console.log('\nTest 6: True expiry test')
      const auth = JSON.parse(localStorage.getItem('mbhr-auth'))
      auth.state.sessionExpiresAt = Date.now() - 600000
      localStorage.setItem('mbhr-auth', JSON.stringify(auth))
      console.log('✅ Set expiry to 10 minutes ago')
      console.log('👉 Refresh page (F5), should logout\n')
    },

    cleanup: () => {
      console.log('\nCleanup: Resetting session')
      localStorage.removeItem('mbhr-auth')
      console.log('✅ Done. Login again for fresh session\n')
    }
  }
})().then(tests => {
  console.log('📋 Test suite loaded. Available commands:')
  console.log('  tests.test3() - Verify session structure')
  console.log('  tests.test4() - Test page refresh')
  console.log('  tests.test5() - Test grace period')
  console.log('  tests.test6() - Test true expiry')
  console.log('  tests.cleanup() - Reset everything\n')
  console.log('Start with: tests.test3()\n')
  return tests
})
```

---

## Expected Results

### ✅ Good Session
```javascript
{
  isAuthenticated: true,
  currentUser: {
    id: "...",
    fullName: "...",
    role: "admin"
  },
  sessionExpiresAt: 1234567890000,  // Future timestamp
  lastActivityAt: 1234567890000      // Recent timestamp
}
```

### ❌ Expired Session
```javascript
{
  isAuthenticated: false,
  currentUser: null,
  sessionExpiresAt: null,
  lastActivityAt: null
}
```

---

## Console Logs Reference

| Log Message | Meaning |
|-------------|---------|
| `[Auth] Session restored successfully` | Session loaded from cache |
| `[Auth] Session expired on rehydration` | Session truly expired |
| `[Auth] Session within grace period, extending` | Auto-renewed |
| `[Auth] Session extended due to activity` | Extended by user activity |
| `[Auth] Found users: X` | Login process started |
| `[Auth] PIN valid for ...: true` | Successful login |

---

## Quick Verification Checklist

- [ ] Clear cache
- [ ] Login successful
- [ ] Console shows "Session restored successfully"
- [ ] Page refresh keeps you logged in
- [ ] Session duration ~12 hours
- [ ] Activity extends session
- [ ] Grace period works (2 min ago = auto-renew)
- [ ] True expiry works (10 min ago = logout)

---

## Production Monitoring

### Metrics To Track
```javascript
// Add to analytics
{
  event: 'session_restored',
  timeRemaining: (expiresAt - now) / 1000,
  withinGracePeriod: boolean
}
```

### Error Tracking
```javascript
// Track unexpected logouts
if (sessionExpiresAt && isAuthenticated && timeRemaining < -300000) {
  console.error('Session expired unexpectedly', {
    expiresAt: new Date(sessionExpiresAt),
    now: new Date(),
    timeRemaining
  })
}
```

---

## Summary

**Quick test:** 2 minutes - login, refresh, still logged in?
**Full test:** 5 minutes - all scenarios covered
**Automated:** Copy-paste script, follow prompts

**All tests passing = Production ready ✅**
