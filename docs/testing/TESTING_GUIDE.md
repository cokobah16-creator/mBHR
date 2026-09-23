# Testing Guide for mBHR

## Overview
This guide explains how to write and run tests for the mBHR medical application.

## Test Structure

```
project/
├── src/
│   ├── test/
│   │   ├── setup.ts          # Global test configuration
│   │   └── utils.tsx          # Custom render and test utilities
│   └── **/*.test.ts(x)        # Unit tests alongside source files
└── e2e/
    └── *.spec.ts              # End-to-end tests
```

## Unit Testing with Vitest

### Writing a Test

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/utils'
import { MyComponent } from './MyComponent'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('should handle click events', async () => {
    const { user } = userEvent.setup()
    render(<MyComponent />)

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('Clicked')).toBeInTheDocument()
  })
})
```

### Running Tests

```bash
# Run tests in watch mode (development)
npm test

# Run tests once
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

### Coverage Thresholds
- Lines: 60%
- Functions: 60%
- Branches: 60%
- Statements: 60%

## E2E Testing with Playwright

### Writing an E2E Test

```typescript
import { test, expect } from '@playwright/test'

test.describe('Patient Registration', () => {
  test('should register a new patient', async ({ page }) => {
    await page.goto('/register')

    await page.fill('input[name="givenName"]', 'John')
    await page.fill('input[name="familyName"]', 'Doe')
    await page.selectOption('select[name="sex"]', 'male')

    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/patients\/\w+/)
  })
})
```

### Running E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Run specific test file
npx playwright test e2e/login.spec.ts

# Run in debug mode
npx playwright test --debug
```

## Testing Patterns

### Testing Forms

```typescript
import { render, screen } from '@/test/utils'
import { PatientForm } from '@/components/PatientForm'

describe('PatientForm', () => {
  it('should validate required fields', async () => {
    render(<PatientForm />)

    // Submit without filling fields
    await userEvent.click(screen.getByRole('button', { name: /register/i }))

    // Check for validation errors
    expect(screen.getByText(/given name is required/i)).toBeInTheDocument()
  })
})
```

### Testing Database Operations

```typescript
import { db } from '@/db'
import { addPatient } from '@/stores/patients'

describe('Patient Operations', () => {
  beforeEach(async () => {
    // Clear test database
    await db.patients.clear()
  })

  it('should add a patient to the database', async () => {
    const patientData = {
      givenName: 'John',
      familyName: 'Doe',
      // ... other fields
    }

    const patientId = await addPatient(patientData)
    const patient = await db.patients.get(patientId)

    expect(patient).toBeDefined()
    expect(patient?.givenName).toBe('John')
  })
})
```

### Testing Validation Schemas

```typescript
import { patientSchema } from '@/validation/schemas'

describe('Patient Schema', () => {
  it('should accept valid data', () => {
    const validData = {
      givenName: 'John',
      familyName: 'Doe',
      sex: 'male',
      // ... other fields
    }

    expect(() => patientSchema.parse(validData)).not.toThrow()
  })

  it('should reject invalid phone', () => {
    const invalidData = {
      // ... valid fields
      phone: 'invalid',
    }

    expect(() => patientSchema.parse(invalidData)).toThrow()
  })
})
```

### Testing Async Operations

```typescript
import { waitFor } from '@testing-library/react'

describe('Async Operations', () => {
  it('should load data on mount', async () => {
    render(<MyComponent />)

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    })

    // Check data is displayed
    expect(screen.getByText(/data loaded/i)).toBeInTheDocument()
  })
})
```

## Best Practices

### 1. Test Behavior, Not Implementation
```typescript
// ❌ Bad - testing implementation
expect(component.state.count).toBe(1)

// ✅ Good - testing behavior
expect(screen.getByText('Count: 1')).toBeInTheDocument()
```

### 2. Use Accessible Queries
```typescript
// ❌ Avoid
screen.getByTestId('submit-button')

// ✅ Prefer
screen.getByRole('button', { name: /submit/i })
```

### 3. Keep Tests Isolated
```typescript
describe('MyTests', () => {
  beforeEach(() => {
    // Reset state before each test
  })

  afterEach(() => {
    // Clean up after each test
  })
})
```

### 4. Mock External Dependencies
```typescript
import { vi } from 'vitest'

vi.mock('@/services/api', () => ({
  fetchData: vi.fn(() => Promise.resolve({ data: 'mocked' }))
}))
```

### 5. Test Edge Cases
```typescript
describe('Edge Cases', () => {
  it('should handle empty data', () => {
    render(<MyComponent data={[]} />)
    expect(screen.getByText(/no data/i)).toBeInTheDocument()
  })

  it('should handle errors gracefully', async () => {
    // Mock error
    vi.mocked(fetchData).mockRejectedValueOnce(new Error('Failed'))

    render(<MyComponent />)

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })
})
```

## Debugging Tests

### Vitest Debugging
```bash
# Run tests in debug mode
node --inspect-brk node_modules/.bin/vitest

# Use Chrome DevTools
chrome://inspect
```

### Playwright Debugging
```bash
# Run in headed mode
npx playwright test --headed

# Run with debug inspector
npx playwright test --debug

# Pause on failure
npx playwright test --trace on
```

### Common Issues

**Issue**: Test times out
```typescript
// Increase timeout for slow operations
test('slow operation', async () => {
  // ...
}, 10000) // 10 second timeout
```

**Issue**: Elements not found
```typescript
// Wait for element to appear
await waitFor(() => {
  expect(screen.getByText('Expected')).toBeInTheDocument()
})
```

**Issue**: Async updates not reflected
```typescript
// Use act() for async updates
import { act } from '@testing-library/react'

await act(async () => {
  // async operation
})
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:run
      - run: npm run test:e2e
```

## Resources
- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Playwright Documentation](https://playwright.dev/)
- [Jest DOM Matchers](https://github.com/testing-library/jest-dom)
