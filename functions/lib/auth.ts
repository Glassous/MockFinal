const encoder = new TextEncoder()
const ITERATIONS = 600_000
const DERIVED_BITS = 256
const FORMAT = 'pbkdf2'

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    DERIVED_BITS,
  )
  return new Uint8Array(bits)
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derive(secret, salt, ITERATIONS)
  return `${FORMAT}$${ITERATIONS}$${base64(salt)}$${base64(derived)}`
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== FORMAT) return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  try {
    const salt = fromBase64(parts[2])
    const expected = fromBase64(parts[3])
    const actual = await derive(secret, salt, iterations)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** 安全问题答案：strip + lower 后再哈希（与原实现一致）。 */
export function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase()
}

export async function hashAnswer(answer: string): Promise<string> {
  return hashSecret(normalizeAnswer(answer))
}

export async function verifyAnswer(answer: string, stored: string): Promise<boolean> {
  return verifySecret(normalizeAnswer(answer), stored)
}
