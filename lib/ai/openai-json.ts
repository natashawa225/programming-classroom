type ChatMessage = { role: 'system' | 'user'; content: string }

export type OpenAIJsonResult =
  | { ok: true; json: any; rawText: string }
  | { ok: false; error: string; rawText?: string }

function extractBalancedJsonObject(text: string) {
  const source = String(text || '')
  const firstBrace = source.indexOf('{')
  if (firstBrace < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = firstBrace; i < source.length; i += 1) {
    const ch = source[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(firstBrace, i + 1)
      }
    }
  }

  return null
}

function parseModelJson(text: string) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
  ]

  const extracted = extractBalancedJsonObject(raw)
  if (extracted) candidates.push(extracted)

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {}
  }

  return null
}

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || ''
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing')
  }

  return {
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  }
}

export async function openaiChatJson(options: {
  messages: ChatMessage[]
  model?: string
  timeoutMs?: number
  maxTokens?: number
}): Promise<OpenAIJsonResult> {
  let config: ReturnType<typeof getOpenAIConfig>
  try {
    config = getOpenAIConfig()
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'OPENAI_API_KEY is missing',
    }
  }

  const model = options.model || config.model
  const timeoutMs = options.timeoutMs ?? 25000
  const maxTokens = options.maxTokens ?? 900

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        messages: options.messages,
      }),
      signal: controller.signal,
    })

    const raw = await resp.text()
    if (!resp.ok) {
      return { ok: false, error: `OpenAI error: ${resp.status}`, rawText: raw }
    }

    const parsed = JSON.parse(raw)
    const content = parsed?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      return { ok: false, error: 'OpenAI returned no content', rawText: raw }
    }

    try {
      const json = parseModelJson(content)
      if (!json) {
        return { ok: false, error: 'Failed to parse model JSON', rawText: content }
      }
      return { ok: true, json, rawText: content }
    } catch (err) {
      return { ok: false, error: 'Failed to parse model JSON', rawText: content }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { ok: false, error: 'OpenAI request timed out' }
    return { ok: false, error: 'OpenAI request failed' }
  } finally {
    clearTimeout(timer)
  }
}
