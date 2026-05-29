'use client'

import type React from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { StudentLogoutButton } from '@/components/student-logout-button'

type StudentHistorySession = {
  sessionParticipantId: string
  sessionId: string
  sessionCode: string
  title: string
  question: string
  condition: 'baseline' | 'treatment'
  status: string
  livePhase: string
  joinedAt: string
  questionCount: number
  responseCount: number
  revisionResponseCount: number
  questions: Array<{
    questionId: string
    position: number
    prompt: string
    initialAnswer: StudentHistoryAnswer | null
    revisionAnswer: StudentHistoryAnswer | null
  }>
}

type StudentHistoryAnswer = {
  responseId: string
  answer: string
  confidence: number
  createdAt: string
}

type StudentSummary = {
  headline: string
  overall_summary: string
  strengths: string[]
  needs_practice: string[]
  confidence_insight: string
  question_cards: Array<{
    question_id: string
    question_text: string
    initial_answer: string | null
    revision_answer: string | null
    initial_confidence: number | null
    revision_confidence: number | null
    cluster_feedback: {
      student_title: string | null
      reasoning_pattern: string | null
      what_you_understood: string | null
      likely_gap: string | null
      micro_hint: string | null
      try_again_prompt: string | null
      counterexample: string | null
      confidence_check: string | null
    } | null
    improvement: {
      movement_label: string
      alignment_delta: number | null
      confidence_delta: number | null
      short_interpretation: string
    }
  }>
  recommended_next_steps: string[]
  analysis_status: 'ok' | 'fallback' | 'partial'
  fallback_used: boolean
  fallback_reason: string | null
  warnings: string[]
}

const palette = {
  yellow: {
    fill: 'rgba(255, 228, 144, 0.28)',
    border: 'rgba(255, 199, 84, 0.55)',
    dot: '#F0B93B',
    badgeBg: 'rgba(255, 246, 220, 1)',
    badgeText: '#A97800',
  },
  blue: {
    fill: 'rgba(216, 232, 243, 0.38)',
    border: 'rgba(123, 175, 212, 0.45)',
    dot: '#7BAFD4',
    badgeBg: 'rgba(238, 244, 249, 1)',
    badgeText: '#4E7FA2',
  },
  purple: {
    fill: 'rgba(231, 223, 255, 0.35)',
    border: 'rgba(169, 119, 255, 0.38)',
    dot: '#A977FF',
    badgeBg: 'rgba(243, 236, 255, 1)',
    badgeText: '#8A57FF',
  },
}

type PaletteTone = keyof typeof palette

function toneStyle(tone: PaletteTone): React.CSSProperties {
  return {
    backgroundColor: palette[tone].fill,
    borderColor: palette[tone].border,
  }
}

function badgeStyle(tone: PaletteTone): React.CSSProperties {
  return {
    backgroundColor: palette[tone].badgeBg,
    color: palette[tone].badgeText,
    borderColor: palette[tone].border,
  }
}

function statusTone(status: string): PaletteTone {
  return status === 'Completed' ? 'blue' : 'yellow'
}

function safeFilenamePart(value: string | null | undefined) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'unknown'
}

type PdfTextItem = {
  kind: 'text'
  text: string
  x: number
  y: number
  size: number
  bold?: boolean
}

type PdfRuleItem = {
  kind: 'rule'
  x1: number
  x2: number
  y: number
}

type PdfItem = PdfTextItem | PdfRuleItem

