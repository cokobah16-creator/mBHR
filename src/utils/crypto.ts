// Web Crypto utilities for PIN hashing and optional encryption

const PBKDF2_ITERATIONS = 200000 // High iteration count for security
const SALT_LENGTH = 16 // 16 bytes = 128 bits

export async function generateSalt(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

export async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder()
  const pinData = encoder.encode(pin)
  
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
      salt: salt,
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

export async function verifyPin(pin: string, hash: string, salt: Uint8Array): Promise<boolean> {
  const computedHash = await hashPin(pin, salt)
  return computedHash === hash
}

export function saltToString(salt: Uint8Array): string {
  return Array.from(salt)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function saltFromString(saltStr: string): Uint8Array {
  const bytes = []
  for (let i = 0; i < saltStr.length; i += 2) {
    bytes.push(parseInt(saltStr.substr(i, 2), 16))
  }
  return new Uint8Array(bytes)
}

export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Encryption facade (stub for now - pass-through)
export async function encrypt(data: string): Promise<string> {
  // TODO: Implement AES-GCM encryption for sensitive data
  return data
}

export async function decrypt(encryptedData: string): Promise<string> {
  // TODO: Implement AES-GCM decryption
  return encryptedData
}