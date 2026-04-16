const DEFAULT_SESSION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateSessionCode(
  length = 6,
  alphabet: string = DEFAULT_SESSION_ALPHABET
): string {
  const chars = alphabet.split('').filter(Boolean)
  if (chars.length === 0) throw new Error('Alphabet must not be empty')

  // Use Web Crypto when available (browser + modern Node). Fallback to Math.random.
  const bytes = new Uint8Array(length)
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }

  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += chars[bytes[i] % chars.length]
  }
  return out
}

export function formatAnonymizedLabel(index1Based: number): string {
  const safe = Number.isFinite(index1Based) && index1Based > 0 ? Math.floor(index1Based) : 1
  const width = safe < 100 ? 2 : safe < 1000 ? 3 : String(safe).length
  return `P${String(safe).padStart(width, '0')}`
}

