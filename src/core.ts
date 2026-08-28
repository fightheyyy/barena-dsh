/** Pure contracts and aggregation for one native DSH paired evaluation. */

export const RUN_SCHEMA = 'barena.dsh_evaluation.v1' as const

export type EvaluationArm = 'baseline' | 'candidate'
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type AttemptStatus = 'pass' | 'fail' | 'blocked'
export type ArmStability = 'stable_pass' | 'stable_failure' | 'flaky' | 'blocked' | 'incomplete'
export type EvaluationVerdict = 'improved' | 'no_effect' | 'regressed' | 'insufficient_evidence'

export interface EvaluationCase {
  readonly name: string
  readonly prompt: string
  readonly expectedText: string
}

export interface CreateRunRequest {
  readonly baselinePreset: string
  readonly candidatePreset: string
  readonly case: EvaluationCase
  readonly attempts: number
  readonly timeoutMs: number
}

export interface PresetSummary {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly isDefault: boolean
  readonly broken?: string
}

export interface AttemptResult {
  readonly arm: EvaluationArm
  readonly attempt: number
  readonly preset: string
  readonly sessionId: string
  readonly workspace: string
  readonly status: AttemptStatus
  readonly detail: string
  readonly finalResponse: string
  readonly turnEndReason?: string
  readonly durationMs: number
  readonly startedAt: string
  readonly completedAt: string
  readonly verifier: {
    readonly passed: boolean
    readonly expectedText: string
  }
}

export interface ArmAggregate {
  readonly planned: number
  readonly completed: number
  readonly pass: number
  readonly fail: number
  readonly blocked: number
  readonly passRate: number | null
  readonly stability: ArmStability
  readonly meanDurationMs: number | null
}

export interface EvaluationAggregate {
  readonly baseline: ArmAggregate
  readonly candidate: ArmAggregate
  readonly observedLift: number | null
  readonly verdict: EvaluationVerdict
  readonly summary: string
}

export interface RunEvent {
  readonly at: string
  readonly kind: 'run' | 'attempt'
  readonly message: string
  readonly arm?: EvaluationArm
  readonly attempt?: number
}

export interface RunSnapshot {
  readonly schema: typeof RUN_SCHEMA
  readonly runId: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly status: RunStatus
  readonly request: CreateRunRequest
  readonly attempts: readonly AttemptResult[]
  readonly events: readonly RunEvent[]
  readonly aggregate?: EvaluationAggregate
  readonly error?: string
}

