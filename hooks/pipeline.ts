// The rewrite as one call on `$`: gather the project context, ask the
// rewriter, and read its reply. The pure parts are in rewrite.ts.

import type { EngineInterface, ModelCompleteResult } from 'claude-code'

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
  const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const result = await $.model.complete(
    requestFor({ draft: job.draft, target: job.target, project, today, rewriter: job.rewriter }),
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
