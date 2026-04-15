import { generateText } from 'ai'

interface FeedbackRequest {
  question: string
  correctAnswer: string
  studentAnswer: string
  confidence: number
}

interface MisconceptionAnalysisRequest {
  question: string
  correctAnswer: string
  responses: Array<{
    answer: string
    confidence: number
  }>
}

export async function generateFeedback(request: FeedbackRequest): Promise<string> {
  const { question, correctAnswer, studentAnswer, confidence } = request

  const prompt = `You are an educational feedback expert. Analyze this student response and provide constructive feedback.

Question: ${question}
Correct Answer: ${correctAnswer}
Student's Answer: ${studentAnswer}
Student's Confidence Level: ${confidence}%

Provide:
1. A brief assessment of the answer's correctness
2. What the student got right, if anything
3. Key misconceptions or gaps in understanding
4. Specific guidance for improvement
5. Encouragement for their confidence level

Keep the feedback concise (2-3 sentences) but helpful.`

  const result = await generateText({
    model: 'openai/gpt-4-turbo',
    prompt,
    temperature: 0.7,
    maxOutputTokens: 300,
  })

  return result.text
}

export async function analyzeMisconceptions(
  request: MisconceptionAnalysisRequest
): Promise<{
  commonMisconceptions: string[]
  confidenceAnalysis: string
  teachingSuggestions: string[]
}> {
  const { question, correctAnswer, responses } = request

  const responsesSummary = responses
    .map((r, i) => `Response ${i + 1}: "${r.answer}" (Confidence: ${r.confidence}%)`)
    .join('\n')

  const prompt = `You are an expert in educational misconception analysis. Analyze these student responses to identify common misconceptions.

Question: ${question}
Correct Answer: ${correctAnswer}

Student Responses:
${responsesSummary}

Provide:
1. A JSON object with:
   - "commonMisconceptions": array of 2-3 common misconceptions you notice
   - "confidenceAnalysis": brief insight about confidence patterns
   - "teachingSuggestions": array of 3-4 teaching strategies to address these misconceptions

Format your response as valid JSON only.`

  const result = await generateText({
    model: 'openai/gpt-4-turbo',
    prompt,
    temperature: 0.7,
    maxOutputTokens: 500,
  })

  try {
    const parsed = JSON.parse(result.text)
    return {
      commonMisconceptions: Array.isArray(parsed.commonMisconceptions)
        ? parsed.commonMisconceptions
        : [],
      confidenceAnalysis:
        typeof parsed.confidenceAnalysis === 'string'
          ? parsed.confidenceAnalysis
          : '',
      teachingSuggestions: Array.isArray(parsed.teachingSuggestions)
        ? parsed.teachingSuggestions
        : [],
    }
  } catch (err) {
    console.error('Error parsing AI response:', err)
    return {
      commonMisconceptions: [],
      confidenceAnalysis: 'Analysis unavailable',
      teachingSuggestions: [],
    }
  }
}

export async function generateConfidenceMatrix(responses: Array<{
  participantCode: string
  answer: string
  confidence: number
}>): Promise<string> {
  const avgConfidence = Math.round(
    responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length
  )

  const highConfidence = responses.filter(r => r.confidence >= 4).length
  const mediumConfidence = responses.filter(r => r.confidence === 3).length
  const lowConfidence = responses.filter(r => r.confidence <= 2).length

  return `Class Confidence Matrix:
- High Confidence (4-5): ${highConfidence} students
- Medium Confidence (3): ${mediumConfidence} students
- Low Confidence (1-2): ${lowConfidence} students
- Average Class Confidence: ${avgConfidence}/5`
}
