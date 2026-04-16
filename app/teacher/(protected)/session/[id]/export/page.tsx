'use client'

import { useMemo, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSession, getSessionResponses } from '@/lib/supabase/queries'
import type { Session } from '@/lib/types/database'
import { teacherLogout } from '@/app/teacher/auth-actions'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'

function formatDateUtc(isoLike: string) {
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) return isoLike
  return date.toISOString().slice(0, 10)
}

export default function SessionExport() {
  const params = useParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [responseCount, setResponseCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv')
  const realtimeTables = useMemo(
    () => [{ table: 'responses', event: 'INSERT' as const, filter: `session_id=eq.${sessionId}` }],
    [sessionId]
  )

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const sessionData = await getSession(sessionId)
        setSession(sessionData)

        const responsesData = await getSessionResponses(sessionId)
        setResponseCount(responsesData?.length || 0)
      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [sessionId])

  usePostgresChanges({
    tables: realtimeTables,
    onChange: async () => {
      try {
        const responsesData = await getSessionResponses(sessionId)
        setResponseCount(responsesData?.length || 0)
      } catch (err) {
        console.error('Error refreshing response count:', err)
      }
    },
    pollMs: 10000,
    debugLabel: `teacher-export-${sessionId}`,
  })

  const handleExport = async () => {
    try {
      setExporting(true)
      setError(null)

      if (exportFormat === 'csv') {
        const response = await fetch(`/teacher/api/export-session?sessionId=${sessionId}`)
        if (!response.ok) {
          let message = 'Export failed'
          try {
            const body = await response.json()
            if (typeof body?.error === 'string') message = body.error
          } catch {}
          throw new Error(message)
        }

        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `session-${sessionId}-export.csv`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        // JSON export
        const response = await fetch(`/teacher/api/export-session?sessionId=${sessionId}&format=json`)
        if (!response.ok) {
          let message = 'Export failed'
          try {
            const body = await response.json()
            if (typeof body?.error === 'string') message = body.error
          } catch {}
          throw new Error(message)
        }

        const data = await response.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `session-${sessionId}-export.json`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }
    } catch (err) {
      console.error('Error exporting:', err)
      setError(err instanceof Error ? err.message : 'Failed to export data')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-foreground/60">Loading session...</p>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Card className="p-6 text-center">
            <p className="text-destructive mb-4">Session not found</p>
            <Link href="/teacher/dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Export Data</h1>
            <p className="text-sm text-foreground/60 mt-1">{session.session_code}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/teacher/session/${sessionId}`}>
              <Button variant="outline">Back</Button>
            </Link>
            <form action={teacherLogout}>
              <Button variant="outline" type="submit">Log Out</Button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
          <Card className="mb-6 p-4 border-destructive/30 bg-destructive/5">
            <p className="text-destructive text-sm">{error}</p>
          </Card>
        )}

        {/* Session Summary */}
        <Card className="p-6 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-6">Session Summary</h2>
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-foreground/60 mb-2">Condition</p>
              <p className="text-2xl font-bold text-primary">
                {session.condition === 'baseline' ? 'Baseline' : 'Treatment'}
              </p>
            </div>
            <div>
              <p className="text-sm text-foreground/60 mb-2">Total Responses</p>
              <p className="text-2xl font-bold">{responseCount}</p>
            </div>
            <div>
              <p className="text-sm text-foreground/60 mb-2">Status</p>
              <p className="text-2xl font-bold capitalize text-accent">{session.status}</p>
            </div>
            <div>
              <p className="text-sm text-foreground/60 mb-2">Created</p>
              <p className="text-lg font-semibold">{formatDateUtc(session.created_at)}</p>
            </div>
          </div>
        </Card>

        {/* Export Options */}
        <Card className="p-8">
          <h2 className="text-lg font-semibold text-foreground mb-6">Export Format</h2>

          <div className="space-y-4 mb-8">
            <div className="flex items-center gap-4 p-4 rounded-lg border-2 border-primary/20 bg-primary/5 cursor-pointer">
              <input
                type="radio"
                id="csv"
                name="format"
                value="csv"
                checked={exportFormat === 'csv'}
                onChange={(e) => setExportFormat(e.target.value as 'csv')}
                className="w-4 h-4"
              />
              <label htmlFor="csv" className="flex-1 cursor-pointer">
                <div className="font-semibold text-foreground">CSV Format</div>
                <div className="text-sm text-foreground/60 mt-1">
                  Spreadsheet-compatible format. Includes session details, responses, and summary statistics.
                </div>
              </label>
            </div>

            <div className="flex items-center gap-4 p-4 rounded-lg border-2 border-border/40 hover:border-border transition-colors cursor-pointer">
              <input
                type="radio"
                id="json"
                name="format"
                value="json"
                checked={exportFormat === 'json'}
                onChange={(e) => setExportFormat(e.target.value as 'json')}
                className="w-4 h-4"
              />
              <label htmlFor="json" className="flex-1 cursor-pointer">
                <div className="font-semibold text-foreground">JSON Format</div>
                <div className="text-sm text-foreground/60 mt-1">
                  Structured data format. Best for programmatic analysis and integration with other tools.
                </div>
              </label>
            </div>
          </div>

          {/* What's Included */}
          <div className="mb-8 p-4 rounded-lg bg-secondary/30">
            <h3 className="font-semibold text-foreground mb-3">What&apos;s Included in Export:</h3>
            <ul className="space-y-2 text-sm text-foreground/70">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">✓</span>
                <span>Session metadata (code, question, condition, status, dates)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">✓</span>
                <span>All student responses with anonymized participant labels</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">✓</span>
                <span>Confidence levels for each response</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">✓</span>
                <span>Timestamps for all responses</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">✓</span>
                <span>AI analysis outputs (if generated)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-1">✓</span>
                <span>Summary statistics and confidence distribution</span>
              </li>
            </ul>
          </div>

          {/* Export Button */}
          <div className="flex gap-4">
            <Button
              onClick={handleExport}
              disabled={exporting || responseCount === 0}
              size="lg"
              className="flex-1"
            >
              {exporting ? 'Exporting...' : `Download ${exportFormat.toUpperCase()}`}
            </Button>
            <Link href={`/teacher/session/${sessionId}`} className="flex-1">
              <Button variant="outline" className="w-full" size="lg">
                Cancel
              </Button>
            </Link>
          </div>

          {responseCount === 0 && (
            <p className="text-center text-sm text-foreground/60 mt-4">
              No data available for export
            </p>
          )}
        </Card>

        {/* Info Box */}
        <Card className="p-6 mt-8 border-accent/20 bg-accent/5">
          <h3 className="font-semibold text-foreground mb-2">Data Privacy</h3>
          <p className="text-sm text-foreground/70">
            This export contains sensitive student response data. Please ensure it is handled in accordance with
            your institution&apos;s data privacy policies and applicable regulations.
          </p>
        </Card>
      </div>
    </main>
  )
}
