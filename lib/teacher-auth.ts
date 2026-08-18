import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Teacher accounts, backed by the `teachers` table.
 *
 * - Each teacher has their own username + bcrypt-hashed password row.
 * - On successful login we set an HTTP-only cookie containing a signed token
 *   that identifies the teacher (teacherId + username), not just "a teacher is logged in".
 * - Teacher pages + teacher-only server actions validate this cookie server-side.
 */

const TEACHER_COOKIE_NAME = 'sd_teacher_session'
// Must include `/api/*` so teacher-only API routes can validate the session cookie.
// Teacher pages remain protected by server-side checks.
const TEACHER_COOKIE_PATH = '/'

export type TeacherAccount = {
  id: string
  username: string
  name: string | null
}

type TeacherSessionPayload = {
  v: 2
  exp: number // unix seconds
  teacherId: string
  username: string
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

function sessionSigningKey() {
  // Sessions are now per-teacher, so the signing key can no longer be derived
  // from a single shared username/password. Use a dedicated secret, falling
  // back to the Supabase service role key so existing deployments keep working
  // without extra config.
  const secret = process.env.TEACHER_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!secret) {
    throw new Error(
      'Missing TEACHER_SESSION_SECRET. Set it in your server environment variables.'
    )
  }
  return secret
}

function sessionMaxAgeSeconds() {
  return Number(process.env.TEACHER_DASHBOARD_SESSION_MAX_AGE_SECONDS || '') || 60 * 60 * 8 // 8 hours
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
    if (payload.v !== 2) return null
    if (typeof payload.exp !== 'number') return null
    if (typeof payload.teacherId !== 'string' || !payload.teacherId) return null
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp <= now) return null
    return payload
  } catch {
    return null
  }
}

export async function setTeacherSessionCookie(teacher: TeacherAccount) {
  const signingKey = sessionSigningKey()
  const maxAgeSeconds = sessionMaxAgeSeconds()
  const now = Math.floor(Date.now() / 1000)
  const token = createSessionToken(
    { v: 2, exp: now + maxAgeSeconds, teacherId: teacher.id, username: teacher.username },
    signingKey
  )
  const store = await cookies()
  // Clear any legacy cookie that may have been set with path "/teacher" so we don't end up with
  // multiple cookies with the same name but different paths.
  store.set(TEACHER_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/teacher',
    maxAge: 0,
  })
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
  // Clear both current and legacy paths.
  for (const path of ['/', '/teacher']) {
    store.set(TEACHER_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path,
      maxAge: 0,
    })
  }
}

export async function getTeacherSession(): Promise<TeacherSessionPayload | null> {
  const signingKey = sessionSigningKey()
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

export async function verifyTeacherCredentials(input: {
  username?: string
  password?: string
}): Promise<TeacherAccount | null> {
  const username = (input.username ?? '').trim().toLowerCase()
  const password = input.password ?? ''
  if (!username || !password) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('teachers')
    .select('id, username, name, password_hash, is_active')
    .eq('username', username)
    .maybeSingle()

  if (error) {
    console.error('teacher login: lookup error', error)
    return null
  }
  if (!data) {
    console.warn(`teacher login: no teacher row for username "${username}"`)
    return null
  }
  if (!data.is_active) {
    console.warn(`teacher login: teacher "${username}" is not active`)
    return null
  }

  const ok = await bcrypt.compare(password, data.password_hash)
  if (!ok) {
    console.warn(`teacher login: password mismatch for username "${username}"`)
    return null
  }

  return { id: data.id, username: data.username, name: data.name }
}
