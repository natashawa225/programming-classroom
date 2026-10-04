import { requiresTranslation } from '../lib/agents/orchestration/translation-agent'

async function runTests() {
  console.log('--- Testing Translation Detection Heuristics ---')

  // Case 1: Pure English
  const case1Text = 'The loop executes ten times.'
  const case1NeedsTranslation = requiresTranslation(case1Text)
  console.log(`Case 1: "${case1Text}" -> requiresTranslation: ${case1NeedsTranslation}`)
  if (case1NeedsTranslation !== false) {
    throw new Error(`Case 1 failed: Expected false, got ${case1NeedsTranslation}`)
  }

  // Case 2: Non-English (Chinese)
  const case2Text = '栈是后进先出'
  const case2NeedsTranslation = requiresTranslation(case2Text)
  console.log(`Case 2: "${case2Text}" -> requiresTranslation: ${case2NeedsTranslation}`)
  if (case2NeedsTranslation !== true) {
    throw new Error(`Case 2 failed: Expected true, got ${case2NeedsTranslation}`)
  }

  // Case 3: Mixed Language
  const case3Text = 'I think 栈 uses FIFO'
  const case3NeedsTranslation = requiresTranslation(case3Text)
  console.log(`Case 3: "${case3Text}" -> requiresTranslation: ${case3NeedsTranslation}`)
  if (case3NeedsTranslation !== true) {
    throw new Error(`Case 3 failed: Expected true, got ${case3NeedsTranslation}`)
  }

  console.log('--- All Translation Detection Tests Passed Cleanly! ---')
}

runTests().catch((err) => {
  console.error('Test error:', err)
  process.exit(1)
})