function isCjkCharacter(char: string) {
  const code = char.codePointAt(0) || 0
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function pdfCharWidthUnit(char: string) {
  if (/\s/.test(char)) return 0.28
  if (isCjkCharacter(char)) return 1
  if (/[A-Z]/.test(char)) return 0.62
  if (/[a-z0-9]/.test(char)) return 0.52
  if (/[,.;:!?'"()[\]{}\-_/\\]/.test(char)) return 0.34
  return 0.62
}

function approximatePdfTextWidth(text: string, size: number) {
  return Array.from(text).reduce((sum, char) => sum + pdfCharWidthUnit(char) * size, 0)
}

function tokenizePdfText(text: string) {
  const tokens: string[] = []
  let current = ''

  for (const char of Array.from(text)) {
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      tokens.push(' ')
    } else if (isCjkCharacter(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      tokens.push(char)
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

function splitOversizedPdfToken(token: string, maxWidth: number, size: number) {
  const parts: string[] = []
  let current = ''

  for (const char of Array.from(token)) {
    const candidate = `${current}${char}`
    if (current && approximatePdfTextWidth(candidate, size) > maxWidth) {
      parts.push(current)
      current = char
    } else {
      current = candidate
    }
  }

  if (current) parts.push(current)
  return parts
}

function wrapPdfText(text: string, maxWidth: number, size: number) {
  const paragraphs = String(text || '—')
    .replace(/\t/g, ' ')
    .split(/\r?\n/)
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    const clean = paragraph.replace(/\s+/g, ' ').trim()
    if (!clean) {
      lines.push('')
      continue
    }

    let current = ''

    for (const token of tokenizePdfText(clean)) {
      if (token === ' ' && !current) continue

      const tokenWidth = approximatePdfTextWidth(token, size)
      if (tokenWidth > maxWidth) {
        if (current) {
          lines.push(current.trimEnd())
          current = ''
        }
        lines.push(...splitOversizedPdfToken(token, maxWidth, size))
      } else if (!current) {
        current = token
      } else if (approximatePdfTextWidth(`${current}${token}`, size) <= maxWidth) {
        current = `${current}${token}`
      } else {
        lines.push(current.trimEnd())
        current = token.trimStart()
      }
    }

    if (current) lines.push(current.trimEnd())
  }

  return lines.length > 0 ? lines : ['—']
}

function pdfHexString(text: string) {
  const hex = ['FEFF']
  for (let index = 0; index < text.length; index += 1) {
    hex.push(text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase())
  }
  return `<${hex.join('')}>`
}

function buildStudentSummaryPdf(input: {
  session: StudentHistorySession
  participantId: string | null
}) {
  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 48
  const contentWidth = pageWidth - margin * 2
  const pages: PdfItem[][] = [[]]
  let y = margin

  const currentPage = () => pages[pages.length - 1]
  const addPage = () => {
    pages.push([])
    y = margin
  }

  const addText = (
    text: string,
    options: {
      size?: number
      bold?: boolean
      indent?: number
      gapAfter?: number
      lineHeight?: number
    } = {}
  ) => {
    const size = options.size ?? 10
    const indent = options.indent ?? 0
    const lineHeight = options.lineHeight ?? size * 1.45
    const lines = wrapPdfText(text, contentWidth - indent, size)

    for (const line of lines) {
      if (y + lineHeight > pageHeight - margin) addPage()
      currentPage().push({
        kind: 'text',
        text: line || ' ',
        x: margin + indent,
        y,
        size,
        bold: options.bold,
      })
      y += lineHeight
    }

    y += options.gapAfter ?? 8
  }

  const addRule = () => {
    if (y + 20 > pageHeight - margin) addPage()
    y += 6
    currentPage().push({
      kind: 'rule',
      x1: margin,
      x2: pageWidth - margin,
      y,
    })
    y += 16
  }

  const addAnswer = (label: string, answer: StudentHistoryAnswer | null, emptyText?: string) => {
    addText(label, { size: 10, bold: true, gapAfter: 4 })
    if (!answer) {
      addText(emptyText || 'Not submitted', { size: 10, indent: 12, gapAfter: 12 })
      return
    }
    addText(`Confidence: ${answer.confidence}/5`, { size: 9, indent: 12, gapAfter: 4 })
    addText(answer.answer, { size: 10, indent: 12, gapAfter: 12 })
  }

  addText('Student Session Summary', { size: 20, bold: true, gapAfter: 14, lineHeight: 24 })
  addText(`Participant ID: ${input.participantId || 'Unknown'}`, { size: 10, gapAfter: 4 })
  addText(`Session code: ${input.session.sessionCode}`, { size: 10, gapAfter: 4 })
  addText(`Session type: ${sessionTypeLabel(input.session.condition)}`, { size: 10, gapAfter: 4 })
  addText(`Status: ${formatStatus(input.session)}`, { size: 10, gapAfter: 4 })
  addText(`Joined: ${formatDate(input.session.joinedAt)}`, { size: 10, gapAfter: 14 })

  if (input.session.question) {
    addText('Session prompt', { size: 12, bold: true, gapAfter: 5 })
    addText(input.session.question, { size: 10, gapAfter: 14 })
  }

  addRule()

  if (input.session.questions.length === 0) {
    addText('No question details are available for this session.', { size: 10 })
  } else if (input.session.responseCount + input.session.revisionResponseCount === 0) {
    addText('No responses recorded for this session yet.', { size: 10 })
  } else {
    input.session.questions
      .slice()
      .sort((a, b) => a.position - b.position)
      .forEach((question, index) => {
        if (index > 0) addRule()
        addText(`Question ${question.position}`, { size: 13, bold: true, gapAfter: 6 })
        addText(question.prompt, { size: 10, gapAfter: 12 })
        addAnswer(input.session.condition === 'baseline' ? 'Your response' : 'Initial response', question.initialAnswer)
        if (input.session.condition === 'treatment') {
          addAnswer('Revision response', question.revisionAnswer, 'No revision submitted')
        }
      })
  }

  pages.forEach((page, index) => {
    page.push({
      kind: 'text',
      text: `Generated from MeshQuiz student summary · Page ${index + 1} of ${pages.length}`,
      x: margin,
      y: pageHeight - 28,
      size: 8,
    })
  })

  const objects: string[] = []
  const addObject = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>')
  const pagesId = addObject('')
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const pageIds: number[] = []

  for (const page of pages) {
    const commands = page
      .map((item) => {
        if (item.kind === 'rule') {
          const pdfY = pageHeight - item.y
          return `0.82 0.82 0.82 RG 0.8 w ${item.x1.toFixed(2)} ${pdfY.toFixed(2)} m ${item.x2.toFixed(2)} ${pdfY.toFixed(2)} l S`
        }

        const line = item
        const font = line.bold ? 'F2' : 'F1'
        const pdfY = pageHeight - line.y
        return `BT /${font} ${line.size} Tf 1 0 0 1 ${line.x.toFixed(2)} ${pdfY.toFixed(2)} Tm ${pdfHexString(line.text)} Tj ET`
      })
      .join('\n')
    const contentId = addObject(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new Blob([pdf], { type: 'application/pdf' })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function formatDate(value: string) {
  if (!value) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatStatus(session: StudentHistorySession) {
  if (session.livePhase === 'session_completed' || session.status === 'closed') return 'Completed'
  if (session.status === 'live' || session.status === 'revision') return 'Active'
  return session.status ? session.status.charAt(0).toUpperCase() + session.status.slice(1) : 'Active'
}

function isCompletedSession(session: StudentHistorySession) {
  return formatStatus(session) === 'Completed'
}

function sessionTypeLabel(_condition: StudentHistorySession['condition']) {
  return 'Session'
}

function movementDisplayLabel(value: string) {
  const labels: Record<string, string> = {
    strong_improvement: 'Strong improvement',
    partial_improvement: 'Partly improved',
    stable_strong: 'Stable and strong',
    stable_needs_review: 'Review again',
    possible_regression: 'Compare attempts',
    confidence_miscalibration: 'Confidence check',
    no_revision: 'No revision',
    no_response: 'No response',
    unclear: 'Unclear',
  }
  return labels[value] || 'Unclear'
}

function AnswerPreview({
  label,
  answer,
  emptyText,
  tone = 'blue',
}: {
  label: string
  answer: StudentHistoryAnswer | null
  emptyText?: string
  tone?: PaletteTone
}) {
  if (!answer) {
    return (
      <div className="rounded-xl border border-dashed p-3 text-sm text-foreground/50" style={{ borderColor: 'rgba(148, 163, 184, 0.35)' }}>
        {emptyText || `${label}: not submitted`}
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-3 text-sm" style={toneStyle(tone)}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground/45">
        <span>{label}</span>
        <span>Confidence {answer.confidence}/5</span>
      </div>
      <p className="whitespace-pre-wrap text-foreground/75">{answer.answer}</p>
    </div>
  )
}

function ResponseBadge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: PaletteTone }) {
  return (
    <span className="rounded-full border px-2.5 py-1 text-xs font-medium" style={badgeStyle(tone)}>
      {children}
    </span>
  )
}

export default function StudentSessions() {
  const router = useRouter()
  const [participantId, setParticipantId] = useState<string | null>(null)
  const [history, setHistory] = useState<StudentHistorySession[]>([])
  const [sessionCode, setSessionCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [summaryBySessionId, setSummaryBySessionId] = useState<Record<string, StudentSummary>>({})
  const [summaryLoadingId, setSummaryLoadingId] = useState<string | null>(null)
  const [pdfGeneratingId, setPdfGeneratingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadDashboard = async () => {
      try {
        setLoading(true)
        setError(null)

        const accountResponse = await fetch('/api/student/account', { cache: 'no-store' })
        const accountPayload = await accountResponse.json().catch(() => null)
        if (!accountResponse.ok) {
          throw new Error(accountPayload?.error || 'Failed to load student account.')
        }
        if (!accountPayload?.participant) {
          router.replace('/student/join')
          return
        }

        const historyResponse = await fetch('/api/student/sessions', { cache: 'no-store' })
        const historyPayload = await historyResponse.json().catch(() => null)
        if (!historyResponse.ok) {
          throw new Error(historyPayload?.error || 'Failed to load previous sessions.')
        }

        if (!cancelled) {
          setParticipantId(accountPayload.participant.participant_id)
          setHistory((historyPayload?.sessions || []) as StudentHistorySession[])
        }
      } catch (err) {
        console.error('Error loading student dashboard:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load your dashboard.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDashboard()
    return () => {
      cancelled = true
    }
  }, [router])

  const handleJoinSession = async (e: React.FormEvent) => {
    e.preventDefault()
    setJoining(true)
    setError(null)

    try {
      const response = await fetch('/api/student/join-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to join session.')
      }

      router.push(`/student/respond/${payload.session.id}`)
    } catch (err) {
      console.error('Error joining session:', err)
      setError(err instanceof Error ? err.message : 'Unable to join that session.')
    } finally {
      setJoining(false)
    }
  }

  const handleViewSession = async (session: StudentHistorySession) => {
    const nextExpanded = expandedSessionId === session.sessionParticipantId ? null : session.sessionParticipantId
    setExpandedSessionId(nextExpanded)
    if (!nextExpanded || summaryBySessionId[session.sessionId]) return

    try {
      setSummaryLoadingId(session.sessionParticipantId)
      const response = await fetch(`/api/student/sessions/${session.sessionId}/summary`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load this student summary.')
      }
      const summary = payload?.summary as StudentSummary | undefined
      if (!summary) {
        throw new Error('Summary data was not returned.')
      }
      setSummaryBySessionId((current) => ({
        ...current,
        [session.sessionId]: summary,
      }))
    } catch (err) {
      console.error('Error loading student summary:', err)
      setError(err instanceof Error ? err.message : 'Unable to load this session summary.')
    } finally {
      setSummaryLoadingId(null)
    }
  }

  const handleSessionAction = (session: StudentHistorySession) => {
    if (!isCompletedSession(session)) {
      router.push(`/student/respond/${session.sessionId}`)
      return
    }

    void handleViewSession(session)
  }

  const handleExportPdf = async (session: StudentHistorySession) => {
    try {
      setPdfGeneratingId(session.sessionParticipantId)
      setError(null)

      const pdfBlob = buildStudentSummaryPdf({ session, participantId })
      downloadBlob(pdfBlob, `student-summary-${safeFilenamePart(participantId)}-${safeFilenamePart(session.sessionCode)}.pdf`)
    } catch (err) {
      console.error('Error exporting PDF:', err)
      setError(err instanceof Error ? err.message : 'Unable to export this session as a PDF.')
    } finally {
      setPdfGeneratingId(null)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ backgroundColor: '#fbfbfa' }}>
        <div className="text-xl">
          <p>Loading...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#fbfbfa' }}>
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur-sm" style={{ borderColor: 'rgba(148, 163, 184, 0.18)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Student Dashboard</h1>
            <p className="text-sm text-foreground/60 mt-1">
              Logged in as <span className="font-medium text-foreground">{participantId}</span>
            </p>
          </div>
          <StudentLogoutButton />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <Card className="rounded-2xl border p-6 shadow-sm sm:p-8" style={{ ...toneStyle('blue'), backgroundColor: 'rgba(246, 250, 252, 0.96)' }}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-foreground/50">Join session</p>
              <h2 className="mt-2 text-3xl font-bold text-foreground">Enter your class code</h2>
              <p className="mt-2 text-foreground/65">
                Enter the code your teacher shared. The session will open the right activity for your class.
              </p>
            </div>
            <form onSubmit={handleJoinSession} className="w-full max-w-md space-y-3">
              <label htmlFor="sessionCode" className="sr-only">
                Session code
              </label>
              <Input
                id="sessionCode"
                type="text"
                value={sessionCode}
                onChange={(event) => setSessionCode(event.target.value.toUpperCase().replace(/\s+/g, ''))}
                placeholder="SESSION CODE"
                className="h-14 text-center text-lg tracking-widest"
                style={{ borderColor: palette.blue.border }}
                disabled={joining}
                required
              />
              <Button
                type="submit"
                size="lg"
                className="w-full border-0 shadow-sm"
                style={{ backgroundColor: palette.blue.dot, color: '#ffffff' }}
                disabled={joining || !sessionCode.trim()}
              >
                {joining ? 'Joining...' : 'Join Session'}
              </Button>
            </form>
          </div>

          {error && (
            <div className="mt-6 rounded-xl border p-4" style={toneStyle('yellow')}>
              <p className="text-sm" style={{ color: palette.yellow.badgeText }}>{error}</p>
            </div>
          )}
        </Card>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Previous sessions</h2>
              <p className="text-sm text-foreground/60">Newest sessions appear first.</p>
            </div>
          </div>

          {history.length === 0 ? (
            <Card className="rounded-2xl border bg-white p-8 text-center shadow-sm" style={{ borderColor: 'rgba(148, 163, 184, 0.18)' }}>
              <h3 className="text-lg font-semibold text-foreground">No previous sessions yet.</h3>
              <p className="mt-2 text-sm text-foreground/60">Enter a session code above when your teacher starts class.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {history.map((session) => (
                <Card key={session.sessionParticipantId} className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: 'rgba(148, 163, 184, 0.18)' }}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold text-foreground">{session.title}</h3>
                        <span
                          className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize"
                          style={badgeStyle(session.condition === 'treatment' ? 'purple' : 'blue')}
                        >
                          {sessionTypeLabel(session.condition)}
                        </span>
                        <span
                          className="rounded-full border px-2.5 py-1 text-xs font-medium"
                          style={badgeStyle(statusTone(formatStatus(session)))}
                        >
                          {formatStatus(session)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-foreground/55">
                        Code {session.sessionCode} · Joined {formatDate(session.joinedAt)}
                      </p>
                      {session.question && (
                        <p className="mt-2 line-clamp-2 text-sm text-foreground/70">{session.question}</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className={`grid gap-2 text-sm ${session.condition === 'treatment' ? 'grid-cols-2 sm:w-56' : 'grid-cols-1 sm:w-32'}`}>
                        <div className="rounded-xl border px-3 py-2" style={toneStyle('blue')}>
                          <p className="text-foreground/50">{session.condition === 'baseline' ? 'Responses' : 'Initial'}</p>
                          <p className="text-lg font-semibold text-foreground">{session.responseCount}</p>
                        </div>
                        {session.condition === 'treatment' && (
                          <div className="rounded-xl border px-3 py-2" style={toneStyle('purple')}>
                            <p className="text-foreground/50">Revisions</p>
                            <p className="text-lg font-semibold text-foreground">{session.revisionResponseCount}</p>
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleSessionAction(session)}
                        style={badgeStyle('blue')}
                      >
                        {!isCompletedSession(session)
                          ? 'Continue live session'
                          : summaryLoadingId === session.sessionParticipantId
                            ? 'Loading...'
                            : expandedSessionId === session.sessionParticipantId
                              ? 'Hide summary'
                              : 'View summary'}
                      </Button>
                    </div>
                  </div>
                  {expandedSessionId === session.sessionParticipantId && (
                    <div className="student-summary-print-root mt-4 space-y-5 rounded-2xl border p-4 print:border-0 print:bg-white print:p-0">
                      <div className="rounded-2xl border bg-white p-5 print:border-0 print:p-0" style={{ borderColor: palette.purple.border }}>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Student session summary</p>
                            <h4 className="mt-2 text-2xl font-semibold text-foreground">{session.title}</h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <ResponseBadge tone="blue">Participant {participantId || '—'}</ResponseBadge>
                              <ResponseBadge tone="blue">Code {session.sessionCode}</ResponseBadge>
                              <ResponseBadge tone={statusTone(formatStatus(session))}>{formatStatus(session)}</ResponseBadge>
                              <ResponseBadge tone="blue">Joined {formatDate(session.joinedAt)}</ResponseBadge>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleExportPdf(session)}
                            className="student-summary-print-hide w-full lg:w-auto"
                            style={badgeStyle('purple')}
                            disabled={pdfGeneratingId === session.sessionParticipantId}
                          >
                            {pdfGeneratingId === session.sessionParticipantId ? 'Generating PDF...' : 'Export as PDF'}
                          </Button>
                        </div>
                      </div>
                      {summaryBySessionId[session.sessionId] ? (
                        <div className="rounded-2xl border p-4 print:border print:border-gray-200 print:bg-white">
                          {summaryBySessionId[session.sessionId].analysis_status === 'fallback' && (
                            <div className="mb-4 rounded-xl border p-3 text-sm" style={{ ...toneStyle('yellow'), color: palette.yellow.badgeText }}>
                              <p className="font-semibold">Fallback analysis used</p>
                              <p className="mt-1">
                                We could not generate the full AI summary, so this page is using a safer template-based summary from your saved answers, confidence, and cluster labels.
                              </p>
                            </div>
                          )}
                          {summaryBySessionId[session.sessionId].analysis_status === 'partial' && (
                            <div className="mb-4 rounded-xl border p-3 text-sm" style={{ ...toneStyle('blue'), color: palette.blue.badgeText }}>
                              <p className="font-semibold">Some analysis is not available yet</p>
                              <p className="mt-1">
                                {session.condition === 'baseline'
                                  ? 'Your answers are shown, but cluster feedback may be missing because the teacher has not generated analysis for this session yet.'
                                  : 'Your answers and revisions are shown, but cluster feedback may be missing because the teacher has not generated analysis for this session yet.'}
                              </p>
                            </div>
                          )}
                          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: palette.purple.badgeText }}>Your summary</p>
                          <h4 className="mt-2 text-xl font-semibold text-foreground">
                            {summaryBySessionId[session.sessionId].headline}
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-foreground/70">
                            {summaryBySessionId[session.sessionId].overall_summary}
                          </p>
                          <div className="mt-4 grid gap-3 lg:grid-cols-3">
                            <div className="rounded-xl border p-3" style={toneStyle('blue')}>
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Strengths</p>
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/70">
                                {summaryBySessionId[session.sessionId].strengths.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-xl border p-3" style={toneStyle('yellow')}>
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Needs practice</p>
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/70">
                                {summaryBySessionId[session.sessionId].needs_practice.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-xl border p-3" style={toneStyle('purple')}>
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Confidence</p>
                              <p className="mt-2 text-sm leading-6 text-foreground/70">
                                {summaryBySessionId[session.sessionId].confidence_insight}
                              </p>
                            </div>
                          </div>
                          {summaryBySessionId[session.sessionId].warnings.length > 0 && (
                            <details className="mt-4 rounded-xl border p-3 text-sm" style={{ ...toneStyle('yellow'), color: palette.yellow.badgeText }}>
                              <summary className="cursor-pointer font-medium">Summary notes</summary>
                              <ul className="mt-2 list-disc space-y-1 pl-4">
                                {summaryBySessionId[session.sessionId].warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border p-3 text-sm" style={{ ...toneStyle('yellow'), color: palette.yellow.badgeText }}>
                          <p className="font-semibold">
                            {summaryLoadingId === session.sessionParticipantId ? 'Loading your summary...' : 'Could not load summary'}
                          </p>
                          <p className="mt-1">
                            {summaryLoadingId === session.sessionParticipantId
                              ? 'Please wait while we prepare your saved answers and feedback.'
                              : 'Please try again later, or ask your teacher to generate student summaries for this session.'}
                          </p>
                        </div>
                      )}

                      <div>
                        <h4 className="text-lg font-semibold text-foreground">
                          Questions and your answers
                        </h4>
                        <p className="mt-1 text-sm text-foreground/55">
                          {session.questionCount} question{session.questionCount === 1 ? '' : 's'} in this session.
                        </p>
                      </div>
                      {session.questions.length === 0 ? (
                        <p className="text-sm text-foreground/55">No question details are available for this session.</p>
                      ) : session.responseCount + session.revisionResponseCount === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-foreground/55" style={{ borderColor: 'rgba(148, 163, 184, 0.35)' }}>
                          No responses recorded for this session yet.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {session.questions.map((question) => {
                            const summaryCard = summaryBySessionId[session.sessionId]?.question_cards.find(
                              (card) => card.question_id === question.questionId
                            )
                            return (
                              <div key={question.questionId} className="student-summary-question rounded-2xl border bg-white p-4 print:border-gray-200" style={{ borderColor: 'rgba(148, 163, 184, 0.2)' }}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">Question {question.position}</p>
                                    <p className="mt-1 text-sm leading-6 text-foreground/70">{question.prompt}</p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <ResponseBadge tone="blue">{session.condition === 'baseline' ? 'Response' : 'Initial'}</ResponseBadge>
                                    {session.condition === 'treatment' && <ResponseBadge tone="purple">Revision</ResponseBadge>}
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                  <AnswerPreview
                                    label={session.condition === 'baseline' ? 'Your response' : 'Initial'}
                                    answer={question.initialAnswer}
                                    tone="blue"
                                  />
                                  {session.condition === 'treatment' && (
                                    <AnswerPreview
                                      label="Revision"
                                      answer={question.revisionAnswer}
                                      emptyText="No revision submitted."
                                      tone="purple"
                                    />
                                  )}
                                </div>
                                {summaryCard?.cluster_feedback ? (
                                  <div className="mt-3 rounded-xl border p-3">
                                    <p className="text-sm font-semibold text-foreground">
                                      {summaryCard.cluster_feedback.student_title || 'Cluster feedback'}
                                    </p>
                                    {summaryCard.cluster_feedback.reasoning_pattern && (
                                      <p className="mt-2 text-sm leading-6 text-foreground/70">
                                        {summaryCard.cluster_feedback.reasoning_pattern}
                                      </p>
                                    )}
                                    <p className="mt-2 text-sm leading-6 text-foreground/70">
                                      {summaryCard.cluster_feedback.what_you_understood}
                                    </p>
                                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                                      <p className="rounded-lg border p-2 text-sm text-foreground/65" style={toneStyle('yellow')}>
                                        <span className="font-medium text-foreground">Try:</span>{' '}
                                        {summaryCard.cluster_feedback.try_again_prompt || summaryCard.cluster_feedback.micro_hint}
                                      </p>
                                      {session.condition === 'treatment' && (
                                        <p className="rounded-lg border p-2 text-sm text-foreground/65" style={toneStyle('blue')}>
                                          <span className="font-medium text-foreground">Movement:</span>{' '}
                                          {movementDisplayLabel(summaryCard.improvement.movement_label)}. {summaryCard.improvement.short_interpretation}
                                        </p>
                                      )}
                                    </div>
                                    {summaryCard.cluster_feedback.confidence_check && (
                                      <p className="mt-2 rounded-lg border p-2 text-sm text-foreground/65" style={toneStyle('blue')}>
                                        <span className="font-medium text-foreground">Confidence check:</span>{' '}
                                        {summaryCard.cluster_feedback.confidence_check}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <p className="mt-3 rounded-xl border border-dashed p-3 text-sm text-foreground/50" style={{ borderColor: 'rgba(148, 163, 184, 0.35)' }}>
                                    Cluster feedback is not available yet.
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
