import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const cookieStore = await cookies()
    const all = cookieStore.getAll()

    for (const c of all) {
      if (!c.name.startsWith('sd_sp_')) continue

      for (const path of ['/student', '/']) {
        cookieStore.set(c.name, '', {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path,
          maxAge: 0,
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('student logout error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to log out.' },
      { status: 500 }
    )
  }
}
