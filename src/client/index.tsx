/** DSH Web Client plugin: first-class sidebar workbench plus a settings fallback. */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  ArmAggregate,
  AttemptResult,
  BarenaSnapshot,
  CreateRunRequest,
  EvaluationArm,
  EvaluationVerdict,
  PresetSummary,
  RunSnapshot,
  RunStatus,
} from '../core.ts'

const NS = 'barena.dshEval'
const STYLE_ID = 'barena-dsh-eval-styles'
const API = '/barena/api'

const zh = {
  tab: 'Barena 评估',
  nav: 'Barena',
  navMeta: '评估',
  navOpen: '打开 Barena 评估工作台',
  navClose: '关闭 Barena 评估工作台',
  workbench: '评估工作台',
  backToHarness: '返回 Harness',
  nativeSurface: 'DSH 原生工作台',
  eyebrow: 'DSH 原生配对评估',
  title: '这次插件，真的让 Harness 变好了吗？',
  intro: '固定任务与模型，只切换 Agent Preset。两组都由 DSH 默认 loop 执行，结论只来自可复查的 Session 证据。',
  protocol: '评估协议',
  freeze: '冻结输入',
  freezeDetail: '同一模型、任务与验证条件',
  replay: '交替复跑',
  replayDetail: 'A/B 顺序轮换，减少时序偏差',
  verify: '确定性验证',
  verifyDetail: '检查最终回复是否包含目标文本',
  boundary: 'MVP 比较 preset 内的工具、提示词和技能；Host 全局插件不属于单进程隔离变量。',
  setup: '新建实验',
  baseline: 'A · 基线',
  candidate: 'B · 候选',
  selectPreset: '选择 Agent Preset',
  unavailablePreset: '不可用',
  needPresets: '至少需要两个可用的 Agent Preset。',
  caseName: '用例名称',
  caseNamePlaceholder: '例如：发布说明检查',
  prompt: '给 Agent 的任务',
  promptPlaceholder: '写一个可被两个 preset 公平执行的任务…',
  expected: '最终回复必须包含',
  expectedPlaceholder: '例如：BARENA_READY',
  expectedHelp: '大小写不敏感；验证的是最终 assistant 文本，不读取思维过程。',
  attempts: '每组复跑',
  oneRun: '1 次',
  threeRuns: '3 次',
  fiveRuns: '5 次',
  timeout: '单次超时',
  twoMinutes: '2 分钟',
  fiveMinutes: '5 分钟',
  tenMinutes: '10 分钟',
  start: '启动原生配对评估',
  starting: '正在创建实验…',
  runningLock: '已有实验运行中',
  loading: '正在连接 Barena Host…',
  loadError: '无法读取 Barena 评估服务。',
  retry: '重试',
  evidence: '证据面板',
  noRuns: '还没有实验。选择两个 preset，跑出第一组可复查证据。',
  live: '实时',
  completed: '已完成',
  queued: '排队中',
  running: '运行中',
  failed: '失败',
  cancelled: '已取消',
  passRate: '通过率',
  stability: '稳定性',
  duration: '平均耗时',
  attemptsDone: '已完成尝试',
  pending: '等待',
  pass: '通过',
  fail: '未通过',
  blocked: '受阻',
  stablePass: '稳定通过',
  stableFailure: '稳定失败',
  flaky: '结果波动',
  incomplete: '证据不完整',
  improved: '候选更好',
  noEffect: '未观察到效果',
  regressed: '候选退化',
  insufficient: '证据不足',
  improvedSummary: '候选组获得稳定、可验证的通过率提升。',
  noEffectSummary: '在这个用例上，两组的验证通过率没有变化。',
  regressedSummary: '候选组的验证通过率低于基线。',
  insufficientSummary: '至少一组受阻、不完整或不稳定，暂不能归因。',
  observedLift: '观察提升',
  latestEvent: '最新进度',
  runError: '运行错误',
  history: '实验记录',
  noHistory: '暂无记录',
  sessionEvidence: '原生 Session 证据',
  finalResponse: '最终回复',
  noResponse: '没有可用的最终回复；显示运行诊断。',
  turnReason: '结束原因',
  workspace: '工作区',
  expectedMarker: '目标文本',
  runId: '运行 ID',
  nativeLoop: 'DSH 默认 AgentLoop',
  isolated: '每次尝试使用新 Session 与独立工作区',
  requestFailed: '无法启动评估。',
} as const

type LocaleKey = keyof typeof zh

const en = {
  tab: 'Barena eval',
  nav: 'Barena',
  navMeta: 'Eval',
  navOpen: 'Open the Barena evaluation workbench',
  navClose: 'Close the Barena evaluation workbench',
  workbench: 'Evaluation workbench',
  backToHarness: 'Back to Harness',
  nativeSurface: 'Native DSH workbench',
  eyebrow: 'Native paired DSH evaluation',
  title: 'Did this plugin actually improve Harness?',
  intro: 'Freeze the task and model, then change only the Agent Preset. Both arms use the DSH default loop and retain reviewable Session evidence.',
  protocol: 'Evaluation protocol',
  freeze: 'Freeze inputs',
  freezeDetail: 'Same model, task, and verifier',
  replay: 'Alternate replays',
  replayDetail: 'Rotate A/B order to reduce timing bias',
  verify: 'Verify deterministically',
  verifyDetail: 'Check the final response for required text',
  boundary: 'The MVP compares preset-scoped tools, prompts, and skills. Host-global plugins are not isolated inside one process.',
  setup: 'New experiment',
  baseline: 'A · Baseline',
  candidate: 'B · Candidate',
  selectPreset: 'Select Agent Preset',
  unavailablePreset: 'Unavailable',
  needPresets: 'At least two healthy Agent Presets are required.',
  caseName: 'Case name',
  caseNamePlaceholder: 'Example: release-note check',
  prompt: 'Task for the Agent',
  promptPlaceholder: 'Write a task both presets can execute fairly…',
  expected: 'Final response must contain',
  expectedPlaceholder: 'Example: BARENA_READY',
  expectedHelp: 'Case-insensitive. The verifier reads final assistant text, never hidden reasoning.',
  attempts: 'Replays per arm',
  oneRun: '1 run',
  threeRuns: '3 runs',
  fiveRuns: '5 runs',
  timeout: 'Attempt timeout',
  twoMinutes: '2 minutes',
  fiveMinutes: '5 minutes',
  tenMinutes: '10 minutes',
  start: 'Start native paired evaluation',
  starting: 'Creating experiment…',
  runningLock: 'An experiment is already running',
  loading: 'Connecting to Barena Host…',
  loadError: 'Barena evaluation service is unavailable.',
  retry: 'Retry',
  evidence: 'Evidence board',
  noRuns: 'No experiments yet. Pick two presets and produce the first reviewable evidence pair.',
  live: 'Live',
  completed: 'Completed',
  queued: 'Queued',
  running: 'Running',
  failed: 'Failed',
  cancelled: 'Cancelled',
  passRate: 'Pass rate',
  stability: 'Stability',
  duration: 'Mean duration',
  attemptsDone: 'Attempts complete',
  pending: 'Pending',
  pass: 'Pass',
  fail: 'Fail',
  blocked: 'Blocked',
  stablePass: 'Stable pass',
  stableFailure: 'Stable failure',
  flaky: 'Flaky',
  incomplete: 'Incomplete evidence',
  improved: 'Candidate improved',
  noEffect: 'No observed effect',
  regressed: 'Candidate regressed',
  insufficient: 'Insufficient evidence',
  improvedSummary: 'The candidate produced a stable, verifier-backed pass-rate improvement.',
  noEffectSummary: 'Verifier-backed pass rates did not change on this case.',
  regressedSummary: 'The candidate pass rate was lower than the baseline.',
  insufficientSummary: 'At least one arm was blocked, incomplete, or unstable, so attribution is premature.',
  observedLift: 'Observed lift',
  latestEvent: 'Latest progress',
  runError: 'Run error',
  history: 'Experiment history',
  noHistory: 'No history yet',
  sessionEvidence: 'Native Session evidence',
  finalResponse: 'Final response',
  noResponse: 'No final response was available; showing the run diagnostic.',
  turnReason: 'Turn reason',
  workspace: 'Workspace',
  expectedMarker: 'Required text',
  runId: 'Run ID',
  nativeLoop: 'DSH default AgentLoop',
  isolated: 'Fresh Session and isolated workspace for every attempt',
  requestFailed: 'Could not start the evaluation.',
} satisfies Record<LocaleKey, string>

