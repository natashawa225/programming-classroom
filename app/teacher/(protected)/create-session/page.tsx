'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { createSession } from '@/lib/supabase/queries'
import { teacherLogout } from '@/app/teacher/auth-actions'

export default function CreateSession() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    title: '',
    condition: 'baseline' as 'baseline' | 'treatment',
    questions: [
      { prompt: '', correctAnswer: '', timerSeconds: '' },
      { prompt: '', correctAnswer: '', timerSeconds: '' },
      { prompt: '', correctAnswer: '', timerSeconds: '' },
    ] as Array<{ prompt: string; correctAnswer: string; timerSeconds: string }>,
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const updateQuestion = (index: number, patch: Partial<{ prompt: string; correctAnswer: string; timerSeconds: string }>) => {
    setFormData(prev => {
      const next = prev.questions.slice()
      next[index] = { ...next[index], ...patch }
      return { ...prev, questions: next }
    })
  }

  const addQuestion = () => {
    setFormData(prev => {
      if (prev.questions.length >= 5) return prev
      return { ...prev, questions: [...prev.questions, { prompt: '', correctAnswer: '', timerSeconds: '' }] }
    })
  }

  const removeQuestion = (index: number) => {
    setFormData(prev => {
      if (prev.questions.length <= 3) return prev
      return { ...prev, questions: prev.questions.filter((_, i) => i !== index) }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const normalized = formData.questions
        .map(q => ({
          prompt: q.prompt.trim(),
          correctAnswer: q.correctAnswer.trim(),
          timerSeconds: q.timerSeconds.trim() ? Number(q.timerSeconds) : null,
        }))
        .filter(q => q.prompt.length > 0)

      if (normalized.length < 3) {
        throw new Error('Please enter at least 3 questions.')
      }
      if (normalized.length > 5) {
        throw new Error('Please enter no more than 5 questions.')
      }

      // Create the session
      const session = await createSession({
        condition: formData.condition,
        title: formData.title.trim() || undefined,
        answerOptions: [],
        questions: normalized.map((q) => ({
          prompt: q.prompt,
          correctAnswer: q.correctAnswer || undefined,
          timerSeconds: q.timerSeconds === null ? undefined : q.timerSeconds,
        })),
      })

      // Redirect to session page
      router.push(`/teacher/session/${session.id}`)
    } catch (err) {
      console.error('Error creating session:', err)
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setLoading(false)
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
            <form action={teacherLogout}>
              <Button variant="outline" type="submit">Log Out</Button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            {/* Basic Information */}
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-foreground mb-6">Basic Information</h2>
              
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
                        <p className="text-xs text-foreground/60">Add 3–5 open-ended questions. Students see one at a time.</p>
                      </div>
                      <Button type="button" variant="outline" onClick={addQuestion} disabled={formData.questions.length >= 5}>
                        Add Question
                      </Button>
                    </div>

                    {formData.questions.map((q, idx) => (
                      <Card key={idx} className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-semibold text-foreground">Q{idx + 1}</p>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => removeQuestion(idx)}
                            disabled={formData.questions.length <= 3}
                          >
                            Remove
                          </Button>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Prompt
                            </label>
                            <textarea
                              value={q.prompt}
                              onChange={(e) => updateQuestion(idx, { prompt: e.target.value })}
                              placeholder="Enter the prompt"
                              rows={3}
                              required={idx < 3}
                              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              Correct Answer (optional, used for % correct)
                            </label>
                            <textarea
                              value={q.correctAnswer}
                              onChange={(e) => updateQuestion(idx, { correctAnswer: e.target.value })}
                              placeholder="Optional: expected answer"
                              rows={2}
                              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
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
	            </Card>

            {/* Condition Selection */}
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-foreground mb-6">Research Condition</h2>
              
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
                    <span className="font-medium text-foreground">Baseline (Control)</span>
                    <p className="text-sm text-foreground/60 mt-1">
                      Students receive direct AI-generated feedback on their response immediately
                    </p>
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
                    <span className="font-medium text-foreground">Treatment (Experimental)</span>
                    <p className="text-sm text-foreground/60 mt-1">
                      You receive misconception cards and teaching suggestions. Students see a confidence matrix instead
                    </p>
                  </label>
                </div>
              </div>
            </Card>

            {error && (
              <Card className="p-4 border-destructive/30 bg-destructive/5">
                <p className="text-destructive text-sm">{error}</p>
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
