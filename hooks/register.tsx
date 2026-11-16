// The wand: a button in the band above the prompt box. A press reads the
// draft, rewrites it for the model the session runs, and puts the rewrite in
// the box, with Undo to get the draft back. A long rewrite, or one that could
// not go in the box, waits in a preview pane for the person to check.
//
// Every function that takes `$` is a top-level declaration in this file, and
// every call on `$` is a plain `$.noun.method(...)` on one line: the plugin
// directory reads `$` only that way. The pure parts live in the other files.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, PluginOptions, Register, Timer, UiPressArgument } from 'claude-code'

import type { DraftKind, WandHoldReason, WandMode, WandPhase, WandStyle } from '../types'
import { agentFromFile, catalogueOf } from './agents'
import type { AgentCatalogue, AgentEntry } from './agents'
import { INSTRUCTION_NAMES, messageOf, outcomeOf, projectFrom } from './pipeline'
import type { Rewrite, RewriteJob, StopReason } from './pipeline'
import { targetFor } from './profiles'
import { MAX_DRAFT_CHARS, problemWith, requestFor } from './rewrite'
import type { DraftProblem, ProjectContext, Rewriter } from './rewrite'

// The feature's name in one place, so a rename is one edit.
const NAME = 'Sharpen prompt'
const DOING = 'Sharpening'
const DONE = 'Sharpened'
const SPLIT_NAME = 'Sharpen prompt with subagents'
const SPLIT_LABEL = 'With subagents'

const ICON: Record<WandStyle, string> = { plain: '🪄', subagents: '🧩' }
const STYLE_TAIL: Record<WandStyle, string> = { plain: '', subagents: ' with subagents' }

const PANE = 'prompt-wand-preview'
const PANE_TITLE = 'Rewritten prompt'
const MODE_KEY = 'mode'

// A rewrite longer than this many lines goes to the preview, not the box.
const LONG_LINES = 15

/** The call in flight, so Cancel and a sent prompt can stop it, and its clock. */
type Runner = { current: AbortController | undefined; tick: Timer | undefined }

/** Each mode's rewriter, or what is wrong with that mode's settings. */
type Rewriters = Record<WandMode, Rewriter | string>

/** What every press needs: the rewriters, the call in flight, the agents offered. */
type Wand = {
  readonly rewriters: Rewriters
  readonly runner: Runner
  /** Agent types the engine offered the model this session, by name. */
  readonly offered: Map<string, AgentEntry>
}

const IDLE: WandPhase = { kind: 'idle' }

// Change the tag when WandPhase changes: what an earlier version stored then
// reads as idle instead of as a value of the old shape.
const phase = atom({ plugin: 'prompt-wand', key: 'phase' } as const, IDLE, {
  shape: 'phase-3',
})
const draft = atom({ plugin: 'prompt-wand', key: 'draft' } as const, 'unknown')
const used = atom({ plugin: 'prompt-wand', key: 'used' } as const, false)
const mode = atom({ plugin: 'prompt-wand', key: 'mode' } as const, 'thorough')

const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

const isEffort = (value: unknown): value is ModelEffort =>
  typeof value === 'string' && EFFORTS.includes(value)

const isMode = (value: unknown): value is WandMode => value === 'quick' || value === 'thorough'

const MODE_TEXT: Record<WandMode, string> = { quick: 'Quick', thorough: 'Thorough' }
const OTHER_MODE: Record<WandMode, WandMode> = { quick: 'thorough', thorough: 'quick' }

/** One mode's rewriter from its two settings, or what is wrong with them. */
const rewriterFrom = (model: unknown, effort: unknown, title: string): Rewriter | string => {
  if (typeof model !== 'string' || model.trim() === '') {
    return `Set "${title} model" in the prompt-wand settings.`
  }
  if (!isEffort(effort)) {
    return `Set "${title} effort" in the prompt-wand settings to low, medium, high, xhigh or max.`
  }

  return { model: model.trim(), effort }
}

