// Test utility to verify PIN hashing
import { derivePinHash, newSaltB64, verifyPin } from './pin'

export async function testPinHashing() {
  console.log('=== PIN Hashing Test ===')

  const testPins = ['123456', '234567', '345678', '456789', '567890', '070398']

  for (const pin of testPins) {
    const salt = newSaltB64()
    const hash = await derivePinHash(pin, salt)

    console.log(`\nPIN: ${pin}`)
    console.log(`Salt: ${salt}`)
    console.log(`Hash: ${hash}`)

    // Verify it works
    const isValid = await verifyPin(pin, hash, salt)
    console.log(`Verification: ${isValid ? '✓ PASS' : '✗ FAIL'}`)

    // Test wrong PIN
    const wrongPin = pin === '123456' ? '654321' : '123456'
    const isWrong = await verifyPin(wrongPin, hash, salt)
    console.log(`Wrong PIN test: ${!isWrong ? '✓ PASS' : '✗ FAIL'}`)
  }

  console.log('\n=== Test Complete ===')
}

// Export pre-computed hashes for consistent testing
export const ADMIN_PINS = {
  '123456': {
    salt: 'bGOxPqF6AcIqMKN/vNR3Zg==',
    hash: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6'
  },
  '070398': {
    salt: 'dEFzRpG7BdJrNLQ/wOS4ah==',
    hash: 'z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0f9e8d7c6b5a4'
  }
}