export interface BarenaSnapshot {
  readonly schema: 'barena.dsh_snapshot.v1'
  readonly generatedAt: string
  readonly activeRunId?: string
  readonly presets: readonly PresetSummary[]
  readonly runs: readonly RunSnapshot[]
}

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** Validate and detach an untrusted JSON request. */
export function validateCreateRunRequest(
  input: unknown,
  limits: { readonly maxAttempts: number; readonly maxTimeoutMs: number },
): CreateRunRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Request body must be a JSON object.')
  }
  const value = input as Record<string, unknown>
  const baselinePreset = boundedString(value.baselinePreset, 'baselinePreset', 80)
  const candidatePreset = boundedString(value.candidatePreset, 'candidatePreset', 80)
  if (!PRESET_ID.test(baselinePreset) || !PRESET_ID.test(candidatePreset)) {
    throw new Error('Preset ids must use lowercase letters, numbers, and dashes.')
  }
  if (baselinePreset === candidatePreset) {
    throw new Error('Baseline and candidate presets must be different.')
  }
  if (typeof value.case !== 'object' || value.case === null || Array.isArray(value.case)) {
    throw new Error('case must be a JSON object.')
  }
  const caseValue = value.case as Record<string, unknown>
  const testCase: EvaluationCase = {
    name: boundedString(caseValue.name, 'case.name', 120),
    prompt: boundedString(caseValue.prompt, 'case.prompt', 12_000),
    expectedText: boundedString(caseValue.expectedText, 'case.expectedText', 2_000),
  }
  const attempts = boundedInteger(value.attempts, 'attempts', 1, limits.maxAttempts)
  const timeoutMs = boundedInteger(value.timeoutMs, 'timeoutMs', 5_000, limits.maxTimeoutMs)
  return { baselinePreset, candidatePreset, case: testCase, attempts, timeoutMs }
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`)
  }
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${field} must be at most ${String(max)} characters.`)
  return normalized
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${field} must be an integer from ${String(min)} to ${String(max)}.`)
  }
  return value as number
}

/** Alternate the first arm each replay so provider drift does not always favor one side. */
export function pairedSchedule(attempts: number): Array<{ arm: EvaluationArm; attempt: number }> {
  const schedule: Array<{ arm: EvaluationArm; attempt: number }> = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const first: EvaluationArm = attempt % 2 === 1 ? 'baseline' : 'candidate'
    const second: EvaluationArm = first === 'baseline' ? 'candidate' : 'baseline'
    schedule.push({ arm: first, attempt }, { arm: second, attempt })
  }
  return schedule
}

/** Extract the last committed assistant text from a DSH Session event sequence. */
export function finalAssistantText(events: readonly unknown[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!isRecord(event) || event.type !== 'assistant/message' || !isRecord(event.data)) continue
    const message = event.data.message
    if (!isRecord(message) || !Array.isArray(message.content)) continue
    const text = message.content.flatMap((block) => (
      isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )).join('')
    if (text.trim().length > 0) return text.trim()
  }
  return ''
}

/** Extract the final durable turn-end reason kind from a DSH Session event sequence. */
export function finalTurnEndReason(events: readonly unknown[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!isRecord(event) || event.type !== 'turn/end' || !isRecord(event.data)) continue
    const reason = event.data.reason
    if (isRecord(reason) && typeof reason.kind === 'string') return reason.kind
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Verify a final response using the MVP deterministic text assertion. */
export function verifyFinalResponse(finalResponse: string, expectedText: string): boolean {
  return finalResponse.toLocaleLowerCase().includes(expectedText.toLocaleLowerCase())
}

/** Aggregate completed native attempts into an evidence-bounded verdict. */
export function aggregateEvaluation(
  attempts: readonly AttemptResult[],
  plannedPerArm: number,
): EvaluationAggregate {
  const baseline = aggregateArm(attempts.filter(item => item.arm === 'baseline'), plannedPerArm)
  const candidate = aggregateArm(attempts.filter(item => item.arm === 'candidate'), plannedPerArm)
  const observedLift = baseline.passRate === null || candidate.passRate === null
    ? null
    : candidate.passRate - baseline.passRate

  if (baseline.stability === 'blocked' || candidate.stability === 'blocked'
    || baseline.stability === 'incomplete' || candidate.stability === 'incomplete') {
    return {
      baseline,
      candidate,
      observedLift,
      verdict: 'insufficient_evidence',
      summary: 'At least one arm was blocked or incomplete, so the plugin effect is not established.',
    }
  }
  if (observedLift !== null && observedLift < 0) {
    return {
      baseline,
      candidate,
      observedLift,
      verdict: 'regressed',
      summary: 'The candidate preset reduced verifier-backed task success.',
    }
  }
  if (observedLift !== null && observedLift > 0) {
    if (candidate.stability !== 'stable_pass') {
      return {
        baseline,
        candidate,
        observedLift,
        verdict: 'insufficient_evidence',
        summary: 'The candidate improved observed pass rate, but the result was not a stable pass.',
      }
    }
    return {
      baseline,
      candidate,
      observedLift,
      verdict: 'improved',
      summary: 'The candidate produced a stable verifier-backed improvement on this case.',
    }
  }
  return {
    baseline,
    candidate,
    observedLift,
    verdict: 'no_effect',
    summary: 'The candidate did not change verifier-backed task success on this case.',
  }
}

function aggregateArm(attempts: readonly AttemptResult[], planned: number): ArmAggregate {
  const pass = attempts.filter(item => item.status === 'pass').length
  const fail = attempts.filter(item => item.status === 'fail').length
  const blocked = attempts.filter(item => item.status === 'blocked').length
  const completed = attempts.length
  const passRate = completed === 0 || blocked > 0 ? null : pass / completed
  const durations = attempts.map(item => item.durationMs)
  const meanDurationMs = durations.length === 0
    ? null
    : Math.round(durations.reduce((total, value) => total + value, 0) / durations.length)
  let stability: ArmStability
  if (blocked > 0) stability = 'blocked'
  else if (completed !== planned) stability = 'incomplete'
  else if (pass > 0 && fail > 0) stability = 'flaky'
  else if (pass === planned) stability = 'stable_pass'
  else stability = 'stable_failure'
  return { planned, completed, pass, fail, blocked, passRate, stability, meanDurationMs }
}
