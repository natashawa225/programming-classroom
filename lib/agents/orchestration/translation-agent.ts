import { openaiChatJson } from '@/lib/ai/openai-json'
import type { ResponseRecord, TranslatedResponse } from '@/lib/agents/orchestration/types'

/**
 * Heuristic to detect if text is predominantly English / standard Latin.
 * Checks for non-Latin script ranges (CJK, Cyrillic, Arabic, Devanagari, Hebrew, etc.)
 * and non-ASCII character density.
 */
export function requiresTranslation(text: string): boolean {
  const trimmed = String(text || '').trim()
  if (!trimmed) return false

  // CJK Unified Ideographs, Hiragana, Katakana, Hangul, Cyrillic, Arabic, Hebrew, Thai, etc.
  const nonLatinScriptRegex = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0590-\u05FF\u0E00-\u0E7F]/u
  if (nonLatinScriptRegex.test(trimmed)) {
    return true
  }

  // Count non-ASCII characters
  let nonAsciiCount = 0
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      nonAsciiCount += 1
    }
  }

  // If non-ASCII character ratio exceeds 15%, treat as needing translation
  return nonAsciiCount / trimmed.length > 0.15
}

export async function runTranslationAgent(input: {
  responses: ResponseRecord[]
  existingTranslations?: Map<string, TranslatedResponse>
}): Promise<{
  translations: Map<string, TranslatedResponse>
  durationMs: number
  llmCallsMade: number
}> {
  const startTime = Date.now()
  const results = new Map<string, TranslatedResponse>()
  const existingMap = input.existingTranslations || new Map<string, TranslatedResponse>()

  const toTranslate: ResponseRecord[] = []

  for (const response of input.responses) {
    const id = response.responseId
    const originalText = String(response.answer || '').trim()

    // 1. Reuse existing valid translation if cached
    if (existingMap.has(id)) {
      results.set(id, existingMap.get(id)!)
      continue
    }

    // 2. Check if translation is needed via fast heuristic
    if (!requiresTranslation(originalText)) {
      results.set(id, {
        responseId: id,
        originalText,
        translatedText: originalText,
        translationStatus: 'not_needed',
        translationConfidence: 'high',
        detectedLanguage: 'en',
      })
      continue
    }

    // Response needs translation
    toTranslate.push(response)
  }

  // If no responses require LLM translation, return immediately
  if (toTranslate.length === 0) {
    return {
      translations: results,
      durationMs: Date.now() - startTime,
      llmCallsMade: 0,
    }
  }

  // 3. Batched OpenAI Translation Call for responses requiring translation
  const payload = toTranslate.map((r, idx) => ({
    index: idx + 1,
    response_id: r.responseId,
    original_text: r.answer,
  }))

  const promptMessage = [
    'You are a translation agent, not an answer improvement agent.',
    '',
    'STRICT MANDATORY RULES:',
    '1. Preserve the student\'s original meaning and exact claims, even if factual statements are incorrect or erroneous.',
    '2. DO NOT correct factual mistakes, add missing explanations, infer unexpressed reasoning, improve grammar beyond necessary translation, or rewrite into a textbook explanation.',
    '3. Preserve technical terms, acronyms, and code keywords (e.g. stack, LIFO, FIFO, pop, push, array, loop) without expanding or replacing them with textbook prose.',
    '4. Example of strict translation:',
    '   Original: "stack is FIFO because first one comes out"',
    '   WRONG translation (DO NOT DO): "A stack is LIFO, where the newest element is removed first."',
    '   CORRECT translation: "A stack is FIFO because the first one comes out."',
    '',
    'Return a JSON object with a "translations" array matching this exact shape:',
    JSON.stringify(
      {
        translations: [
          {
            response_id: 'string',
            translated_text: 'canonical English translation without correction',
            translation_confidence: 'high | medium | low',
            detected_language: 'detected language code or name',
          },
        ],
      },
      null,
      2
    ),
  ].join('\n')

  try {
    const aiResult = await openaiChatJson({
      maxTokens: 1200,
      timeoutMs: 30000,
      messages: [
        {
          role: 'system',
          content: 'You translate non-English student responses into canonical English without correcting errors, rewriting, or interpreting reasoning.',
        },
        {
          role: 'user',
          content: `${promptMessage}\n\nStudent Responses to Translate:\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    })

    if (aiResult.ok && Array.isArray(aiResult.json?.translations)) {
      const translationMap = new Map<
        string,
        { translated_text: string; translation_confidence?: 'high' | 'medium' | 'low'; detected_language?: string }
      >()
      for (const item of aiResult.json.translations) {
        if (item?.response_id && typeof item?.translated_text === 'string') {
          const rawConf = String(item.translation_confidence || '').toLowerCase()
          const confidence: 'high' | 'medium' | 'low' =
            rawConf === 'high' || rawConf === 'medium' || rawConf === 'low' ? rawConf : 'medium'
          translationMap.set(String(item.response_id), {
            translated_text: item.translated_text.trim(),
            translation_confidence: confidence,
            detected_language: typeof item.detected_language === 'string' ? item.detected_language : undefined,
          })
        }
      }

      for (const r of toTranslate) {
        const translatedItem = translationMap.get(r.responseId)
        if (translatedItem && translatedItem.translated_text) {
          results.set(r.responseId, {
            responseId: r.responseId,
            originalText: r.answer,
            translatedText: translatedItem.translated_text,
            translationStatus: 'translated',
            translationConfidence: translatedItem.translation_confidence || 'medium',
            detectedLanguage: translatedItem.detected_language || 'unknown',
          })
        } else {
          // Fallback if item was missing in model output
          results.set(r.responseId, {
            responseId: r.responseId,
            originalText: r.answer,
            translatedText: r.answer,
            translationStatus: 'failed',
            translationConfidence: 'low',
          })
        }
      }
    } else {
      console.warn('[translation-agent] OpenAI translation returned unparseable output; falling back to original text', aiResult)
      for (const r of toTranslate) {
        results.set(r.responseId, {
          responseId: r.responseId,
          originalText: r.answer,
          translatedText: r.answer,
          translationStatus: 'failed',
          translationConfidence: 'low',
        })
      }
    }
  } catch (err) {
    console.error('[translation-agent] Translation call error', err)
    for (const r of toTranslate) {
      results.set(r.responseId, {
        responseId: r.responseId,
        originalText: r.answer,
        translatedText: r.answer,
        translationStatus: 'failed',
        translationConfidence: 'low',
      })
    }
  }

  return {
    translations: results,
    durationMs: Date.now() - startTime,
    llmCallsMade: 1,
  }
}
