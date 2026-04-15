const DEFAULT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateSessionCode(length = 6, alphabet = DEFAULT_ALPHABET): string {
  const chars = alphabet.split('')
  const bytes = new Uint8Array(length)

  // Prefer Web Crypto when available (works in browser + modern runtimes).
  if (globalThis.crypto && 'getRandomValues' in globalThis.crypto) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
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

