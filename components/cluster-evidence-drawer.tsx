'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Check, MessageSquare, Pin, Eye, Tag, X } from 'lucide-react'

type EvidenceQuote = {
  response_id: string
  exact_quote: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  sessionId: string
  questionId: string
  clusterId: string
  label: string
  summary: string | null
  count: number
  averageConfidence: number | null
  representativeAnswers: string[]
  evidenceQuotes?: EvidenceQuote[]
  responseIds: string[]
  referenceAlignment?: {
    alignment_level?: string
    explanation?: string
    aligned_reference_ids?: string[]
  }
}

export function ClusterEvidenceDrawer({
  isOpen,
  onClose,
  sessionId,
  questionId,
  clusterId,
  label,
  summary,
  count,
  averageConfidence,
  representativeAnswers,
  evidenceQuotes = [],
  responseIds,
  referenceAlignment,
}: Props) {
  const [interpretation, setInterpretation] = useState('')
  const [decision, setDecision] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [savedStatus, setSavedStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const handleAction = async (actionType: 'selected_for_discussion' | 'pinned' | 'dismissed' | 'annotated') => {
    try {
      setIsSubmitting(true)
      setSavedStatus(null)

      const response = await fetch('/api/teacher/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          questionId,
          clusterId,
          actionType,
          lecturerInterpretation: interpretation || null,
          lecturerDecision: decision || null,
          customLabel: customLabel || null,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save annotation')
      }

      setSavedStatus(`Action '${actionType}' recorded.`)
      setTimeout(() => setSavedStatus(null), 3000)
    } catch (err) {
      console.error('Annotation error', err)
      setSavedStatus('Error saving annotation.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-background border-l shadow-2xl overflow-y-auto p-6 space-y-6 animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <Badge variant="outline" className="mb-1 text-xs">
            Pattern Details & Inspectable Evidence
          </Badge>
          <h2 className="text-xl font-bold tracking-tight text-foreground">{label}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3 text-card-foreground">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Responses</p>
          <p className="text-xl font-semibold mt-1">{count} students</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-card-foreground">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Mean Self-Reported Confidence</p>
          <p className="text-xl font-semibold mt-1">{averageConfidence !== null ? `${averageConfidence} / 5` : 'N/A'}</p>
        </div>
      </div>

      {/* AI Neutral Summary */}
      {summary && (
        <div className="rounded-lg bg-muted/60 p-4 border text-sm text-foreground space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Observable Pattern Description</p>
          <p className="mt-1 leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Reference Answer Alignment */}
      {referenceAlignment && (
        <div className="rounded-lg bg-secondary/30 p-4 border text-sm text-foreground space-y-1">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reference Answer Alignment</p>
            {referenceAlignment.alignment_level && (
              <Badge variant="outline" className="capitalize text-xs">
                {referenceAlignment.alignment_level} Alignment
              </Badge>
            )}
          </div>
          {referenceAlignment.explanation && (
            <p className="text-xs text-foreground/80 leading-relaxed">{referenceAlignment.explanation}</p>
          )}
        </div>
      )}

      {/* Grounded Evidence Quotes */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" /> Inspectable Response Evidence ({representativeAnswers.length})
        </h3>
        <div className="space-y-2">
          {representativeAnswers.map((answer, idx) => (
            <div key={idx} className="rounded-md border bg-card p-3 text-sm text-card-foreground shadow-sm">
              <p className="font-mono text-xs text-muted-foreground mb-1">
                Evidence #{idx + 1} {responseIds[idx] ? `(ID: ${responseIds[idx].slice(0, 8)})` : ''}
              </p>
              <p className="italic">{`"${answer}"`}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Human Interpretation & Decision Layer */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
            <MessageSquare className="h-4 w-4" /> Lecturer Interpretation & Decision
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The AI describes evidence. You decide what it means and what to do about it.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Your Interpretation (What does this pattern mean?)</label>
            <Textarea
              placeholder="e.g. Students are contrasting parameter state with stack depth..."
              value={interpretation}
              onChange={(e) => setInterpretation(e.target.value)}
              className="mt-1 text-sm"
              rows={2}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Your Decision / Action Plan</label>
            <Input
              placeholder="e.g. Discuss in class / Add to next week's review"
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              className="mt-1 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Custom Lecturer Tag / Relabel (Optional)</label>
            <Input
              placeholder="e.g. Conceptual Distinction A"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              className="mt-1 text-sm"
            />
          </div>

          {savedStatus && (
            <p className="text-xs font-medium text-emerald-600 flex items-center gap-1">
              <Check className="h-3 w-3" /> {savedStatus}
            </p>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="default"
              disabled={isSubmitting}
              onClick={() => handleAction('selected_for_discussion')}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Discuss in Class
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleAction('pinned')}
            >
              <Pin className="h-3.5 w-3.5 mr-1.5" /> Pin Pattern
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isSubmitting}
              onClick={() => handleAction('annotated')}
            >
              Save Note
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
