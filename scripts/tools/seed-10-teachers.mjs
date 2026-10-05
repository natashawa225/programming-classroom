import bcrypt from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// Read env variables manually
const envPath = join(process.cwd(), '.env')
const envContent = readFileSync(envPath, 'utf8')
const env = {}
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const match = trimmed.match(/^([^=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
}

const teachers = [
  { username: 'teacher01', password: 'K7mPq2Xz', name: 'Teacher 01' },
  { username: 'teacher02', password: 'R4nVt8Lw', name: 'Teacher 02' },
  { username: 'teacher03', password: 'B9sYh3Jd', name: 'Teacher 03' },
  { username: 'teacher04', password: 'F6wQm1Np', name: 'Teacher 04' },
  { username: 'teacher05', password: 'T2gKx7Vc', name: 'Teacher 05' },
  { username: 'teacher06', password: 'H8jZr4Ms', name: 'Teacher 06' },
  { username: 'teacher07', password: 'D3pLw9Qf', name: 'Teacher 07' },
  { username: 'teacher08', password: 'N5vBt6Yk', name: 'Teacher 08' },
  { username: 'teacher09', password: 'X1cRm8Gh', name: 'Teacher 09' },
  { username: 'teacher10', password: 'W7qFn2Jz', name: 'Teacher 10' },
]

async function run() {
  console.log('Hashing passwords and generating SQL seed...')
  
  const sqlStatements = ['BEGIN;']
  const processedTeachers = []

  for (const t of teachers) {
    const hash = bcrypt.hashSync(t.password, 10)
    processedTeachers.push({
      username: t.username,
      name: t.name,
      password_hash: hash,
      is_active: true,
    })

    const usernameEsc = t.username.replace(/'/g, "''")
    const nameEsc = t.name.replace(/'/g, "''")
    const hashEsc = hash.replace(/'/g, "''")

    sqlStatements.push(`
INSERT INTO teachers (username, name, password_hash, is_active)
VALUES ('${usernameEsc}', '${nameEsc}', '${hashEsc}', true)
ON CONFLICT (username) DO UPDATE
SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, is_active = EXCLUDED.is_active;`)
  }

  sqlStatements.push('\nCOMMIT;\n')

  const sqlContent = sqlStatements.join('\n')
  const outputDir = join(process.cwd(), 'scripts', 'generated')
  mkdirSync(outputDir, { recursive: true })
  const sqlPath = join(outputDir, 'teacher_seed_10_accounts.sql')
  writeFileSync(sqlPath, sqlContent, 'utf8')
  console.log(`Saved SQL seed to ${sqlPath}`)

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Supabase credentials missing in env.', { supabaseUrl, hasKey: !!supabaseServiceKey })
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  console.log('Inserting/Upserting teachers into Supabase...')
  const { data, error } = await supabase
    .from('teachers')
    .upsert(processedTeachers, { onConflict: 'username' })

  if (error) {
    console.error('Error inserting into Supabase:', error)
    process.exit(1)
  }

  console.log('Successfully upserted 10 teacher accounts into Supabase!')
}

run().catch(console.error)
