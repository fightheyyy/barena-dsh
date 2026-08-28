import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aggregateEvaluation,
  finalAssistantText,
  finalTurnEndReason,
  pairedSchedule,
  validateCreateRunRequest,
  verifyFinalResponse,
  type AttemptResult,
  type AttemptStatus,
  type EvaluationArm,
} from '../src/core.ts'

describe('request contract', () => {
  it('normalizes a bounded run request', () => {
    assert.deepEqual(validateCreateRunRequest({
      baselinePreset: ' standard ',
      candidatePreset: 'plugin-plus',
      case: { name: ' probe ', prompt: ' do it ', expectedText: ' READY ' },
      attempts: 3,
      timeoutMs: 120_000,
    }, { maxAttempts: 5, maxTimeoutMs: 600_000 }), {
      baselinePreset: 'standard',
      candidatePreset: 'plugin-plus',
      case: { name: 'probe', prompt: 'do it', expectedText: 'READY' },
      attempts: 3,
      timeoutMs: 120_000,
    })
  })

  it('rejects an experiment without a distinct, valid pair', () => {
    const base = {
      baselinePreset: 'standard',
      candidatePreset: 'standard',
      case: { name: 'probe', prompt: 'do it', expectedText: 'READY' },
      attempts: 1,
      timeoutMs: 30_000,
    }
    assert.throws(
      () => validateCreateRunRequest(base, { maxAttempts: 5, maxTimeoutMs: 600_000 }),
      /must be different/,
    )
    assert.throws(
      () => validateCreateRunRequest({ ...base, candidatePreset: 'Not Valid' }, {
        maxAttempts: 5,
        maxTimeoutMs: 600_000,
      }),
      /lowercase letters/,
    )
  })

  it('enforces replay and timeout bounds', () => {
    const base = {
      baselinePreset: 'standard',
      candidatePreset: 'candidate',
      case: { name: 'probe', prompt: 'do it', expectedText: 'READY' },
      attempts: 6,
      timeoutMs: 30_000,
    }
    assert.throws(
      () => validateCreateRunRequest(base, { maxAttempts: 5, maxTimeoutMs: 600_000 }),
      /attempts must be an integer from 1 to 5/,
    )
    assert.throws(
      () => validateCreateRunRequest({ ...base, attempts: 1, timeoutMs: 4_999 }, {
        maxAttempts: 5,
        maxTimeoutMs: 600_000,
      }),
      /timeoutMs must be an integer from 5000/,
    )
  })
})

describe('paired scheduling', () => {
  it('alternates which arm runs first on every replay', () => {
    assert.deepEqual(pairedSchedule(3), [
      { arm: 'baseline', attempt: 1 },
      { arm: 'candidate', attempt: 1 },
      { arm: 'candidate', attempt: 2 },
      { arm: 'baseline', attempt: 2 },
      { arm: 'baseline', attempt: 3 },
      { arm: 'candidate', attempt: 3 },
    ])
  })
})

describe('native Session evidence', () => {
  it('extracts the latest durable assistant response and turn reason', () => {
    const events = [
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'old' }] } } },
      { type: 'turn/end', data: { reason: { kind: 'interrupted' } } },
      {
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: 'The result is ' }, { type: 'text', text: 'READY' }] } },
      },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ]
    assert.equal(finalAssistantText(events), 'The result is READY')
    assert.equal(finalTurnEndReason(events), 'completed')
    assert.equal(verifyFinalResponse(finalAssistantText(events), 'ready'), true)
  })

  it('returns empty evidence for unrelated or malformed events', () => {
    assert.equal(finalAssistantText([{ type: 'assistant/message', data: null }]), '')
    assert.equal(finalTurnEndReason([{ type: 'turn/end', data: { reason: null } }]), undefined)
  })
})

describe('evaluation aggregation', () => {
  it('reports a stable candidate improvement', () => {
    const result = aggregateEvaluation([
      attempt('baseline', 1, 'fail'), attempt('candidate', 1, 'pass'),
      attempt('candidate', 2, 'pass'), attempt('baseline', 2, 'fail'),
      attempt('baseline', 3, 'fail'), attempt('candidate', 3, 'pass'),
    ], 3)
    assert.equal(result.verdict, 'improved')
    assert.equal(result.observedLift, 1)
    assert.equal(result.candidate.stability, 'stable_pass')
  })

  it('reports no effect when verifier-backed success is unchanged', () => {
    const result = aggregateEvaluation([
      attempt('baseline', 1, 'pass'), attempt('candidate', 1, 'pass'),
      attempt('baseline', 2, 'pass'), attempt('candidate', 2, 'pass'),
    ], 2)
    assert.equal(result.verdict, 'no_effect')
    assert.equal(result.observedLift, 0)
  })

  it('reports a regression when the candidate loses success', () => {
    const result = aggregateEvaluation([
      attempt('baseline', 1, 'pass'), attempt('candidate', 1, 'fail'),
      attempt('baseline', 2, 'pass'), attempt('candidate', 2, 'fail'),
    ], 2)
    assert.equal(result.verdict, 'regressed')
    assert.equal(result.observedLift, -1)
  })

  it('withholds attribution for blocked, incomplete, or flaky improvements', () => {
    assert.equal(aggregateEvaluation([
      attempt('baseline', 1, 'fail'), attempt('candidate', 1, 'blocked'),
    ], 1).verdict, 'insufficient_evidence')

    assert.equal(aggregateEvaluation([
      attempt('baseline', 1, 'fail'), attempt('candidate', 1, 'pass'),
    ], 2).verdict, 'insufficient_evidence')

    assert.equal(aggregateEvaluation([
      attempt('baseline', 1, 'fail'), attempt('candidate', 1, 'pass'),
      attempt('baseline', 2, 'fail'), attempt('candidate', 2, 'fail'),
      attempt('baseline', 3, 'fail'), attempt('candidate', 3, 'pass'),
    ], 3).verdict, 'insufficient_evidence')
  })
})

function attempt(arm: EvaluationArm, number: number, status: AttemptStatus): AttemptResult {
  return {
    arm,
    attempt: number,
    preset: arm,
    sessionId: `${arm}-${String(number)}`,
    workspace: `/tmp/${arm}-${String(number)}`,
    status,
    detail: status,
    finalResponse: status === 'pass' ? 'READY' : '',
    turnEndReason: status === 'blocked' ? 'error' : 'completed',
    durationMs: number * 100,
    startedAt: '2026-08-28T00:00:00.000Z',
    completedAt: '2026-08-28T00:00:01.000Z',
    verifier: { passed: status === 'pass', expectedText: 'READY' },
  }
}
