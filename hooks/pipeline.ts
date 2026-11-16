// The rewrite as one call on `$`: gather the project context, ask the
// rewriter, and read its reply. The pure parts are in rewrite.ts.

import type { EngineInterface, ModelCompleteResult } from 'claude-code'

import type { WandStyle } from '../types'
import { agentFromFile, catalogueOf } from './agents'
import type { AgentCatalogue, AgentEntry } from './agents'
import type { TargetModel } from './profiles'
import { requestFor, rewriteFrom } from './rewrite'
import type { ProjectContext, Rewriter } from './rewrite'

/** The reason `abort` is given, so the failure text can say who stopped it. */
export type StopReason = 'cancelled' | 'submitted'

export type Rewrite =
  | { readonly kind: 'rewritten'; readonly text: string; readonly summary: string }
  | { readonly kind: 'stopped'; readonly reason: StopReason }
  | { readonly kind: 'failed'; readonly why: string }

export type RewriteJob = {
  readonly draft: string
  readonly target: TargetModel
  readonly rewriter: Rewriter
  readonly signal: AbortSignal
  readonly style: WandStyle
  /** The agent types the session has offered the model so far. */
  readonly offered: readonly AgentEntry[]
}

const INSTRUCTION_NAMES = ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md']
// Folders and files that say nothing about the project's layout.
const SKIPPED = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.DS_Store'])

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isInside = (dir: string, root: string): boolean =>
  dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`)

// The functions here that take `$` are declarations, not arrow functions:
// `claude plugin validate` follows `$` across an import only into those.

/** The project's instruction files and top-level names, read as the session sees them. */
export async function projectOf($: EngineInterface): Promise<ProjectContext> {
  const root = await $.session.root()
  const [found, listed] = await Promise.all([
    $.fs.ancestors({ names: INSTRUCTION_NAMES }),
    $.fs.list(root),
  ])

  return {
    root,
    entries: listed
      .filter(entry => !SKIPPED.has(entry.name))
      .map(entry => (entry.kind === 'dir' ? `${entry.name}/` : entry.name))
      .sort(),
    // Files above the project are the person's own, not the project's.
    instructions: found
      .filter(file => isInside(file.dir, root))
      .map(file => ({ path: `${file.dir}/${file.name}`, content: file.content })),
  }
}

/** The agent definitions in one folder; none where the folder does not exist. */
async function agentFilesIn($: EngineInterface, dir: string, source: string): Promise<AgentEntry[]> {
  const listed = await $.fs.list(dir).catch((error: unknown) => {
    $.ui.log(`prompt-wand: no agents read from ${dir}: ${messageOf(error)}`, { to: 'debug' })
    return []
  })
  const read = await Promise.all(
    listed
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
      .map(entry =>
        $.fs
          .read(`${dir}/${entry.name}`)
          .then(text => agentFromFile(text, source))
          .catch((error: unknown) => {
            $.ui.log(`prompt-wand: agent file ${entry.name} not read: ${messageOf(error)}`, { to: 'debug' })
            return undefined
          }),
      ),
  )

  return read.filter((agent): agent is AgentEntry => agent !== undefined)
}

/**
 * The subagent types the session can use: the ones it offered the model, with
 * the models their files set. A project agent wins over a user agent of its name.
 */
export async function agentsOf($: EngineInterface, offered: readonly AgentEntry[]): Promise<AgentCatalogue> {
  const root = await $.session.root()
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const userDir = configured ?? (home === undefined ? undefined : `${home}/.claude`)

  const [user, project] = await Promise.all([
    userDir === undefined ? Promise.resolve([]) : agentFilesIn($, `${userDir}/agents`, 'user'),
    agentFilesIn($, `${root}/.claude/agents`, 'project'),
  ])
  const byName = new Map([...user, ...project].map(agent => [agent.name, agent]))

  return catalogueOf(offered, [...byName.values()])
}

const failureOf = (result: Extract<ModelCompleteResult, { isAnswered: false }>): string => {
  switch (result.reason) {
    case 'api-error':
      return `the API answered ${result.error}${result.status === null ? '' : ` (HTTP ${result.status})`}`
    case 'empty-reply':
      return 'the rewriter sent back no text'
    case 'aborted':
      return 'the call was cut off before it finished'
  }
}

const stopReasonOf = (signal: AbortSignal): StopReason =>
  signal.reason === 'submitted' ? 'submitted' : 'cancelled'

/**
 * Rewrites one draft. Resolves the rewrite, or why there is none; rejects only
 * where the engine refuses to send the request (a blocked model, say).
 */
export async function rewriteDraft($: EngineInterface, job: RewriteJob): Promise<Rewrite> {
  const project = await projectOf($).catch((error: unknown) => {
    $.ui.log(`prompt-wand: rewriting without project context: ${messageOf(error)}`, { to: 'debug' })
    return undefined
  })
  const agents =
    job.style === 'subagents'
      ? await agentsOf($, job.offered).catch((error: unknown) => {
          $.ui.log(`prompt-wand: splitting without the agent list: ${messageOf(error)}`, { to: 'debug' })
          return catalogueOf(job.offered, [])
        })
      : undefined
  const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const result = await $.model.complete(
    requestFor({
      draft: job.draft,
      target: job.target,
      project,
      today,
      rewriter: job.rewriter,
      style: job.style,
      agents,
    }),
    { signal: job.signal },
  )

  // A stop that lands as the reply arrives still wins: the person asked for it.
  if (job.signal.aborted) return { kind: 'stopped', reason: stopReasonOf(job.signal) }
  if (!result.isAnswered) return { kind: 'failed', why: failureOf(result) }

  const reply = rewriteFrom(result.text)

  return reply === undefined
    ? { kind: 'failed', why: 'its reply held no prompt in the expected tags' }
    : { kind: 'rewritten', text: reply.prompt, summary: reply.summary }
}