const rewritersFrom = (options: PluginOptions): Rewriters => ({
  thorough: rewriterFrom(options.rewriterModel, options.rewriterEffort, 'Thorough'),
  quick: rewriterFrom(options.quickModel, options.quickEffort, 'Quick'),
})

const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const PROBLEM_TEXT: Record<DraftProblem, string> = {
  empty: 'Type your request in the prompt box first.',
  command: 'Slash commands and shell lines stay as you typed them.',
  'too-long': `The draft is over ${withCommas(MAX_DRAFT_CHARS)} characters. Shorten it first.`,
}

const HOLD_TEXT: Record<WandHoldReason, string> = {
  edited: 'You edited the draft, so it was kept.',
  dialog: 'A dialog was open, so the draft was kept.',
  refused: 'The prompt box did not take it.',
  long: 'Check it before it replaces your draft.',
}

const kindOf = (text: string): DraftKind => {
  const problem = problemWith(text)
  return problem === 'empty' ? 'empty' : problem === 'command' ? 'command' : 'text'
}

const lineCount = (text: string): number => text.split('\n').length

const isLong = (rewritten: string): boolean => lineCount(rewritten) > LONG_LINES

/** "Claude Opus 5.5" reads as "Opus 5.5" in the band, where space is short. */
const shortName = (label: string): string => label.replace(/^Claude /, '')

const stop = (runner: Runner, reason: StopReason): void => runner.current?.abort(reason)

const stopTick = (runner: Runner): void => {
  runner.tick?.cancel()
  runner.tick = undefined
}

async function setDraft($: EngineInterface, kind: DraftKind) {
  // Only a change redraws the band, not every key.
  if ((await read($, draft)) !== kind) await update($, draft, () => kind)
}

async function openPreview($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
  if (!opened.isPlaced) $.ui.log(`prompt-wand: preview not shown: ${opened.reason}`, { to: 'debug' })
}

/** The project's instruction files and top-level names, read as the session sees them. */
async function projectOf($: EngineInterface): Promise<ProjectContext | undefined> {
  try {
    const root = await $.session.root()
    const found = await $.fs.ancestors({ names: INSTRUCTION_NAMES })
    const listed = await $.fs.list(root)
    return projectFrom(root, found, listed)
  } catch (error: unknown) {
    $.ui.log(`prompt-wand: rewriting without project context: ${messageOf(error)}`, { to: 'debug' })
    return undefined
  }
}

/** One agent file, or undefined when it cannot be read or has no name. */
async function agentFileAt($: EngineInterface, path: string, source: string): Promise<AgentEntry | undefined> {
  try {
    const text = await $.fs.read(path)
    return agentFromFile(text, source)
  } catch (error: unknown) {
    $.ui.log(`prompt-wand: agent file ${path} not read: ${messageOf(error)}`, { to: 'debug' })
    return undefined
  }
}

/** The agent definitions in one folder; none where the folder does not exist. */
async function agentFilesIn($: EngineInterface, dir: string, source: string): Promise<AgentEntry[]> {
  let names: string[] = []
  try {
    const listed = await $.fs.list(dir)
    names = listed.filter(entry => entry.kind === 'file' && entry.name.endsWith('.md')).map(entry => entry.name)
  } catch (error: unknown) {
    $.ui.log(`prompt-wand: no agents read from ${dir}: ${messageOf(error)}`, { to: 'debug' })
  }
  const agents = await Promise.all(names.map(name => agentFileAt($, `${dir}/${name}`, source)))
  return agents.filter((agent): agent is AgentEntry => agent !== undefined)
}

/**
 * The subagent types the session can use: the ones it offered the model, with
 * the models their files set. A project agent wins over a user agent of its name.
 */
async function agentsOf($: EngineInterface, offered: readonly AgentEntry[]): Promise<AgentCatalogue> {
  try {
    const root = await $.session.root()
    const configured = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = await $.env.get('HOME')
    const userDir = configured ?? (home === undefined ? undefined : `${home}/.claude`)
    const user = userDir === undefined ? [] : await agentFilesIn($, `${userDir}/agents`, 'user')
    const project = await agentFilesIn($, `${root}/.claude/agents`, 'project')
    const byName = new Map([...user, ...project].map(agent => [agent.name, agent]))
    return catalogueOf(offered, [...byName.values()])
  } catch (error: unknown) {
    $.ui.log(`prompt-wand: splitting without the agent list: ${messageOf(error)}`, { to: 'debug' })
    return catalogueOf(offered, [])
  }
}

