/** DSH Host plugin: native paired evaluation over ctx.agents and Agent Presets. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  RUN_SCHEMA,
  aggregateEvaluation,
  finalAssistantText,
  finalTurnEndReason,
  pairedSchedule,
  validateCreateRunRequest,
  verifyFinalResponse,
  type AttemptResult,
  type BarenaSnapshot,
  type CreateRunRequest,
  type EvaluationArm,
  type PresetSummary,
  type RunEvent,
  type RunSnapshot,
} from './core.ts'

export const name = 'barena-dsh-eval'
export const inject = ['webServer', 'agents', 'agentPresets', 'agentDefaultModel']

export interface Config {
  readonly runsRoot?: string
  readonly maxAttempts?: number
  readonly maxTimeoutMs?: number
}

interface DshSession {
  readonly events: readonly unknown[]
}

interface DshAgent {
  readonly session: DshSession
  followup(message: unknown): void
  whenIdle(): Promise<void>
  cancel(cause: { readonly kind: 'user' }): void
}

interface AgentHandle {
  readonly agent: DshAgent
  dispose(): Promise<void>
}

interface AgentPresets {
  list(): Promise<Array<{
    readonly id: string
    readonly name?: string
    readonly description?: string
    readonly broken?: string
  }>>
  readonly defaultId: string
  mount(agentCtx: unknown, id: string): Promise<unknown>
}

interface HarnessContext {
  readonly agents: {
    create(options: {
      readonly sessionId: string
      readonly meta: { readonly cwd: string; readonly agentPreset: string }
      readonly agentOptions: Record<string, unknown>
      readonly setup: (agentCtx: unknown) => Promise<void>
    }): Promise<AgentHandle>
  }
  readonly agentPresets: AgentPresets
  readonly agentDefaultModel: {
    currentSelection(): Record<string, unknown>
  }
  readonly webServer: {
    register(route: {
      readonly kind: 'prefix'
      readonly path: string
      readonly handler: (request: HttpRequest, response: HttpResponse) => void | Promise<void>
    }): () => void
  }
  readonly logger: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
  effect(register: () => (() => void) | Promise<() => void>, label?: string): void
  provide(name: string, value: unknown): unknown
}

interface HttpRequest {
  readonly method?: string
  readonly url?: string
  readonly headers: Record<string, string | string[] | undefined>
  on(event: 'data', listener: (chunk: Uint8Array) => void): void
  on(event: 'end' | 'error', listener: (error?: Error) => void): void
  destroy(): void
}

interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): HttpResponse
  end(body?: string): void
}

interface MutableRun {
  schema: typeof RUN_SCHEMA
  runId: string
  createdAt: string
  updatedAt: string
  status: RunSnapshot['status']
  request: CreateRunRequest
  attempts: AttemptResult[]
  events: RunEvent[]
  aggregate?: RunSnapshot['aggregate']
  error?: string
}

const API_PREFIX = '/barena/api'
const MAX_BODY_BYTES = 128 * 1024
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_MAX_TIMEOUT_MS = 10 * 60_000

/** Install the Host runtime and same-origin route. */
export async function apply(ctx: HarnessContext, config: Config = {}): Promise<void> {
  const runsRoot = resolve(config.runsRoot ?? join(
    process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    'barena',
    'runs',
  ))
  const runtime = new BarenaEvaluationRuntime(ctx, {
    runsRoot,
    maxAttempts: positiveInteger(config.maxAttempts, DEFAULT_MAX_ATTEMPTS),
    maxTimeoutMs: positiveInteger(config.maxTimeoutMs, DEFAULT_MAX_TIMEOUT_MS),
  })
  await runtime.initialize()
  ctx.provide('barenaEval', runtime)
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (request, response) => routeRequest(runtime, request, response),
    }),
    'barena-dsh: HTTP API',
  )
  ctx.logger.info(`barena-dsh: native evaluation API ready at ${API_PREFIX}`)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback
}

