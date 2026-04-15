import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Lightweight, password-based teacher gate for prototypes.
 *
 * - Credentials live only in server-side env vars (never NEXT_PUBLIC_).
 * - On successful login we set an HTTP-only cookie containing a signed token.
 * - Teacher pages + teacher-only server actions validate this cookie server-side.
 */

const TEACHER_COOKIE_NAME = 'sd_teacher_session'
const TEACHER_COOKIE_PATH = '/teacher'

type TeacherSessionPayload = {
  v: 1
  exp: number // unix seconds
  u?: string // username (optional)
}

function base64UrlEncode(input: Buffer | string) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecodeToString(input: string) {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64').toString('utf8')
}

function constantTimeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

function getAuthConfig() {
  const password = process.env.TEACHER_DASHBOARD_PASSWORD || ''
  const username = process.env.TEACHER_DASHBOARD_USERNAME || ''
  const maxAgeSeconds =
    Number(process.env.TEACHER_DASHBOARD_SESSION_MAX_AGE_SECONDS || '') || 60 * 60 * 8 // 8 hours

  if (!password) {
    throw new Error(
      'Missing TEACHER_DASHBOARD_PASSWORD. Set it in your server environment variables.'
    )
  }

  // Derive a signing key from configured secrets (prototype-friendly; for production use a dedicated secret).
  const signingKey = `${username}::${password}`
  return { username, password, signingKey, maxAgeSeconds }
}

function sign(payloadB64: string, signingKey: string) {
  const sig = createHmac('sha256', signingKey).update(payloadB64).digest()
  return base64UrlEncode(sig)
}

function createSessionToken(payload: TeacherSessionPayload, signingKey: string) {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signatureB64 = sign(payloadB64, signingKey)
  return `${payloadB64}.${signatureB64}`
}

function verifySessionToken(token: string, signingKey: string): TeacherSessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, signatureB64] = parts

  const expectedSig = sign(payloadB64, signingKey)
  if (!constantTimeEqual(signatureB64, expectedSig)) return null

  try {
    const payload = JSON.parse(base64UrlDecodeToString(payloadB64)) as TeacherSessionPayload
    if (payload.v !== 1) return null
    if (typeof payload.exp !== 'number') return null
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp <= now) return null
    return payload
  } catch {
    return null
  }
}

export function isTeacherUsernameRequired() {
  return Boolean(process.env.TEACHER_DASHBOARD_USERNAME)
}

export async function setTeacherSessionCookie(username?: string) {
  const { signingKey, maxAgeSeconds } = getAuthConfig()
  const now = Math.floor(Date.now() / 1000)
  const token = createSessionToken({ v: 1, exp: now + maxAgeSeconds, u: username || undefined }, signingKey)
  const store = await cookies()
  store.set(TEACHER_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: TEACHER_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  })
}

export async function clearTeacherSessionCookie() {
  const store = await cookies()
  store.set(TEACHER_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: TEACHER_COOKIE_PATH,
    maxAge: 0,
  })
}

export async function getTeacherSession(): Promise<TeacherSessionPayload | null> {
  const { signingKey } = getAuthConfig()
  const store = await cookies()
  const token = store.get(TEACHER_COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionToken(token, signingKey)
}

export async function assertTeacherAuthenticated() {
  const session = await getTeacherSession()
  if (!session) throw new Error('Unauthorized')
  return session
}

export function verifyTeacherCredentials(input: { username?: string; password?: string }) {
  const { username: requiredUsername, password: requiredPassword } = getAuthConfig()
  const providedPassword = input.password ?? ''
  const providedUsername = input.username ?? ''

  if (!constantTimeEqual(providedPassword, requiredPassword)) return false
  if (requiredUsername) {
    return constantTimeEqual(providedUsername, requiredUsername)
  }
  return true
}