/**
 * Rewrites one draft. Resolves the rewrite, or why there is none; rejects only
 * where the engine refuses to send the request (a blocked model, say).
 */
async function rewriteDraft($: EngineInterface, job: RewriteJob): Promise<Rewrite> {
  const project = await projectOf($)
  const agents = job.style === 'subagents' ? await agentsOf($, job.offered) : undefined
  const now = await $.clock.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const request = requestFor({
    draft: job.draft,
    target: job.target,
    project,
    today,
    rewriter: job.rewriter,
    style: job.style,
    agents,
  })
  const result = await $.model.complete(request, { signal: job.signal })
  return outcomeOf(result, job.signal)
}

async function closePreview($: EngineInterface) {
  await $.ui.close({ id: PANE })
}

async function fail($: EngineInterface, style: WandStyle, why: string, canRetry: boolean) {
  await update($, phase, (): WandPhase => ({ kind: 'failed', style, why, canRetry }))
}

async function hold($: EngineInterface, ready: Extract<WandPhase, { kind: 'ready' }>) {
  await update($, phase, () => ready)
  await openPreview($)
}

// Puts the rewrite in the box unless the person typed meanwhile, which a
// replace would throw away, or the rewrite is long enough to check first.
type Placed = {
  readonly target: string
  readonly style: WandStyle
  readonly original: string
  readonly rewritten: string
  readonly summary: string
}

async function place($: EngineInterface, done: Placed) {
  const box = await $.prompt.read()
  const ready = { kind: 'ready', target: done.target, style: done.style, rewritten: done.rewritten, summary: done.summary } as const

  if (box.text !== done.original) return hold($, { ...ready, why: 'edited' })
  if (isLong(done.rewritten)) return hold($, { ...ready, why: 'long' })

  const filled = await $.prompt.fill({ text: done.rewritten, mode: 'replace' })

  if (!filled.isFilled) return hold($, { ...ready, why: filled.refusal === 'dialog' ? 'dialog' : 'refused' })

  await update($, phase, (): WandPhase => ({
    kind: 'applied',
    target: done.target,
    style: done.style,
    original: done.original,
    summary: done.summary,
  }))
}

async function wand($: EngineInterface, ctx: Wand, style: WandStyle) {
  const { rewriters, runner } = ctx
  if (runner.current !== undefined) return

  const chosen = await read($, mode)
  const rewriter = rewriters[chosen]

  if (typeof rewriter === 'string') {
    await fail($, style, rewriter, false)
    return
  }

  const controller = new AbortController()
  runner.current = controller

  try {
    const { text: original } = await $.prompt.read()
    const problem = problemWith(original)

    if (problem !== undefined) {
      await fail($, style, PROBLEM_TEXT[problem], false)
      return
    }

    const target = targetFor(await $.session.model())
    const startedAt = await $.clock.now()
    await closePreview($)
    await update($, phase, (): WandPhase => ({ kind: 'working', target: target.label, mode: chosen, style, startedAt }))
    // Redraws the band each second so the elapsed time moves.
    runner.tick = $.clock.every(1000, () => $.ui.invalidate('ui.render'))

    const outcome = await rewriteDraft($, {
      draft: original,
      target,
      rewriter,
      signal: controller.signal,
      style,
      offered: [...ctx.offered.values()],
    })
    stopTick(runner)

    switch (outcome.kind) {
      case 'rewritten':
        await update($, used, () => true)
        await place($, { target: target.label, style, original, rewritten: outcome.text, summary: outcome.summary })
        return
      case 'stopped':
        // A cancel or a sent prompt needs no word: the person did it.
        await update($, phase, () => IDLE)
        return
      case 'failed':
        await fail($, style, `No rewrite: ${outcome.why}. Your draft is unchanged.`, true)
        return
    }
  } catch (error: unknown) {
    await fail($, style, `The rewrite failed: ${messageOf(error)}. Your draft is unchanged.`, true)
  } finally {
    stopTick(runner)
    runner.current = undefined
  }
}