class BarenaEvaluationRuntime {
  private readonly runs = new Map<string, MutableRun>()
  private activeRunId: string | undefined

  constructor(
    private readonly ctx: HarnessContext,
    private readonly options: {
      readonly runsRoot: string
      readonly maxAttempts: number
      readonly maxTimeoutMs: number
    },
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.options.runsRoot, { recursive: true })
    await this.loadHistory()
  }

  async snapshot(): Promise<BarenaSnapshot> {
    const presets = await this.presets()
    return {
      schema: 'barena.dsh_snapshot.v1',
      generatedAt: new Date().toISOString(),
      ...(this.activeRunId === undefined ? {} : { activeRunId: this.activeRunId }),
      presets,
      runs: [...this.runs.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 20)
        .map(run => snapshotOf(run)),
    }
  }

  get(runId: string): RunSnapshot | undefined {
    const run = this.runs.get(runId)
    return run === undefined ? undefined : snapshotOf(run)
  }

  async create(input: unknown): Promise<RunSnapshot> {
    if (this.activeRunId !== undefined) {
      throw new ConflictError(`Evaluation ${this.activeRunId} is still running.`)
    }
    const request = validateCreateRunRequest(input, this.options)
    await this.assertPresets(request)
    const now = new Date().toISOString()
    const runId = `dsh-eval-${compactTimestamp(now)}-${randomUUID().slice(0, 8)}`
    const run: MutableRun = {
      schema: RUN_SCHEMA,
      runId,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      request,
      attempts: [],
      events: [{ at: now, kind: 'run', message: 'Evaluation queued.' }],
    }
    this.runs.set(runId, run)
    this.activeRunId = runId
    await this.persist(run)
    void this.execute(run).catch(async (error: unknown) => {
      run.status = 'failed'
      run.error = errorMessage(error)
      this.record(run, { kind: 'run', message: `Evaluation failed: ${run.error}` })
      await this.persist(run).catch((persistError: unknown) => {
        this.ctx.logger.error(`barena-dsh: failed to persist terminal error: ${errorMessage(persistError)}`)
      })
      if (this.activeRunId === run.runId) this.activeRunId = undefined
    })
    return snapshotOf(run)
  }

  private async presets(): Promise<PresetSummary[]> {
    const defaultId = this.ctx.agentPresets.defaultId
    return (await this.ctx.agentPresets.list()).map(preset => ({
      id: preset.id,
      ...(preset.name === undefined ? {} : { name: preset.name }),
      ...(preset.description === undefined ? {} : { description: preset.description }),
      isDefault: preset.id === defaultId,
      ...(preset.broken === undefined ? {} : { broken: preset.broken }),
    }))
  }

  private async assertPresets(request: CreateRunRequest): Promise<void> {
    const presets = await this.presets()
    for (const id of [request.baselinePreset, request.candidatePreset]) {
      const preset = presets.find(item => item.id === id)
      if (preset === undefined) throw new Error(`Agent preset "${id}" is not installed.`)
      if (preset.broken !== undefined) throw new Error(`Agent preset "${id}" is unavailable: ${preset.broken}`)
    }
  }

  private async execute(run: MutableRun): Promise<void> {
    run.status = 'running'
    this.record(run, { kind: 'run', message: 'Paired execution started on the DSH default AgentLoop.' })
    await this.persist(run)
    const selection = structuredClone(this.ctx.agentDefaultModel.currentSelection())
    for (const scheduled of pairedSchedule(run.request.attempts)) {
      this.record(run, {
        kind: 'attempt',
        arm: scheduled.arm,
        attempt: scheduled.attempt,
        message: `${armLabel(scheduled.arm)} attempt ${String(scheduled.attempt)} started.`,
      })
      await this.persist(run)
      const result = await this.runAttempt(run, scheduled.arm, scheduled.attempt, selection)
      run.attempts.push(result)
      this.record(run, {
        kind: 'attempt',
        arm: result.arm,
        attempt: result.attempt,
        message: `${armLabel(result.arm)} attempt ${String(result.attempt)} ${result.status}.`,
      })
      await this.persistAttempt(run, result)
      await this.persist(run)
    }
    run.aggregate = aggregateEvaluation(run.attempts, run.request.attempts)
    run.status = 'completed'
    this.record(run, { kind: 'run', message: `Evaluation completed: ${run.aggregate.verdict}.` })
    await this.persist(run)
    if (this.activeRunId === run.runId) this.activeRunId = undefined
  }

  private async runAttempt(
    run: MutableRun,
    arm: EvaluationArm,
    attempt: number,
    modelSelection: Record<string, unknown>,
  ): Promise<AttemptResult> {
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const preset = arm === 'baseline' ? run.request.baselinePreset : run.request.candidatePreset
    const sessionId = `barena-${run.runId}-${arm}-${String(attempt)}-${randomUUID().slice(0, 8)}`
    const workspace = join(this.runRoot(run), 'workspaces', `${arm}-${String(attempt)}`)
    await mkdir(workspace, { recursive: true })
    let handle: AgentHandle | undefined
    let finalResponse = ''
    let turnEndReason: string | undefined
    let timedOut = false
    let detail = ''
    try {
      handle = await this.ctx.agents.create({
        sessionId,
        meta: { cwd: workspace, agentPreset: preset },
        agentOptions: structuredClone(modelSelection),
        setup: async (agentCtx) => {
          await this.ctx.agentPresets.mount(agentCtx, preset)
        },
      })
      const agent = handle.agent
      const timer = setTimeout(() => {
        timedOut = true
        agent.cancel({ kind: 'user' })
      }, run.request.timeoutMs)
      try {
        agent.followup(userMessage(run.request.case.prompt))
        await agent.whenIdle()
      } finally {
        clearTimeout(timer)
      }
      const events = [...agent.session.events]
      finalResponse = finalAssistantText(events)
      turnEndReason = finalTurnEndReason(events)
      if (timedOut) detail = `Attempt exceeded ${String(run.request.timeoutMs)} ms.`
      else if (turnEndReason !== 'completed') detail = `DSH turn ended with ${turnEndReason ?? 'no durable reason'}.`
      else detail = 'DSH turn completed and the deterministic verifier ran.'
    } catch (error: unknown) {
      detail = `DSH attempt could not complete: ${errorMessage(error)}`
    } finally {
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch (error: unknown) {
          detail = `${detail} Agent disposal failed: ${errorMessage(error)}`.trim()
          turnEndReason = undefined
        }
      }
    }
    const verifierPassed = turnEndReason === 'completed'
      && verifyFinalResponse(finalResponse, run.request.case.expectedText)
    const status: AttemptResult['status'] = timedOut || turnEndReason === undefined
      || !['completed', 'max-tokens', 'blocked', 'error', 'aborted', 'interrupted'].includes(turnEndReason)
      ? 'blocked'
      : turnEndReason !== 'completed'
        ? 'blocked'
        : verifierPassed ? 'pass' : 'fail'
    const completedAt = new Date().toISOString()
    return {
      arm,
      attempt,
      preset,
      sessionId,
      workspace,
      status,
      detail,
      finalResponse,
      ...(turnEndReason === undefined ? {} : { turnEndReason }),
      durationMs: Math.round(performance.now() - started),
      startedAt,
      completedAt,
      verifier: {
        passed: verifierPassed,
        expectedText: run.request.case.expectedText,
      },
    }
  }

  private record(run: MutableRun, event: Omit<RunEvent, 'at'>): void {
    const at = new Date().toISOString()
    run.events.push({ at, ...event })
    if (run.events.length > 200) run.events.splice(0, run.events.length - 200)
    run.updatedAt = at
  }

  private runRoot(run: Pick<MutableRun, 'runId'>): string {
    return join(this.options.runsRoot, run.runId)
  }

  private async persist(run: MutableRun): Promise<void> {
    await writeJsonAtomic(join(this.runRoot(run), 'run.json'), snapshotOf(run))
  }

  private async persistAttempt(run: MutableRun, attempt: AttemptResult): Promise<void> {
    await writeJsonAtomic(
      join(this.runRoot(run), 'attempts', attempt.arm, `${String(attempt.attempt)}.json`),
      attempt,
    )
  }

  private async loadHistory(): Promise<void> {
    const entries = await readdir(this.options.runsRoot, { withFileTypes: true })
    for (const entry of entries.filter(item => item.isDirectory()).slice(-50)) {
      try {
        const parsed = JSON.parse(await readFile(join(this.options.runsRoot, entry.name, 'run.json'), 'utf8')) as RunSnapshot
        if (parsed.schema !== RUN_SCHEMA || typeof parsed.runId !== 'string') continue
        const run: MutableRun = {
          schema: RUN_SCHEMA,
          runId: parsed.runId,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
          status: parsed.status === 'running' || parsed.status === 'queued' ? 'failed' : parsed.status,
          request: parsed.request,
          attempts: [...parsed.attempts],
          events: [...parsed.events],
          ...(parsed.aggregate === undefined ? {} : { aggregate: parsed.aggregate }),
          ...(parsed.status === 'running' || parsed.status === 'queued'
            ? { error: 'The DSH process exited before this evaluation completed.' }
            : parsed.error === undefined ? {} : { error: parsed.error }),
        }
        this.runs.set(run.runId, run)
      } catch {
        // A partial or unrelated directory is not a valid run and remains untouched for diagnosis.
      }
    }
  }
}

