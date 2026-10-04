'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { TeacherLogoutButton } from '@/components/teacher-logout-button'
import { MAX_SESSION_QUESTIONS } from '@/lib/session-question-limits'

export default function CreateSession() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitLockedRef = useRef(false)
  const createdSessionIdRef = useRef<string | null>(null)

  const [formData, setFormData] = useState({
    title: '',
    condition: 'baseline' as 'baseline' | 'treatment',
    questions: [
      { prompt: '', referenceAnswers: [''], timerSeconds: '' },
    ] as Array<{ prompt: string; referenceAnswers: string[]; timerSeconds: string }>,
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const updateQuestion = (index: number, patch: Partial<{ prompt: string; timerSeconds: string }>) => {
    setFormData(prev => {
      const next = prev.questions.slice()
      next[index] = { ...next[index], ...patch }
      return { ...prev, questions: next }
    })
  }

  const updateReferenceAnswer = (questionIndex: number, refIndex: number, text: string) => {
    setFormData(prev => {
      const nextQuestions = prev.questions.slice()
      const targetQ = { ...nextQuestions[questionIndex] }
      const nextRefs = targetQ.referenceAnswers.slice()
      nextRefs[refIndex] = text
      targetQ.referenceAnswers = nextRefs
      nextQuestions[questionIndex] = targetQ
      return { ...prev, questions: nextQuestions }
    })
  }

  const addReferenceAnswer = (questionIndex: number) => {
    setFormData(prev => {
      const nextQuestions = prev.questions.slice()
      const targetQ = { ...nextQuestions[questionIndex] }
      targetQ.referenceAnswers = [...targetQ.referenceAnswers, '']
      nextQuestions[questionIndex] = targetQ
      return { ...prev, questions: nextQuestions }
    })
  }

  const removeReferenceAnswer = (questionIndex: number, refIndex: number) => {
    setFormData(prev => {
      const nextQuestions = prev.questions.slice()
      const targetQ = { ...nextQuestions[questionIndex] }
      if (targetQ.referenceAnswers.length <= 1) return prev
      targetQ.referenceAnswers = targetQ.referenceAnswers.filter((_, i) => i !== refIndex)
      nextQuestions[questionIndex] = targetQ
      return { ...prev, questions: nextQuestions }
    })
  }

  const addQuestion = () => {
    setFormData(prev => {
      if (prev.questions.length >= MAX_SESSION_QUESTIONS) return prev
      return { ...prev, questions: [...prev.questions, { prompt: '', referenceAnswers: [''], timerSeconds: '' }] }
    })
  }

  const removeQuestion = (index: number) => {
    setFormData(prev => {
      if (prev.questions.length <= 1) return prev
      return { ...prev, questions: prev.questions.filter((_, i) => i !== index) }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitLockedRef.current || createdSessionIdRef.current) {
      return
    }

    submitLockedRef.current = true
    setLoading(true)
    setError(null)

    try {
      const normalized = formData.questions
        .map(q => {
          const refs = q.referenceAnswers.map(r => r.trim()).filter(Boolean)
          return {
            prompt: q.prompt.trim(),
            referenceAnswers: refs,
            timerSeconds: q.timerSeconds.trim() ? Number(q.timerSeconds) : null,
          }
        })
        .filter(q => q.prompt.length > 0)

      if (normalized.length < 1) {
        throw new Error('Please enter at least 1 question.')
      }
      if (normalized.length > MAX_SESSION_QUESTIONS) {
        throw new Error(`Please enter no more than ${MAX_SESSION_QUESTIONS} questions.`)
      }
      if (normalized.some(q => q.referenceAnswers.length < 1)) {
        throw new Error('Each question must have at least 1 reference answer / reasoning example.')
      }

      // Create the session
      const response = await fetch('/api/teacher/create-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          condition: formData.condition,
          title: formData.title.trim() || undefined,
          answerOptions: [],
          questions: normalized.map((q) => ({
            prompt: q.prompt,
            correctAnswer: q.referenceAnswers[0] || '',
            referenceAnswers: q.referenceAnswers,
            timerSeconds: q.timerSeconds === null ? undefined : q.timerSeconds,
          })),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to create session')
      }

      const session = payload?.session

      createdSessionIdRef.current = session.id
      router.replace(`/teacher/session/${session.id}`)
    } catch (err) {
      console.error('Error creating session:', err)
      setError(err instanceof Error ? err.message : 'Failed to create session')
      submitLockedRef.current = false
    } finally {
      if (!createdSessionIdRef.current) {
        setLoading(false)
      }
    }
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Create New Session</h1>
          <div className="flex items-center gap-3">
            <Link href="/teacher/dashboard">
              <Button variant="outline">Back</Button>
            </Link>
            <TeacherLogoutButton />
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            {/* Basic Information */}
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-foreground mb-6">Question Setup</h2>
              
	              <div className="space-y-4">
	                <div className="p-3 rounded-md bg-secondary/30 text-sm text-foreground/70">
	                  A unique <span className="font-semibold text-foreground">session code</span> will be generated automatically when you create this session.
	                </div>

	                <div>
	                  <label htmlFor="title" className="block text-sm font-medium text-foreground mb-2">
	                    Session Title (optional)
	                  </label>
	                  <input
	                    id="title"
	                    name="title"
	                    value={formData.title}
	                    onChange={handleInputChange}
	                    placeholder="e.g., Arrays & Complexity"
	                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
	                  />
	                </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">Questions</p>
                      </div>
                      <Button type="button" variant="outline" onClick={addQuestion} disabled={formData.questions.length >= MAX_SESSION_QUESTIONS}>
                        Add Question
                      </Button>
                    </div>

                    <p className="text-sm text-foreground/60">
                      {formData.questions.length} of {MAX_SESSION_QUESTIONS} questions added.
                    </p>

                    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-2">
                      {formData.questions.map((q, idx) => (
                        <Card key={idx} className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-semibold text-foreground">Q{idx + 1}</p>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => removeQuestion(idx)}
                            disabled={formData.questions.length <= 1}
                          >
                            Remove
                          </Button>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                            Question
                            </label>
                            <textarea
                              value={q.prompt}
                              onChange={(e) => updateQuestion(idx, { prompt: e.target.value })}
                              placeholder="Enter the question prompt"
                              rows={3}
                              required={idx === 0}
                              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="block text-sm font-medium text-foreground">
                                Reference Answer (minimum 1 required)
                              </label>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => addReferenceAnswer(idx)}
                              >
                                + Add reference answer
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">
                              Provide valid answer formulations or reasoning paths to serve as topic context for AI pattern clustering.
                            </p>
                            <div className="space-y-2">
                              {q.referenceAnswers.map((refText, refIdx) => (
                                <div key={refIdx} className="flex items-start gap-2">
                                  <textarea
                                    value={refText}
                                    onChange={(e) => updateReferenceAnswer(idx, refIdx, e.target.value)}
                                    placeholder={`Reference reasoning example ${refIdx + 1}`}
                                    rows={2}
                                    required={refIdx === 0 && idx === 0}
                                    className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                                  />
                                  {q.referenceAnswers.length > 1 && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeReferenceAnswer(idx, refIdx)}
                                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    >
                                      Delete
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Timer (seconds, optional)
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={q.timerSeconds}
                              onChange={(e) => updateQuestion(idx, { timerSeconds: e.target.value })}
                              placeholder="e.g., 90"
                              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                        </div>
                        </Card>
                      ))}
                    </div>
                  </div>
	              </div>
	            </Card>

            {/* Condition Selection */}
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-foreground mb-1">Condition</h2>
              
              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="baseline"
                    name="condition"
                    value="baseline"
                    checked={formData.condition === 'baseline'}
                    onChange={handleInputChange}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="baseline" className="ml-3 cursor-pointer">
                    <span className="font-medium text-foreground">Baseline</span>
                  </label>
                </div>

                <div className="flex items-start">
                  <input
                    type="radio"
                    id="treatment"
                    name="condition"
                    value="treatment"
                    checked={formData.condition === 'treatment'}
                    onChange={handleInputChange}
                    className="w-4 h-4 cursor-pointer mt-1"
                  />
                  <label htmlFor="treatment" className="ml-3 cursor-pointer flex-1">
                    <span className="font-medium text-foreground">Treatment</span>
                  </label>
                </div>
              </div>
            </Card>

            {error && (
              <Card className="p-4 border-destructive/30 bg-destructive/5">
                <p className="text-destructive text-sm">{error}</p>
              </Card>
            )}

            {loading && !error && (
              <Card className="p-4 border-primary/20 bg-primary/5">
                <p className="text-sm text-foreground/80">
                  Creating session… This can take a few seconds. Please do not click again.
                </p>
              </Card>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={loading}
                className="flex-1"
              >
                {loading ? 'Creating...' : 'Create Session'}
              </Button>
              <Link href="/teacher/dashboard" className="flex-1">
                <Button variant="outline" className="w-full">
                  Cancel
                </Button>
              </Link>
            </div>
          </div>
        </form>
      </div>
    </main>
  )
}