type Translator = (key: LocaleKey) => string

interface ClientContext {
  readonly locale: {
    register(namespace: string, dictionaries: { readonly zh: typeof zh; readonly en: typeof en }): () => void
    bind(namespace: string): Translator
  }
  readonly slots: {
    inject(name: string, register: () => unknown): unknown
    register<Props>(
      options: {
        readonly name: string
        readonly id?: string
        readonly order?: number
        readonly label?: () => string
        readonly locale?: string
        readonly inject?: () => Partial<Props>
      },
      component: (props: Props) => ReactNode,
    ): () => void
  }
  effect(register: () => void | (() => void), label?: string): void
}

interface BarenaTabProps {
  readonly t: Translator
}

interface BarenaShellProps {
  readonly t: Translator
}

export const inject = ['slots', 'locale']

/** Register locale, styles, a first-class workbench, and the secondary settings tab. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'barena-dsh: browser dictionaries')
  ctx.effect(installStyles, 'barena-dsh: browser styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'barena-eval',
    order: 30,
    label: () => t('tab'),
    locale: NS,
    inject: () => ({ t }),
  }, BarenaTab))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'barena-workbench',
    order: 10,
    locale: NS,
    inject: () => ({ t }),
  }, BarenaShell))
}

function installStyles(): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => undefined
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
  return () => { style.remove() }
}

/**
 * First-class Barena navigation without replacing DSH's sidebar shell.
 * DSH 0.1.2-alpha.1 has no additive slot at the requested seam, so this
 * official shell-overlay occupant portals one button before the sidebar's
 * direct New Session control. Structural relationships are used instead of
 * localized labels or generated CSS-module class names.
 */