function userMessage(text: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'user' }),
  })
}

function armLabel(arm: EvaluationArm): string {
  return arm === 'baseline' ? 'Baseline' : 'Candidate'
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:.TZ]/g, '').slice(0, 14)
}

function snapshotOf(run: MutableRun): RunSnapshot {
  return structuredClone(run) as RunSnapshot
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

class ConflictError extends Error {}

async function routeRequest(
  runtime: BarenaEvaluationRuntime,
  request: HttpRequest,
  response: HttpResponse,
): Promise<void> {
  const method = request.method ?? 'GET'
  const pathname = new URL(request.url ?? '/', 'http://barena.local').pathname
  try {
    if (method === 'GET' && pathname === `${API_PREFIX}/snapshot`) {
      json(response, 200, await runtime.snapshot())
      return
    }
    if (method === 'POST' && pathname === `${API_PREFIX}/runs`) {
      assertSameOrigin(request)
      const created = await runtime.create(await readJsonBody(request))
      json(response, 202, created)
      return
    }
    const runMatch = pathname.match(/^\/barena\/api\/runs\/([a-zA-Z0-9-]+)$/)
    if (method === 'GET' && runMatch?.[1] !== undefined) {
      const run = runtime.get(runMatch[1])
      if (run === undefined) json(response, 404, { error: 'Evaluation run not found.' })
      else json(response, 200, run)
      return
    }
    json(response, 404, { error: 'Barena API route not found.' })
  } catch (error: unknown) {
    const status = error instanceof ConflictError ? 409 : 400
    json(response, status, { error: errorMessage(error) })
  }
}

function assertSameOrigin(request: HttpRequest): void {
  const fetchSite = header(request, 'sec-fetch-site')
  if (fetchSite === 'cross-site') throw new Error('Cross-site evaluation requests are not allowed.')
  const origin = header(request, 'origin')
  if (origin === undefined) return
  const host = header(request, 'host')
  if (host === undefined || new URL(origin).host !== host) {
    throw new Error('Evaluation requests must come from this DSH origin.')
  }
}

function header(request: HttpRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function readJsonBody(request: HttpRequest): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Uint8Array[] = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        request.destroy()
        rejectBody(new Error(`Request body exceeds ${String(MAX_BODY_BYTES)} bytes.`))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(JSON.parse(text))
      } catch {
        rejectBody(new Error('Request body must contain valid JSON.'))
      }
    })
    request.on('error', (error) => { rejectBody(error ?? new Error('Request stream failed.')) })
  })
}

function json(response: HttpResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
