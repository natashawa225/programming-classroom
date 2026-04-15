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
    question: '',
    correctAnswer: '',
    answerOptions: '',
    condition: 'baseline' as 'baseline' | 'treatment',
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Create the session
      const session = await createSession({
        answerOptions: formData.answerOptions
          .split('\n')
          .map(option => option.trim())
          .filter(Boolean),
        question: formData.question,
        correctAnswer: formData.correctAnswer,
        condition: formData.condition,
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
                  <label htmlFor="question" className="block text-sm font-medium text-foreground mb-2">
                    Question
                  </label>
                  <textarea
                    id="question"
                    name="question"
                    value={formData.question}
                    onChange={handleInputChange}
                    placeholder="Enter your question here"
                    rows={4}
                    required
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label htmlFor="correctAnswer" className="block text-sm font-medium text-foreground mb-2">
                    Correct Answer
                  </label>
                  <textarea
                    id="correctAnswer"
                    name="correctAnswer"
                    value={formData.correctAnswer}
                    onChange={handleInputChange}
                    placeholder="The correct answer to your question"
                    rows={3}
                    required
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label htmlFor="answerOptions" className="block text-sm font-medium text-foreground mb-2">
                    Answer Options
                  </label>
                  <textarea
                    id="answerOptions"
                    name="answerOptions"
                    value={formData.answerOptions}
                    onChange={handleInputChange}
                    placeholder="Optional. Enter one option per line for multiple-choice sessions."
                    rows={4}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
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