async function apply($: EngineInterface) {
  const now = await read($, phase)
  if (now.kind !== 'ready') return

  const box = await $.prompt.read()
  const filled = await $.prompt.fill({ text: now.rewritten, mode: 'replace' })

  if (!filled.isFilled) {
    const why =
      filled.refusal === 'dialog'
        ? 'Close the open dialog, then press Replace draft again.'
        : 'The prompt box did not take the rewrite. Press Copy and paste it instead.'
    $.ui.toast(why)
    return
  }

  // Undo then brings back what the box held, the person's later edits included.
  await update($, phase, (): WandPhase => ({
    kind: 'applied',
    target: now.target,
    style: now.style,
    original: box.text,
    summary: now.summary,
  }))
  await closePreview($)
}

async function discard($: EngineInterface) {
  await update($, phase, () => IDLE)
  await closePreview($)
}

async function undo($: EngineInterface) {
  const now = await read($, phase)
  if (now.kind !== 'applied') return

  const filled = await $.prompt.fill({ text: now.original, mode: 'replace' })

  if (!filled.isFilled) {
    $.ui.toast('The prompt box did not take your draft back. Close any open dialog and press Undo again.')
    return
  }

  await update($, phase, () => IDLE)
}

async function copyRewrite($: EngineInterface, press: UiPressArgument) {
  const now = await read($, phase)
  if (now.kind !== 'ready') return

  const copied = await $.ui.copy({ text: now.rewritten, surface: press.surface })

  $.ui.toast(copied.isCopied ? 'Copied the rewrite.' : `Could not copy the rewrite (${copied.reason}).`)
}

async function toggleMode($: EngineInterface) {
  const next = OTHER_MODE[await read($, mode)]
  await update($, mode, () => next)
  await $.store.set(MODE_KEY, next)
}

