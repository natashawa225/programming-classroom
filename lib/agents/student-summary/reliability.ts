import type { OpenAIJsonResult } from '@/lib/ai/openai-json'

type RetryContext = {
  operation: string
  sessionId?: string
  questionId?: string
  clusterId?: string
  participantId?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatAgentError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
      error?: unknown
    }
    const parts = [
      candidate.message,
      candidate.details,
      candidate.hint,
      candidate.code,
      candidate.error,
    ]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)

    if (parts.length > 0) return parts.join(' | ')

    try {
      return JSON.stringify(error)
    } catch {}
  }
  return String(error || 'Unknown error')
}

function isTransientAiError(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('und_err_socket') ||
    lower.includes('socket') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('openai error: 500') ||
    lower.includes('openai error: 502') ||
    lower.includes('openai error: 503') ||
    lower.includes('openai error: 504')
  )
}

export async function retryOpenAIJson(
  operation: () => Promise<OpenAIJsonResult>,
  context: RetryContext,
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<OpenAIJsonResult> {
  const attempts = options.attempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 500
  let lastError = 'Unknown AI error'

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation()
      if (result.ok) return result

      lastError = result.error || 'AI request failed'
      if (!isTransientAiError(lastError) || attempt === attempts) return result
    } catch (error) {
      lastError = formatAgentError(error)
      if (!isTransientAiError(lastError) || attempt === attempts) {
        return { ok: false, error: lastError }
      }
    }

    const jitter = Math.floor(Math.random() * 150)
    const delay = baseDelayMs * 2 ** (attempt - 1) + jitter
    console.warn('[student-summary] retrying transient AI failure', {
      ...context,
      attempt,
      nextAttempt: attempt + 1,
      error: lastError,
      delayMs: delay,
    })
    await sleep(delay)
  }

  return { ok: false, error: lastError }
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        try {
          results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    })
  )

  return results
}
