import { requiresTranslation } from '../lib/agents/orchestration/translation-agent'

async function runPhase3Tests() {
  console.log('--- Phase 3 Verification Tests ---')

  // 1. Verify technical mixed string detection
  const mixedTech = '因为 stack 是 LIFO，所以 pop 会 remove last element'
  const needsTrans = requiresTranslation(mixedTech)
  console.log(`1. Mixed Technical Response Detection: "${mixedTech}" -> requiresTranslation: ${needsTrans}`)
  if (!needsTrans) {
    throw new Error('Test 1 failed: Expected true for mixed technical response')
  }

  // 2. Verify pure English factually incorrect string detection (no correction trigger)
  const wrongFact = 'stack is FIFO because first one comes out'
  const needsTransWrong = requiresTranslation(wrongFact)
  console.log(`2. Factually Incorrect English Response Detection: "${wrongFact}" -> requiresTranslation: ${needsTransWrong}`)
  if (needsTransWrong) {
    throw new Error('Test 2 failed: Expected false for English response (no translation call)')
  }

  console.log('--- All Phase 3 Preparation Tests Passed Cleanly! ---')
}

runPhase3Tests().catch((err) => {
  console.error('Phase 3 test error:', err)
  process.exit(1)
})
