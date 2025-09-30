// PBKDF2-based PIN hashing with salt for stronger security

const PBKDF2_ITERATIONS = 100_000 // Strong iteration count
const SALT_LENGTH = 16 // 16 bytes = 128 bits

export async function derivePinHash(pin: string, saltB64: string): Promise<string> {
  const encoder = new TextEncoder()
  const pinData = encoder.encode(pin)
  
  // Decode base64 salt
  const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0))
  
  const key = await crypto.subtle.importKey(
    'raw',
    pinData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    key,
    256 // 32 bytes
  )
  
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function newSaltB64(): string {
  const saltArray = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  return btoa(String.fromCharCode(...saltArray))
}

export async function verifyPin(pin: string, hash: string, saltB64: string): Promise<boolean> {
  const computedHash = await derivePinHash(pin, saltB64)
  return computedHash === hash
}