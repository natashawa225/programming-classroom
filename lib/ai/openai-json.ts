import { ProxyAgent, request } from 'undici'

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
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing')
  }

  return {
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  }
}

function formatFetchError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'OpenAI request failed'
  }

  const err = error as {
    name?: string
    message?: string
    cause?: { name?: string; message?: string; code?: string }
  }

  const message = typeof err.message === 'string' ? err.message.trim() : ''
  const causeName = typeof err.cause?.name === 'string' ? err.cause.name.trim() : ''
  const causeMessage = typeof err.cause?.message === 'string' ? err.cause.message.trim() : ''
  const causeCode = typeof err.cause?.code === 'string' ? err.cause.code.trim() : ''

  const parts = [
    message,
    causeName,
    causeCode,
    causeMessage,
  ].filter(Boolean)

  return parts.length > 0 ? `OpenAI request failed: ${parts.join(' | ')}` : 'OpenAI request failed'
}

let cachedProxyUrl: string | null = null
let cachedProxyAgent: ProxyAgent | undefined

function getProxyDispatcher() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null
  if (!proxyUrl) {
    cachedProxyUrl = null
    cachedProxyAgent = undefined
    return undefined
  }

  if (!cachedProxyAgent || cachedProxyUrl !== proxyUrl) {
    cachedProxyUrl = proxyUrl
    cachedProxyAgent = new ProxyAgent(proxyUrl)
  }

  return cachedProxyAgent
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
  const timeoutMs = options.timeoutMs ?? 45000
  const maxTokens = options.maxTokens ?? 900

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'none'
    console.log('[openai-json] proxy =', proxyUrl)
    const dispatcher = getProxyDispatcher()
    const { statusCode, body } = await request('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      dispatcher,
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

    const raw = await body.text()
    if (statusCode < 200 || statusCode >= 300) {
      return { ok: false, error: `OpenAI error: ${statusCode}`, rawText: raw }
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
    return { ok: false, error: formatFetchError(err) }
  } finally {
    clearTimeout(timer)
  }
}
