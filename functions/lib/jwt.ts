const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface TokenClaims {
  userId: number
  tokenVersion: number
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function signToken(
  userId: number,
  tokenVersion: number,
  purpose: 'access' | 'reset',
  minutes: number,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        sub: String(userId),
        tv: tokenVersion,
        purpose,
        iat: now,
        exp: now + minutes * 60,
      }),
    ),
  )
  const data = `${header}.${payload}`
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data))
  return `${data}.${base64url(new Uint8Array(signature))}`
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

export async function verifyToken(
  token: string,
  purpose: 'access' | 'reset',
  secret: string,
): Promise<TokenClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  let valid = false
  try {
    const expected = new Uint8Array(
      await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${header}.${payload}`)),
    )
    valid = timingSafeEqual(expected, fromBase64url(signature))
  } catch {
    return null
  }
  if (!valid) return null

  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(decoder.decode(fromBase64url(payload))) as Record<string, unknown>
  } catch {
    return null
  }
  if (claims.purpose !== purpose) return null
  const expires = Number(claims.exp)
  if (!Number.isFinite(expires) || expires * 1000 <= Date.now()) return null
  const userId = Number(claims.sub)
  if (!Number.isSafeInteger(userId) || userId <= 0) return null
  const tokenVersion = Number(claims.tv ?? 0)
  return { userId, tokenVersion: Number.isFinite(tokenVersion) ? tokenVersion : 0 }
}
