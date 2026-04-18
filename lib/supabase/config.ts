type SupabasePublicConfig = {
  url: string
  anonKey: string
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing')
  }

  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing')
  }

  return { url, anonKey }
}