function BarenaShell({ t }: BarenaShellProps): ReactNode {
  const [active, setActive] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(0)
  const [wide, setWide] = useState(true)
  const entryRef = useRef<HTMLButtonElement>(null)
  const workbenchRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const overlay = document.querySelector<HTMLElement>('[data-shell-overlay]')
    const frame = overlay?.parentElement
    const sidebarColumn = frame?.firstElementChild
    if (!(sidebarColumn instanceof HTMLElement)) return

    let sidebarRoot: HTMLElement | undefined
    let target: HTMLElement | undefined
    const resolveSidebarRoot = (): HTMLElement | undefined => {
      let candidate = sidebarColumn.firstElementChild
      while (candidate instanceof HTMLElement) {
        const hasDirectButton = Array.from(candidate.children).some(child => child.tagName === 'BUTTON')
        if (hasDirectButton) return candidate
        if (candidate.children.length !== 1) break
        candidate = candidate.firstElementChild
      }
      return Array.from(sidebarColumn.querySelectorAll<HTMLElement>('div')).find(element => (
        element.children.length >= 3
        && Array.from(element.children).some(child => child.tagName === 'BUTTON')
      ))
    }
    const onSidebarClick = (event: Event): void => {
      const clicked = event.target
      if (!(clicked instanceof Node) || target?.contains(clicked) === true || sidebarRoot === undefined) return
      const logoRow = sidebarRoot.firstElementChild
      const logoButtons = logoRow instanceof HTMLElement
        ? logoRow.querySelectorAll<HTMLElement>(':scope > button')
        : undefined
      const collapseToggle = logoButtons?.item((logoButtons?.length ?? 0) - 1)
      if (collapseToggle?.contains(clicked) === true) return
      setActive(false)
    }

    const sync = (): void => {
      const nextRoot = resolveSidebarRoot()
      if (nextRoot === undefined) return
      if (sidebarRoot !== nextRoot) {
        sidebarRoot?.removeEventListener('click', onSidebarClick)
        sidebarRoot = nextRoot
        sidebarRoot.addEventListener('click', onSidebarClick)
      }
      target ??= sidebarRoot.querySelector<HTMLElement>(':scope > [data-barena-sidebar-host]') ?? undefined
      if (target === undefined) {
        target = document.createElement('div')
        target.dataset.barenaSidebarHost = ''
        target.className = 'barena-sidebar-host'
      }
      const newSession = Array.from(sidebarRoot.children)
        .find((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'BUTTON')
      if (newSession !== undefined && (target.parentElement !== sidebarRoot || target.nextElementSibling !== newSession)) {
        sidebarRoot.insertBefore(target, newSession)
      }
      const logoRow = sidebarRoot.firstElementChild
      const logoButtonCount = logoRow instanceof HTMLElement
        ? logoRow.querySelectorAll(':scope > button').length
        : 0
      setWide(logoButtonCount > 1)
      setSidebarWidth(sidebarColumn.getBoundingClientRect().width)
      setPortalTarget(target)
    }

    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(sidebarColumn)
    const mutationObserver = new MutationObserver(sync)
    mutationObserver.observe(sidebarColumn, { childList: true, subtree: true })
    sync()

    return () => {
      sidebarRoot?.removeEventListener('click', onSidebarClick)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      target?.remove()
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const workbench = workbenchRef.current
    if (workbench === null) return
    const overlay = workbench.closest<HTMLElement>('[data-shell-overlay]')
    const frame = overlay?.parentElement
    const sidebarColumn = frame?.firstElementChild
    const centerColumn = sidebarColumn?.nextElementSibling
    const detailsColumn = centerColumn?.nextElementSibling
    const obscured = [centerColumn, detailsColumn].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    )
    const previous = obscured.map(element => ({
      element,
      inert: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
    for (const { element } of previous) {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setActive(false)
      window.requestAnimationFrame(() => { entryRef.current?.focus() })
    }
    document.addEventListener('keydown', onKeyDown)
    window.requestAnimationFrame(() => { workbench.focus() })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      for (const state of previous) {
        if (!state.inert) state.element.removeAttribute('inert')
        if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden')
        else state.element.setAttribute('aria-hidden', state.ariaHidden)
      }
    }
  }, [active])

  const close = (): void => {
    setActive(false)
    window.requestAnimationFrame(() => { entryRef.current?.focus() })
  }

  return (
    <>
      {portalTarget === null ? null : createPortal(
        <button
          ref={entryRef}
          type="button"
          className="barena-sidebar-entry"
          data-active={active ? 'true' : undefined}
          data-wide={wide ? 'true' : 'false'}
          data-barena-sidebar-entry
          aria-label={active ? t('navClose') : t('navOpen')}
          aria-pressed={active}
          title={wide ? undefined : active ? t('navClose') : t('navOpen')}
          onClick={() => { setActive(value => !value) }}
        >
          <span className="barena-sidebar-glyph" aria-hidden="true"><b>A</b><i /><b>B</b></span>
          {wide ? <span className="barena-sidebar-label">{t('nav')}</span> : null}
          {wide ? <small>{t('navMeta')}</small> : null}
        </button>,
        portalTarget,
      )}
      <section
        ref={workbenchRef}
        className="barena-workbench"
        style={{ left: `${String(sidebarWidth)}px` }}
        hidden={!active}
        tabIndex={-1}
        aria-label={t('workbench')}
      >
        <header className="barena-workbench-bar">
          <div className="barena-workbench-identity">
            <span className="barena-sidebar-glyph" aria-hidden="true"><b>A</b><i /><b>B</b></span>
            <span><strong>{t('nav')}</strong><small>{t('workbench')}</small></span>
          </div>
          <span className="barena-workbench-native"><i />{t('nativeSurface')}</span>
          <button type="button" onClick={close}><span aria-hidden="true">←</span>{t('backToHarness')}</button>
        </header>
        <div className="barena-workbench-scroll">
          <div className="barena-workbench-canvas"><BarenaTab t={t} /></div>
        </div>
      </section>
    </>
  )
}

function BarenaTab({ t }: BarenaTabProps): ReactNode {
  const [snapshot, setSnapshot] = useState<BarenaSnapshot>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [requestNonce, setRequestNonce] = useState(0)
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [baselinePreset, setBaselinePreset] = useState('')
  const [candidatePreset, setCandidatePreset] = useState('')
  const [caseName, setCaseName] = useState('Plugin capability probe')
  const [prompt, setPrompt] = useState(
    'Use the capabilities available to you to complete this task. Briefly state what you used and the result. Finish your final response with the exact marker BARENA_READY.',
  )
  const [expectedText, setExpectedText] = useState('BARENA_READY')
  const [attempts, setAttempts] = useState(3)
  const [timeoutMs, setTimeoutMs] = useState(300_000)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const active = snapshot?.activeRunId !== undefined
  useEffect(() => {
    let current = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await getJson<BarenaSnapshot>(`${API}/snapshot`)
        if (!current) return
        setSnapshot(next)
        setLoadError('')
      } catch (error: unknown) {
        if (current) setLoadError(errorMessage(error))
      } finally {
        if (current) setLoading(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, active ? 900 : 4_000)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [active, requestNonce])

  const healthyPresets = useMemo(
    () => snapshot?.presets.filter(item => item.broken === undefined) ?? [],
    [snapshot?.presets],
  )
  const healthyKey = healthyPresets.map(item => item.id).join('\u0000')
  useEffect(() => {
    const defaultPreset = healthyPresets.find(item => item.isDefault) ?? healthyPresets[0]
    const nextBaseline = healthyPresets.some(item => item.id === baselinePreset)
      ? baselinePreset
      : defaultPreset?.id ?? ''
    if (nextBaseline !== baselinePreset) setBaselinePreset(nextBaseline)
    const nextCandidate = healthyPresets.some(item => item.id === candidatePreset && item.id !== nextBaseline)
      ? candidatePreset
      : healthyPresets.find(item => item.id !== nextBaseline)?.id ?? ''
    if (nextCandidate !== candidatePreset) setCandidatePreset(nextCandidate)
  }, [healthyKey, baselinePreset, candidatePreset])

  const selectedRun = snapshot?.runs.find(run => run.runId === selectedRunId)
    ?? snapshot?.runs.find(run => run.runId === snapshot.activeRunId)
    ?? snapshot?.runs[0]
  const canSubmit = !active && !submitting && healthyPresets.length >= 2
    && baselinePreset.length > 0 && candidatePreset.length > 0
    && baselinePreset !== candidatePreset && caseName.trim().length > 0
    && prompt.trim().length > 0 && expectedText.trim().length > 0

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError('')
    const request: CreateRunRequest = {
      baselinePreset,
      candidatePreset,
      case: {
        name: caseName.trim(),
        prompt: prompt.trim(),
        expectedText: expectedText.trim(),
      },
      attempts,
      timeoutMs,
    }
    try {
      const run = await getJson<RunSnapshot>(`${API}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      setSelectedRunId(run.runId)
      setRequestNonce(value => value + 1)
    } catch (error: unknown) {
      setSubmitError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && snapshot === undefined) {
    return <p className="barena-status" aria-live="polite">{t('loading')}</p>
  }
  if (snapshot === undefined) {
    return (
      <div className="barena-failure" role="alert">
        <p>{t('loadError')}</p>
        {loadError.length > 0 ? <code>{loadError}</code> : null}
        <button type="button" onClick={() => { setLoading(true); setRequestNonce(value => value + 1) }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <main className="barena-root">
      <header className="barena-hero">
        <div>
          <p className="barena-eyebrow"><MarkIcon />{t('eyebrow')}</p>
          <h3>{t('title')}</h3>
          <p className="barena-intro">{t('intro')}</p>
        </div>
        <div className="barena-runtime-stamp" title={t('isolated')}>
          <span aria-hidden="true" />
          <div><strong>{t('nativeLoop')}</strong><small>{t('isolated')}</small></div>
        </div>
      </header>

      <section className="barena-protocol" aria-labelledby="barena-protocol-title">
        <p id="barena-protocol-title">{t('protocol')}</p>
        <ProtocolStep number="01" title={t('freeze')} detail={t('freezeDetail')} />
        <ProtocolStep number="02" title={t('replay')} detail={t('replayDetail')} />
        <ProtocolStep number="03" title={t('verify')} detail={t('verifyDetail')} />
      </section>
      <p className="barena-boundary"><InfoIcon />{t('boundary')}</p>

      <form className="barena-form" onSubmit={(event) => { void submit(event) }}>
        <div className="barena-section-heading">
          <h4>{t('setup')}</h4>
          <span>{healthyPresets.length} presets</span>
        </div>
        <div className="barena-preset-grid">
          <PresetSelect
            arm="baseline"
            label={t('baseline')}
            value={baselinePreset}
            presets={snapshot.presets}
            otherValue={candidatePreset}
            placeholder={t('selectPreset')}
            unavailable={t('unavailablePreset')}
            onChange={setBaselinePreset}
          />
          <PresetSelect
            arm="candidate"
            label={t('candidate')}
            value={candidatePreset}
            presets={snapshot.presets}
            otherValue={baselinePreset}
            placeholder={t('selectPreset')}
            unavailable={t('unavailablePreset')}
            onChange={setCandidatePreset}
          />
        </div>
        {healthyPresets.length < 2 ? <p className="barena-inline-alert">{t('needPresets')}</p> : null}
        <label className="barena-field">
          <span>{t('caseName')}</span>
          <input
            value={caseName}
            maxLength={120}
            placeholder={t('caseNamePlaceholder')}
            onChange={(event) => { setCaseName(event.currentTarget.value) }}
          />
        </label>
        <label className="barena-field">
          <span>{t('prompt')}</span>
          <textarea
            value={prompt}
            maxLength={12_000}
            rows={5}
            placeholder={t('promptPlaceholder')}
            onChange={(event) => { setPrompt(event.currentTarget.value) }}
          />
        </label>
        <div className="barena-input-grid">
          <label className="barena-field">
            <span>{t('expected')}</span>
            <input
              className="barena-mono-input"
              value={expectedText}
              maxLength={2_000}
              placeholder={t('expectedPlaceholder')}
              onChange={(event) => { setExpectedText(event.currentTarget.value) }}
            />
            <small>{t('expectedHelp')}</small>
          </label>
          <div className="barena-run-controls">
            <fieldset>
              <legend>{t('attempts')}</legend>
              <div className="barena-segmented">
                {([1, 3, 5] as const).map(value => (
                  <label key={value} data-selected={attempts === value ? 'true' : undefined}>
                    <input
                      type="radio"
                      name="barena-attempts"
                      value={value}
                      checked={attempts === value}
                      onChange={() => { setAttempts(value) }}
                    />
                    {value === 1 ? t('oneRun') : value === 3 ? t('threeRuns') : t('fiveRuns')}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="barena-field barena-timeout">
              <span>{t('timeout')}</span>
              <select value={timeoutMs} onChange={(event) => { setTimeoutMs(Number(event.currentTarget.value)) }}>
                <option value={120_000}>{t('twoMinutes')}</option>
                <option value={300_000}>{t('fiveMinutes')}</option>
                <option value={600_000}>{t('tenMinutes')}</option>
              </select>
            </label>
          </div>
        </div>
        {submitError.length > 0 ? (
          <p className="barena-submit-error" role="alert"><strong>{t('requestFailed')}</strong> {submitError}</p>
        ) : null}
        <button className="barena-primary" type="submit" disabled={!canSubmit}>
          <RunIcon />
          {submitting ? t('starting') : active ? t('runningLock') : t('start')}
        </button>
      </form>

      <section className="barena-results" aria-labelledby="barena-evidence-title">
        <div className="barena-section-heading">
          <h4 id="barena-evidence-title">{t('evidence')}</h4>
          {selectedRun?.status === 'running' || selectedRun?.status === 'queued'
            ? <span className="barena-live"><i />{t('live')}</span>
            : null}
        </div>
        {selectedRun === undefined
          ? <EmptyEvidence t={t} />
          : <RunEvidence run={selectedRun} t={t} />}
      </section>

      <section className="barena-history" aria-labelledby="barena-history-title">
        <div className="barena-section-heading">
          <h4 id="barena-history-title">{t('history')}</h4>
          <span>{snapshot.runs.length}</span>
        </div>
        {snapshot.runs.length === 0 ? <p className="barena-empty-line">{t('noHistory')}</p> : (
          <div className="barena-history-list">
            {snapshot.runs.map(run => (
              <button
                type="button"
                key={run.runId}
                aria-pressed={run.runId === selectedRun?.runId}
                onClick={() => { setSelectedRunId(run.runId) }}
              >
                <span data-verdict={run.aggregate?.verdict ?? run.status} />
                <strong>{run.request.case.name}</strong>
                <code>{run.request.baselinePreset} → {run.request.candidatePreset}</code>
                <time dateTime={run.createdAt}>{formatDate(run.createdAt)}</time>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function ProtocolStep(props: { readonly number: string; readonly title: string; readonly detail: string }): ReactNode {
  return (
    <div className="barena-protocol-step">
      <code>{props.number}</code>
      <span><strong>{props.title}</strong><small>{props.detail}</small></span>
    </div>
  )
}

function PresetSelect(props: {
  readonly arm: EvaluationArm
  readonly label: string
  readonly value: string
  readonly presets: readonly PresetSummary[]
  readonly otherValue: string
  readonly placeholder: string
  readonly unavailable: string
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <label className="barena-preset" data-arm={props.arm}>
      <span><i>{props.arm === 'baseline' ? 'A' : 'B'}</i>{props.label}</span>
      <select value={props.value} onChange={(event) => { props.onChange(event.currentTarget.value) }}>
        <option value="">{props.placeholder}</option>
        {props.presets.map(preset => (
          <option
            key={preset.id}
            value={preset.id}
            disabled={preset.broken !== undefined || preset.id === props.otherValue}
          >
            {preset.name ?? preset.id}{preset.isDefault ? ' · default' : ''}
            {preset.broken === undefined ? '' : ` · ${props.unavailable}`}
          </option>
        ))}
      </select>
      <code>{props.value || '—'}</code>
    </label>
  )
}

function EmptyEvidence({ t }: { readonly t: Translator }): ReactNode {
  return (
    <div className="barena-empty-evidence">
      <div className="barena-empty-rails" aria-hidden="true">
        <span><i>A</i><b /><b /><b /></span>
        <span><i>B</i><b /><b /><b /></span>
      </div>
      <p>{t('noRuns')}</p>
    </div>
  )
}

function RunEvidence({ run, t }: { readonly run: RunSnapshot; readonly t: Translator }): ReactNode {
  const latest = run.events[run.events.length - 1]
  const verdict = run.aggregate?.verdict
  const verdictKey = verdict === undefined ? undefined : VERDICT_KEYS[verdict]
  return (
    <article className="barena-run" data-status={run.status}>
      <header className="barena-run-header">
        <div>
          <span className="barena-run-status" data-status={run.status}>{t(STATUS_KEYS[run.status])}</span>
          <h5>{run.request.case.name}</h5>
        </div>
        <code title={t('runId')}>{run.runId}</code>
      </header>
      <div className="barena-case-strip">
        <span>{t('expectedMarker')}</span>
        <code>{run.request.case.expectedText}</code>
      </div>
      <div className="barena-arm-grid">
        <EvidenceArm arm="baseline" run={run} aggregate={run.aggregate?.baseline} t={t} />
        <EvidenceArm arm="candidate" run={run} aggregate={run.aggregate?.candidate} t={t} />
      </div>
      {verdict !== undefined && verdictKey !== undefined ? (
        <div className="barena-verdict" data-verdict={verdict}>
          <span className="barena-verdict-mark" aria-hidden="true">{verdictGlyph(verdict)}</span>
          <div>
            <p>{t(verdictKey)}</p>
            <strong>{t(VERDICT_SUMMARY_KEYS[verdict])}</strong>
          </div>
          <dl>
            <dt>{t('observedLift')}</dt>
            <dd>{formatLift(run.aggregate?.observedLift ?? null)}</dd>
          </dl>
        </div>
      ) : null}
      {latest !== undefined ? (
        <div className="barena-progress-line">
          <span>{t('latestEvent')}</span><p>{latest.message}</p><time>{formatClock(latest.at)}</time>
        </div>
      ) : null}
      {run.error !== undefined ? (
        <p className="barena-run-error" role="alert"><strong>{t('runError')}</strong>{run.error}</p>
      ) : null}
      <details className="barena-native-evidence">
        <summary>
          <span><SessionIcon />{t('sessionEvidence')}</span>
          <code>{run.attempts.length}/{run.request.attempts * 2}</code>
        </summary>
        <div className="barena-native-list">
          {run.attempts.map(attempt => (
            <article key={`${attempt.arm}-${String(attempt.attempt)}`} data-arm={attempt.arm}>
              <header>
                <strong>{attempt.arm === 'baseline' ? t('baseline') : t('candidate')} · {attempt.attempt}</strong>
                <span data-status={attempt.status}>{t(attempt.status)}</span>
              </header>
              <code className="barena-session-id">{attempt.sessionId}</code>
              <dl>
                <div><dt>{t('turnReason')}</dt><dd>{attempt.turnEndReason ?? '—'}</dd></div>
                <div><dt>{t('duration')}</dt><dd>{formatDuration(attempt.durationMs)}</dd></div>
                <div><dt>{t('workspace')}</dt><dd><code>{attempt.workspace}</code></dd></div>
              </dl>
              <p>{t('finalResponse')}</p>
              <pre>{attempt.finalResponse.length > 0 ? attempt.finalResponse : `${t('noResponse')} ${attempt.detail}`}</pre>
            </article>
          ))}
        </div>
      </details>
    </article>
  )
}

function EvidenceArm(props: {
  readonly arm: EvaluationArm
  readonly run: RunSnapshot
  readonly aggregate: ArmAggregate | undefined
  readonly t: Translator
}): ReactNode {
  const { arm, run, aggregate, t } = props
  const armAttempts = run.attempts.filter(item => item.arm === arm)
  const pass = armAttempts.filter(item => item.status === 'pass').length
  const blocked = armAttempts.some(item => item.status === 'blocked')
  const provisionalRate = armAttempts.length === 0 || blocked ? null : pass / armAttempts.length
  const rate = aggregate?.passRate ?? provisionalRate
  const preset = arm === 'baseline' ? run.request.baselinePreset : run.request.candidatePreset
  return (
    <section className="barena-arm" data-arm={arm} aria-label={arm === 'baseline' ? t('baseline') : t('candidate')}>
      <header>
        <span><i>{arm === 'baseline' ? 'A' : 'B'}</i>{arm === 'baseline' ? t('baseline') : t('candidate')}</span>
        <code>{preset}</code>
      </header>
      <div className="barena-score">
        <strong>{formatRate(rate)}</strong>
        <span>{t('passRate')}</span>
      </div>
      <div className="barena-rail" style={{ gridTemplateColumns: `repeat(${String(run.request.attempts)}, minmax(0, 1fr))` }}>
        {Array.from({ length: run.request.attempts }, (_, index) => {
          const attempt = armAttempts.find(item => item.attempt === index + 1)
          return <AttemptCell key={index} attempt={attempt} number={index + 1} t={t} />
        })}
      </div>
      <dl className="barena-arm-metrics">
        <div><dt>{t('attemptsDone')}</dt><dd>{armAttempts.length}/{run.request.attempts}</dd></div>
        <div>
          <dt>{t('stability')}</dt>
          <dd>{aggregate === undefined ? '—' : t(STABILITY_KEYS[aggregate.stability])}</dd>
        </div>
        <div><dt>{t('duration')}</dt><dd>{formatDuration(aggregate?.meanDurationMs ?? null)}</dd></div>
      </dl>
    </section>
  )
}

function AttemptCell(props: {
  readonly attempt: AttemptResult | undefined
  readonly number: number
  readonly t: Translator
}): ReactNode {
  const status = props.attempt?.status ?? 'pending'
  const label = status === 'pending' ? props.t('pending') : props.t(status)
  const detail = props.attempt === undefined
    ? `${label} · ${String(props.number)}`
    : `${label} · ${formatDuration(props.attempt.durationMs)} · ${props.attempt.detail}`
  return (
    <span className="barena-attempt-cell" data-status={status} title={detail} aria-label={detail}>
      <b>{status === 'pass' ? '✓' : status === 'fail' ? '×' : status === 'blocked' ? '!' : props.number}</b>
      <small>{label}</small>
    </span>
  )
}

const STATUS_KEYS = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} satisfies Record<RunStatus, LocaleKey>

const STABILITY_KEYS = {
  stable_pass: 'stablePass',
  stable_failure: 'stableFailure',
  flaky: 'flaky',
  blocked: 'blocked',
  incomplete: 'incomplete',
} satisfies Record<ArmAggregate['stability'], LocaleKey>

const VERDICT_KEYS = {
  improved: 'improved',
  no_effect: 'noEffect',
  regressed: 'regressed',
  insufficient_evidence: 'insufficient',
} satisfies Record<EvaluationVerdict, LocaleKey>

const VERDICT_SUMMARY_KEYS = {
  improved: 'improvedSummary',
  no_effect: 'noEffectSummary',
  regressed: 'regressedSummary',
  insufficient_evidence: 'insufficientSummary',
} satisfies Record<EvaluationVerdict, LocaleKey>

async function getJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: 'same-origin', ...init })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`HTTP ${String(response.status)}`)
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      && typeof (payload as { readonly error?: unknown }).error === 'string'
      ? (payload as { readonly error: string }).error
      : `HTTP ${String(response.status)}`
    throw new Error(message)
  }
  return payload as T
}

function formatRate(value: number | null): string {
  return value === null ? '—' : `${String(Math.round(value * 100))}%`
}

function formatLift(value: number | null): string {
  if (value === null) return '—'
  const points = Math.round(value * 100)
  return `${points > 0 ? '+' : ''}${String(points)} pp`
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  if (value < 1_000) return `${String(value)} ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatClock(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function verdictGlyph(verdict: EvaluationVerdict): string {
  if (verdict === 'improved') return '↑'
  if (verdict === 'regressed') return '↓'
  if (verdict === 'no_effect') return '＝'
  return '?'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function MarkIcon(): ReactNode {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15.5h4.2V8.2H3v7.3Zm4.9 0h4.2V3.8H7.9v11.7Zm4.9 0H17V6.1h-4.2v9.4Z" /></svg>
}

function InfoIcon(): ReactNode {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6.5v.2" /></svg>
}

function RunIcon(): ReactNode {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 7 6-7 6V4Z" /></svg>
}

function SessionIcon(): ReactNode {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h12v9H4zM7 8l2 2-2 2m3.5 0H13" /></svg>
}

const CSS = String.raw`
.barena-sidebar-host { flex: none; min-width: 0; }
.barena-sidebar-entry {
  display: flex;
  width: calc(100% - 4px);
  height: 38px;
  align-items: center;
  gap: 9px;
  margin: 0 2px 8px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #3977f6) 24%, var(--dsw-alias-border-l2, #dce0e8));
  border-radius: 12px;
  padding: 0 11px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3977f6) 7%, var(--dsw-alias-button-elevated-fill, #fff));
  color: var(--dsw-alias-label-primary, #172033);
  font: inherit;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}
.barena-sidebar-entry:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3977f6) 12%, var(--dsw-alias-button-elevated-fill, #fff));
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3977f6) 42%, var(--dsw-alias-border-l2, #dce0e8));
}
.barena-sidebar-entry[data-active='true'] {
  border-color: var(--dsw-alias-state-business-primary, #3977f6);
  background: var(--dsw-alias-state-business-primary, #3977f6);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
.barena-sidebar-entry:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #3977f6);
  outline-offset: 2px;
}
.barena-sidebar-entry[data-wide='false'] {
  width: 36px;
  height: 36px;
  justify-content: center;
  gap: 0;
  margin: 0 0 12px;
  border-color: transparent;
  padding: 0;
  background: transparent;
}
.barena-sidebar-entry[data-wide='false']:hover,
.barena-sidebar-entry[data-wide='false'][data-active='true'] {
  border-color: transparent;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3977f6) 14%, transparent);
  color: var(--dsw-alias-state-business-primary, #3977f6);
}
.barena-sidebar-glyph {
  display: inline-flex;
  width: 23px;
  height: 20px;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 1px solid currentColor;
  border-radius: 6px;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
}
.barena-sidebar-glyph b { font-size: 7px; font-weight: 700; line-height: 1; }
.barena-sidebar-glyph i { width: 1px; height: 9px; background: currentColor; opacity: .42; transform: rotate(18deg); }
.barena-sidebar-label { overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.barena-sidebar-entry > small {
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary, #737b8c);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 8px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.barena-sidebar-entry[data-active='true'] > small { color: currentColor; opacity: .72; }
.barena-workbench {
  position: absolute;
  inset: 0 0 0 auto;
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  outline: none;
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #172033);
  transition: left var(--ds-transition-duration-slow, 300ms) var(--ds-ease-in-out, ease);
}
.barena-workbench[hidden] { display: none; }
.barena-workbench-bar {
  display: flex;
  min-height: 58px;
  flex: none;
  align-items: center;
  gap: 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e6e8ed);
  padding: 0 clamp(18px, 3vw, 34px);
  background: var(--dsw-specific-sidebar-fill, #f7f8fa);
}
.barena-workbench-identity { display: flex; min-width: 0; align-items: center; gap: 10px; }
.barena-workbench-identity > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.barena-workbench-identity strong { font-size: 13px; line-height: 17px; }
.barena-workbench-identity small { color: var(--dsw-alias-label-tertiary, #737b8c); font-size: 9px; line-height: 12px; }
.barena-workbench-native {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary, #737b8c);
  font-size: 9px;
}
.barena-workbench-native i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #21a675);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #21a675) 12%, transparent);
}
.barena-workbench-bar > button {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--dsw-alias-border-l2, #dce0e8);
  border-radius: 9px;
  padding: 0 11px;
  background: var(--dsw-alias-button-elevated-fill, #fff);
  color: var(--dsw-alias-label-secondary, #50596b);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.barena-workbench-bar > button:hover { background: var(--dsw-alias-button-floating-hover, #f2f3f6); color: var(--dsw-alias-label-primary, #172033); }
.barena-workbench-bar > button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #3977f6); outline-offset: 2px; }
.barena-workbench-bar > button span { font-size: 14px; }
.barena-workbench-scroll { min-height: 0; flex: 1; overflow: auto; overflow-x: hidden; }
.barena-workbench-canvas {
  container-name: barena-workbench;
  container-type: inline-size;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 30px clamp(20px, 4vw, 54px) 54px;
}
.barena-workbench .barena-root {
  display: grid;
  width: 100%;
  max-width: 1180px;
  grid-template-columns: minmax(0, 1.08fr) minmax(350px, .92fr);
  gap: 18px 20px;
  margin: 0 auto;
}
.barena-workbench .barena-hero,
.barena-workbench .barena-protocol,
.barena-workbench .barena-boundary { grid-column: 1 / -1; }
.barena-workbench .barena-form {
  grid-column: 1;
  grid-row: 4 / span 2;
}
.barena-workbench .barena-results { grid-column: 2; grid-row: 4; }
.barena-workbench .barena-history { grid-column: 2; grid-row: 5; }
.barena-workbench .barena-results .barena-empty-evidence { flex-direction: column; text-align: center; }
.barena-workbench .barena-form,
.barena-workbench .barena-results,
.barena-workbench .barena-history {
  align-self: start;
  border: 1px solid var(--barena-border);
  border-radius: 12px;
  padding: 17px;
  background: var(--barena-layer);
}
.barena-root {
  --barena-blue: var(--dsw-alias-state-business-primary, #3977f6);
  --barena-green: var(--dsw-alias-state-success-primary, #21a675);
  --barena-red: var(--dsw-alias-state-error-primary, #dc5960);
  --barena-amber: var(--dsw-alias-state-warn-primary, #d08a24);
  --barena-text: var(--dsw-alias-label-primary, #172033);
  --barena-muted: var(--dsw-alias-label-tertiary, #737b8c);
  --barena-secondary: var(--dsw-alias-label-secondary, #50596b);
  --barena-border: var(--dsw-alias-border-l2, #dce0e8);
  --barena-layer: var(--dsw-alias-bg-layer-3, #fff);
  --barena-soft: var(--dsw-alias-bg-layer-1, #f6f7f9);
  box-sizing: border-box;
  container-name: barena-eval;
  container-type: inline-size;
  display: flex;
  width: 100%;
  max-width: 760px;
  flex-direction: column;
  gap: 18px;
  color: var(--barena-text);
}
.barena-root *, .barena-root *::before, .barena-root *::after { box-sizing: border-box; }
.barena-root h3, .barena-root h4, .barena-root h5, .barena-root p, .barena-root dl, .barena-root dd { margin: 0; }
.barena-root button, .barena-root input, .barena-root textarea, .barena-root select { font: inherit; }
.barena-root code { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); }
.barena-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-top: 2px; }
.barena-hero > div:first-child { max-width: 510px; }
.barena-eyebrow { display: flex; align-items: center; gap: 7px; color: var(--barena-blue); font-size: 11px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; }
.barena-eyebrow svg { width: 15px; height: 15px; fill: currentColor; }
.barena-hero h3 { margin-top: 8px; max-width: 560px; font-size: clamp(20px, 3vw, 27px); line-height: 1.18; letter-spacing: -.025em; }
.barena-intro { margin-top: 9px !important; color: var(--barena-secondary); font-size: 13px; line-height: 1.65; }
.barena-runtime-stamp { display: flex; width: 186px; flex: none; align-items: flex-start; gap: 9px; border-left: 1px solid var(--barena-border); padding: 5px 0 5px 14px; }
.barena-runtime-stamp > span { width: 8px; height: 8px; flex: none; margin-top: 4px; border: 2px solid color-mix(in srgb, var(--barena-green) 28%, transparent); border-radius: 50%; background: var(--barena-green); }
.barena-runtime-stamp div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.barena-runtime-stamp strong { font-size: 11px; line-height: 16px; }
.barena-runtime-stamp small { color: var(--barena-muted); font-size: 10px; line-height: 14px; }
.barena-protocol { display: grid; grid-template-columns: 88px repeat(3, minmax(0, 1fr)); border: 1px solid var(--barena-border); border-radius: 10px; overflow: hidden; background: var(--barena-layer); }
.barena-protocol > p { display: flex; align-items: center; padding: 12px; background: var(--barena-soft); color: var(--barena-muted); font-size: 10px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
.barena-protocol-step { display: grid; grid-template-columns: auto 1fr; gap: 8px; min-width: 0; border-left: 1px solid var(--barena-border); padding: 11px 10px; }
.barena-protocol-step code { color: var(--barena-blue); font-size: 10px; }
.barena-protocol-step span { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.barena-protocol-step strong { font-size: 11px; line-height: 15px; }
.barena-protocol-step small { color: var(--barena-muted); font-size: 9px; line-height: 13px; }
.barena-boundary { display: flex; align-items: flex-start; gap: 7px; margin-top: -9px !important; color: var(--barena-muted); font-size: 10px; line-height: 16px; }
.barena-boundary svg { width: 14px; height: 14px; flex: none; margin-top: 1px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; }
.barena-form, .barena-results, .barena-history { display: flex; flex-direction: column; gap: 13px; border-top: 1px solid var(--barena-border); padding-top: 16px; }
.barena-section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.barena-section-heading h4 { font-size: 14px; font-weight: 650; letter-spacing: -.01em; }
.barena-section-heading > span { color: var(--barena-muted); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 10px; }
.barena-preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.barena-preset { position: relative; display: flex; min-width: 0; flex-direction: column; gap: 9px; border: 1px solid var(--barena-border); border-top: 3px solid var(--barena-blue); border-radius: 9px; padding: 11px 12px 10px; background: var(--barena-layer); }
.barena-preset[data-arm='candidate'] { border-top-color: var(--barena-green); }
.barena-preset > span { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 650; }
.barena-preset > span i, .barena-arm header span i { display: inline-grid; width: 19px; height: 19px; place-items: center; border-radius: 4px; background: color-mix(in srgb, var(--barena-blue) 12%, transparent); color: var(--barena-blue); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 10px; font-style: normal; }
.barena-preset[data-arm='candidate'] > span i, .barena-arm[data-arm='candidate'] header span i { background: color-mix(in srgb, var(--barena-green) 12%, transparent); color: var(--barena-green); }
.barena-preset select, .barena-field input, .barena-field textarea, .barena-field select { width: 100%; border: 1px solid var(--barena-border); border-radius: 7px; outline: none; background: var(--barena-soft); color: var(--barena-text); font-size: 12px; }
.barena-preset select, .barena-field input, .barena-field select { height: 36px; padding: 0 10px; }
.barena-preset > code { overflow: hidden; color: var(--barena-muted); font-size: 9px; line-height: 13px; text-overflow: ellipsis; white-space: nowrap; }
.barena-field { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.barena-field > span, .barena-run-controls legend { color: var(--barena-secondary); font-size: 11px; font-weight: 600; }
.barena-field textarea { min-height: 104px; resize: vertical; padding: 9px 10px; line-height: 1.55; }
.barena-field small { color: var(--barena-muted); font-size: 9px; line-height: 14px; }
.barena-mono-input { font-family: var(--ds-font-family-code, ui-monospace, monospace) !important; }
.barena-preset select:focus-visible, .barena-field input:focus-visible, .barena-field textarea:focus-visible, .barena-field select:focus-visible { border-color: var(--barena-blue); box-shadow: 0 0 0 2px color-mix(in srgb, var(--barena-blue) 16%, transparent); }
.barena-input-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(250px, .85fr); gap: 16px; align-items: start; }
.barena-run-controls { display: grid; grid-template-columns: minmax(0, 1fr) 112px; gap: 10px; }
.barena-run-controls fieldset { min-width: 0; border: 0; margin: 0; padding: 0; }
.barena-run-controls legend { margin-bottom: 6px; padding: 0; }
.barena-segmented { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); height: 36px; border: 1px solid var(--barena-border); border-radius: 7px; overflow: hidden; background: var(--barena-soft); }
.barena-segmented label { display: grid; min-width: 0; place-items: center; border-left: 1px solid var(--barena-border); color: var(--barena-muted); font-size: 10px; cursor: pointer; }
.barena-segmented label:first-child { border-left: 0; }
.barena-segmented label[data-selected='true'] { background: var(--barena-text); color: var(--barena-layer); }
.barena-segmented input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.barena-segmented label:focus-within { outline: 2px solid var(--barena-blue); outline-offset: -2px; }
.barena-primary { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 8px; padding: 0 18px; background: var(--barena-text); color: var(--barena-layer); font-size: 12px; font-weight: 650; cursor: pointer; }
.barena-primary svg { width: 15px; height: 15px; fill: currentColor; }
.barena-primary:hover:not(:disabled) { opacity: .88; }
.barena-primary:focus-visible { outline: 2px solid var(--barena-blue); outline-offset: 2px; }
.barena-primary:disabled { cursor: not-allowed; opacity: .42; }
.barena-inline-alert, .barena-submit-error, .barena-run-error { border-left: 2px solid var(--barena-amber); padding-left: 9px; color: var(--barena-muted); font-size: 10px; line-height: 16px; }
.barena-submit-error, .barena-run-error { border-left-color: var(--barena-red); color: var(--barena-red); }
.barena-submit-error strong, .barena-run-error strong { margin-right: 6px; }
.barena-live { display: inline-flex !important; align-items: center; gap: 6px; color: var(--barena-green) !important; }
.barena-live i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: barena-pulse 1.4s ease-in-out infinite; }
.barena-empty-evidence { display: flex; min-height: 144px; align-items: center; justify-content: center; gap: 26px; border: 1px dashed var(--barena-border); border-radius: 9px; padding: 22px; background: var(--barena-soft); }
.barena-empty-evidence p { max-width: 270px; color: var(--barena-muted); font-size: 11px; line-height: 17px; }
.barena-empty-rails { display: flex; width: 150px; flex-direction: column; gap: 10px; }
.barena-empty-rails span { display: grid; grid-template-columns: 22px repeat(3, 1fr); gap: 5px; align-items: center; }
.barena-empty-rails i { color: var(--barena-muted); font-family: var(--ds-font-family-code, monospace); font-size: 10px; font-style: normal; }
.barena-empty-rails b { height: 17px; border: 1px solid var(--barena-border); border-radius: 4px; }
.barena-run { overflow: hidden; border: 1px solid var(--barena-border); border-radius: 10px; background: var(--barena-layer); }
.barena-run-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--barena-border); padding: 12px 14px; }
.barena-run-header > div { display: flex; min-width: 0; align-items: center; gap: 9px; }
.barena-run-header h5 { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.barena-run-header > code { max-width: 260px; overflow: hidden; color: var(--barena-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.barena-run-status { display: inline-flex; min-height: 20px; align-items: center; border-radius: 4px; padding: 1px 6px; background: var(--barena-soft); color: var(--barena-secondary); font-size: 9px; white-space: nowrap; }
.barena-run-status[data-status='running'], .barena-run-status[data-status='queued'] { background: color-mix(in srgb, var(--barena-blue) 10%, transparent); color: var(--barena-blue); }
.barena-run-status[data-status='failed'] { background: color-mix(in srgb, var(--barena-red) 10%, transparent); color: var(--barena-red); }
.barena-case-strip { display: flex; align-items: center; gap: 9px; border-bottom: 1px solid var(--barena-border); padding: 8px 14px; background: var(--barena-soft); }
.barena-case-strip span { color: var(--barena-muted); font-size: 9px; }
.barena-case-strip code { overflow-wrap: anywhere; color: var(--barena-secondary); font-size: 10px; }
.barena-arm-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.barena-arm { min-width: 0; padding: 15px 14px 13px; }
.barena-arm + .barena-arm { border-left: 1px solid var(--barena-border); }
.barena-arm > header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 9px; }
.barena-arm > header span { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 650; }
.barena-arm > header code { overflow: hidden; color: var(--barena-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.barena-score { display: flex; align-items: baseline; gap: 7px; margin-top: 13px; }
.barena-score strong { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 25px; font-weight: 600; letter-spacing: -.04em; }
.barena-score span { color: var(--barena-muted); font-size: 9px; }
.barena-rail { display: grid; gap: 6px; margin-top: 10px; }
.barena-attempt-cell { display: flex; min-width: 0; height: 44px; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--barena-border); border-radius: 6px; background: var(--barena-soft); color: var(--barena-muted); }
.barena-attempt-cell b { font-family: var(--ds-font-family-code, monospace); font-size: 11px; }
.barena-attempt-cell small { overflow: hidden; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.barena-arm[data-arm='baseline'] .barena-attempt-cell[data-status='pass'] { border-color: color-mix(in srgb, var(--barena-blue) 35%, var(--barena-border)); background: color-mix(in srgb, var(--barena-blue) 8%, transparent); color: var(--barena-blue); }
.barena-arm[data-arm='candidate'] .barena-attempt-cell[data-status='pass'] { border-color: color-mix(in srgb, var(--barena-green) 35%, var(--barena-border)); background: color-mix(in srgb, var(--barena-green) 8%, transparent); color: var(--barena-green); }
.barena-attempt-cell[data-status='fail'] { border-color: color-mix(in srgb, var(--barena-red) 35%, var(--barena-border)); background: color-mix(in srgb, var(--barena-red) 8%, transparent); color: var(--barena-red); }
.barena-attempt-cell[data-status='blocked'] { border-color: color-mix(in srgb, var(--barena-amber) 35%, var(--barena-border)); background: color-mix(in srgb, var(--barena-amber) 8%, transparent); color: var(--barena-amber); }
.barena-arm-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin-top: 11px !important; }
.barena-arm-metrics div { min-width: 0; }
.barena-arm-metrics dt { color: var(--barena-muted); font-size: 8px; line-height: 13px; }
.barena-arm-metrics dd { overflow: hidden; margin-top: 2px; color: var(--barena-secondary); font-family: var(--ds-font-family-code, monospace); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.barena-verdict { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 11px; border-top: 1px solid var(--barena-border); padding: 13px 14px; background: var(--barena-soft); }
.barena-verdict-mark { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 7px; background: color-mix(in srgb, var(--barena-muted) 11%, transparent); color: var(--barena-muted); font-family: var(--ds-font-family-code, monospace); font-size: 19px; }
.barena-verdict[data-verdict='improved'] .barena-verdict-mark { background: color-mix(in srgb, var(--barena-green) 12%, transparent); color: var(--barena-green); }
.barena-verdict[data-verdict='regressed'] .barena-verdict-mark { background: color-mix(in srgb, var(--barena-red) 12%, transparent); color: var(--barena-red); }
.barena-verdict > div p { font-size: 12px; font-weight: 650; }
.barena-verdict > div strong { display: block; margin-top: 3px; color: var(--barena-muted); font-size: 9px; font-weight: 400; line-height: 14px; }
.barena-verdict dl { border-left: 1px solid var(--barena-border); padding-left: 13px; text-align: right; }
.barena-verdict dt { color: var(--barena-muted); font-size: 8px; }
.barena-verdict dd { margin-top: 3px; font-family: var(--ds-font-family-code, monospace); font-size: 14px; font-weight: 650; }
.barena-progress-line { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; align-items: baseline; gap: 9px; border-top: 1px solid var(--barena-border); padding: 9px 14px; }
.barena-progress-line span { color: var(--barena-muted); font-size: 8px; text-transform: uppercase; }
.barena-progress-line p { overflow: hidden; color: var(--barena-secondary); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.barena-progress-line time { color: var(--barena-muted); font-family: var(--ds-font-family-code, monospace); font-size: 8px; }
.barena-run-error { margin: 9px 14px !important; }
.barena-native-evidence { border-top: 1px solid var(--barena-border); color: var(--barena-muted); }
.barena-native-evidence > summary { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; list-style: none; cursor: pointer; }
.barena-native-evidence > summary::-webkit-details-marker { display: none; }
.barena-native-evidence > summary span { display: flex; align-items: center; gap: 6px; font-size: 8px; text-transform: uppercase; letter-spacing: .05em; }
.barena-native-evidence > summary span::after { content: '+'; margin-left: 4px; font-family: var(--ds-font-family-code, monospace); font-size: 11px; }
.barena-native-evidence[open] > summary span::after { content: '−'; }
.barena-native-evidence > summary svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
.barena-native-evidence > summary code { font-size: 9px; }
.barena-native-evidence > summary:focus-visible { outline: 2px solid var(--barena-blue); outline-offset: -2px; }
.barena-native-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; border-top: 1px solid var(--barena-border); padding: 10px; background: var(--barena-soft); }
.barena-native-list article { min-width: 0; border: 1px solid var(--barena-border); border-top: 2px solid var(--barena-blue); border-radius: 7px; padding: 10px; background: var(--barena-layer); }
.barena-native-list article[data-arm='candidate'] { border-top-color: var(--barena-green); }
.barena-native-list header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.barena-native-list header strong { color: var(--barena-text); font-size: 9px; }
.barena-native-list header span { border-radius: 4px; padding: 1px 5px; background: var(--barena-soft); font-size: 8px; }
.barena-native-list header span[data-status='pass'] { color: var(--barena-green); }
.barena-native-list header span[data-status='fail'] { color: var(--barena-red); }
.barena-native-list header span[data-status='blocked'] { color: var(--barena-amber); }
.barena-session-id { display: block; overflow: hidden; margin-top: 6px; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.barena-native-list dl { display: grid; gap: 4px; margin-top: 8px !important; }
.barena-native-list dl div { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px; }
.barena-native-list dt, .barena-native-list > article > p { color: var(--barena-muted); font-size: 8px; }
.barena-native-list dd { overflow: hidden; color: var(--barena-secondary); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.barena-native-list dd code { font-size: inherit; }
.barena-native-list > article > p { margin-top: 8px !important; }
.barena-native-list pre { max-height: 130px; overflow: auto; margin: 4px 0 0; border-radius: 5px; padding: 7px; background: var(--barena-soft); color: var(--barena-secondary); font-family: var(--ds-font-family-code, monospace); font-size: 8px; line-height: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.barena-history-list { display: flex; flex-direction: column; border: 1px solid var(--barena-border); border-radius: 9px; overflow: hidden; }
.barena-history-list button { display: grid; grid-template-columns: 8px minmax(120px, 1fr) minmax(140px, .8fr) auto; align-items: center; gap: 10px; min-height: 42px; border: 0; border-top: 1px solid var(--barena-border); padding: 7px 10px; background: var(--barena-layer); color: var(--barena-text); text-align: left; cursor: pointer; }
.barena-history-list button:first-child { border-top: 0; }
.barena-history-list button:hover, .barena-history-list button[aria-pressed='true'] { background: var(--barena-soft); }
.barena-history-list button:focus-visible { outline: 2px solid var(--barena-blue); outline-offset: -2px; }
.barena-history-list button > span { width: 6px; height: 6px; border-radius: 50%; background: var(--barena-muted); }
.barena-history-list button > span[data-verdict='improved'] { background: var(--barena-green); }
.barena-history-list button > span[data-verdict='regressed'], .barena-history-list button > span[data-verdict='failed'] { background: var(--barena-red); }
.barena-history-list button > span[data-verdict='running'], .barena-history-list button > span[data-verdict='queued'] { background: var(--barena-blue); }
.barena-history-list strong { overflow: hidden; font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.barena-history-list code, .barena-history-list time { overflow: hidden; color: var(--barena-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.barena-empty-line, .barena-status { color: var(--barena-muted, var(--dsw-alias-label-tertiary)); font-size: 12px; }
.barena-failure { display: flex; max-width: 760px; flex-direction: column; align-items: flex-start; gap: 8px; color: var(--dsw-alias-state-error-primary, #dc5960); font-size: 12px; }
.barena-failure code { color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.barena-failure button { border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 5px 10px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
@keyframes barena-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@media (max-width: 700px) {
  .barena-workbench-native { display: none; }
  .barena-workbench-bar { gap: 10px; padding-inline: 14px; }
  .barena-workbench-bar > button { margin-left: auto; }
  .barena-hero { flex-direction: column; gap: 12px; }
  .barena-runtime-stamp { width: 100%; border-left: 0; border-top: 1px solid var(--barena-border); padding: 10px 0 0; }
  .barena-protocol { grid-template-columns: 1fr; }
  .barena-protocol > p { min-height: 34px; }
  .barena-protocol-step { border-top: 1px solid var(--barena-border); border-left: 0; }
  .barena-input-grid { grid-template-columns: 1fr; }
}
@container barena-workbench (max-width: 980px) {
  .barena-workbench .barena-root {
    display: flex;
    max-width: 780px;
    margin: 0 auto;
  }
  .barena-workbench .barena-form,
  .barena-workbench .barena-results,
  .barena-workbench .barena-history { width: 100%; }
}
@container barena-eval (max-width: 640px) {
  .barena-input-grid { grid-template-columns: 1fr; }
}
@container barena-eval (max-width: 500px) {
  .barena-hero { flex-direction: column; gap: 12px; }
  .barena-runtime-stamp { width: 100%; border-top: 1px solid var(--barena-border); border-left: 0; padding: 10px 0 0; }
  .barena-protocol { grid-template-columns: 1fr; }
  .barena-protocol > p { min-height: 34px; }
  .barena-protocol-step { border-top: 1px solid var(--barena-border); border-left: 0; }
  .barena-preset-grid, .barena-arm-grid { grid-template-columns: 1fr; }
  .barena-native-list { grid-template-columns: 1fr; }
  .barena-arm + .barena-arm { border-top: 1px solid var(--barena-border); border-left: 0; }
}
@media (max-width: 520px) {
  .barena-preset-grid, .barena-arm-grid { grid-template-columns: 1fr; }
  .barena-arm + .barena-arm { border-top: 1px solid var(--barena-border); border-left: 0; }
  .barena-run-controls { grid-template-columns: 1fr; }
  .barena-verdict { grid-template-columns: 36px minmax(0, 1fr); }
  .barena-verdict dl { grid-column: 2; border-left: 0; padding-left: 0; text-align: left; }
  .barena-progress-line { grid-template-columns: 1fr auto; }
  .barena-progress-line p { grid-column: 1 / -1; grid-row: 2; }
  .barena-history-list button { grid-template-columns: 8px minmax(0, 1fr) auto; }
  .barena-history-list code { grid-column: 2 / -1; grid-row: 2; }
  .barena-empty-evidence { flex-direction: column; text-align: center; }
}
@media (prefers-reduced-motion: reduce) {
  .barena-sidebar-entry, .barena-workbench { transition: none; }
  .barena-live i { animation: none; }
}
`