export const register: Register = (on, options) => {
  // A reload starts this over, and `session.start` then clears a stale `working`.
  // The offered agents fill again as the engine next lists them for the model.
  const ctx: Wand = {
    rewriters: rewritersFrom(options),
    runner: { current: undefined, tick: undefined },
    offered: new Map(),
  }
  const { runner } = ctx
  // Whether this surface reports typing. Until it does, an empty-box report
  // (a clear after a send, say) is not trusted to hide the wand for good.
  let seesEdits = false

  // The desktop app starts a spare process before a chat claims it, so the
  // band can be asked for before any surface draws it. Asking again once the
  // session is up, and on each attach, puts the wand there without a reload.
  on('session.start', async ($, e, next) => {
    const now = await read($, phase)
    if (now.kind === 'working') await update($, phase, () => IDLE)

    const saved = await $.store.get(MODE_KEY)
    if (isMode(saved)) await update($, mode, () => saved)

    const result = await next(e)
    $.ui.invalidate('ui.render')
    return result
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    $.ui.invalidate('ui.render')
    return result
  })

  // The agent types the model is offered: built-in, project, user and plugin
  // ones, as the session lists them. Only what is offered is recorded.
  on('agent.offer', async ($, e, next) => {
    const result = await next(e)
    if (result.isOffered) {
      ctx.offered.set(e.agent, { name: e.agent, description: e.description, source: e.source, model: undefined })
    } else {
      ctx.offered.delete(e.agent)
    }
    return result
  })

  // The draft as the person types, so the wand hides where it has nothing to do.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    seesEdits = true
    setDraft($, kindOf(box.text)).catch((error: unknown) =>
      $.ui.log(`prompt-wand: draft not tracked: ${messageOf(error)}`, { to: 'debug' }),
    )
    return box
  })

  // A prompt the person sends ends the wand's part: a rewrite still running is
  // stale, and Undo would bring back a draft that was already sent.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta !== true) {
      stop(runner, 'submitted')
      const now = await read($, phase)
      if (now.kind !== 'idle') await update($, phase, () => IDLE)
      if (now.kind === 'ready') await closePreview($)
      // The box is empty after a send.
      if (seesEdits) await setDraft($, 'empty')
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, phase)
    const row = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 1 } as const

    switch (now.kind) {
      case 'idle': {
        const kind = await read($, draft)
        if (kind === 'empty' || kind === 'command') return next(e)

        const chosen = await read($, mode)
        const isUsed = await read($, used)

        return (
          <Box {...row}>
            <Button key="wand" label={NAME} onPress={() => wand($, ctx, 'plain')}>
              {isUsed ? ICON.plain : `${ICON.plain} ${NAME}`}
            </Button>
            <Button key="split" label={SPLIT_NAME} onPress={() => wand($, ctx, 'subagents')}>
              {isUsed ? ICON.subagents : `${ICON.subagents} ${SPLIT_LABEL}`}
            </Button>
            <Button
              key="mode"
              label={`${MODE_TEXT[chosen]} mode. Press for ${MODE_TEXT[OTHER_MODE[chosen]].toLowerCase()} mode`}
              dimColor
              onPress={() => toggleMode($)}
            >
              {MODE_TEXT[chosen]}
            </Button>
          </Box>
        )
      }
      case 'working': {
        const seconds = Math.max(0, Math.round(((await $.clock.now()) - now.startedAt) / 1000))

        return (
          <Box {...row}>
            <Text>
              {ICON[now.style]} {DOING} for {shortName(now.target)}
              {STYLE_TAIL[now.style]}
            </Text>
            <Text dimColor>
              {MODE_TEXT[now.mode]} · {seconds} s
            </Text>
            <Button key="cancel" label="Cancel" dimColor onPress={() => stop(runner, 'cancelled')} />
          </Box>
        )
      }
      case 'ready':
        return (
          <Box {...row}>
            <Text>
              {ICON[now.style]} Rewrite ready ({lineCount(now.rewritten)} lines). {HOLD_TEXT[now.why]}
            </Text>
            {now.summary !== '' && <Text dimColor>{now.summary}</Text>}
            <Button key="apply" label="Replace draft" variant="primary" onPress={() => apply($)} />
            <Button key="preview" label="Show" onPress={() => openPreview($)} />
            <Button key="copy" label="Copy" onPress={press => copyRewrite($, press)} />
            <Button key="discard" label="Discard" role="dismiss" onPress={() => discard($)} />
          </Box>
        )
      case 'applied':
        return (
          <Box {...row}>
            <Text dimColor>
              ✓ {DONE} for {shortName(now.target)}
              {STYLE_TAIL[now.style]}
              {now.summary === '' ? '' : `: ${now.summary}`}
            </Text>
            <Button key="undo" label="Undo (until you send)" onPress={() => undo($)} />
            <Button
              key="again"
              label={`${now.style === 'plain' ? NAME : SPLIT_NAME} again`}
              dimColor
              onPress={() => wand($, ctx, now.style)}
            >
              {ICON[now.style]} Again
            </Button>
          </Box>
        )
      case 'failed':
        return (
          <Box {...row}>
            <Text>
              {ICON[now.style]} {now.why}
            </Text>
            {now.canRetry && (
              <Button key="retry" label="Retry" variant="primary" onPress={() => wand($, ctx, now.style)} />
            )}
            <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => update($, phase, () => IDLE)} />
          </Box>
        )
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, phase)

    if (now.kind !== 'ready') {
      return (
        <Box>
          <Text dimColor>No rewrite waiting.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {now.summary !== '' && <Text dimColor>{now.summary}</Text>}
        <Text>{now.rewritten}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="apply" label="Replace draft" variant="primary" onPress={() => apply($)} />
          <Button key="copy" label="Copy" onPress={press => copyRewrite($, press)} />
          <Button key="discard" label="Discard" onPress={() => discard($)} />
        </Box>
      </Box>
    )
  })
}
