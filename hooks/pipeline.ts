// The pure parts of one rewrite: the project context from what the session
// read, and the outcome from the model's reply. No `$` here: the plugin
// directory follows `$` only into functions declared in register.tsx, so every
// call on `$` lives there.

import type { ModelCompleteResult } from 'claude-code'

import type { WandStyle } from '../types'
import type { AgentEntry } from './agents'
import type { TargetModel } from './profiles'
import { rewriteFrom } from './rewrite'
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

/** An instruction file as the session found it, above or inside the project. */
export type FoundFile = { readonly dir: string; readonly name: string; readonly content: string }

/** A top-level entry of the project folder. */
export type ListedEntry = { readonly name: string; readonly kind: string }

export const INSTRUCTION_NAMES = ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md']
// Folders and files that say nothing about the project's layout.
const SKIPPED = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.DS_Store'])

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isInside = (dir: string, root: string): boolean =>
  dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`)

/** The project's instruction files and top-level names, from what the session read. */
export const projectFrom = (
  root: string,
  found: readonly FoundFile[],
  listed: readonly ListedEntry[],
): ProjectContext => ({
  root,
  entries: listed
    .filter(entry => !SKIPPED.has(entry.name))
    .map(entry => (entry.kind === 'dir' ? `${entry.name}/` : entry.name))
    .sort(),
  // Files above the project are the person's own, not the project's.
  instructions: found
    .filter(file => isInside(file.dir, root))
    .map(file => ({ path: `${file.dir}/${file.name}`, content: file.content })),
})

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

/** What one model reply means for the draft. */
export const outcomeOf = (result: ModelCompleteResult, signal: AbortSignal): Rewrite => {
  // A stop that lands as the reply arrives still wins: the person asked for it.
  if (signal.aborted) return { kind: 'stopped', reason: stopReasonOf(signal) }
  if (!result.isAnswered) return { kind: 'failed', why: failureOf(result) }

  const reply = rewriteFrom(result.text)

  return reply === undefined
    ? { kind: 'failed', why: 'its reply held no prompt in the expected tags' }
    : { kind: 'rewritten', text: reply.prompt, summary: reply.summary }
}
