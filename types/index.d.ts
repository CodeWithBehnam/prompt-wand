/**
 * Why a finished rewrite waits for a press instead of going into the box.
 *
 * `edited`: the person changed the draft while the rewrite ran.
 * `dialog`: a dialog held the keys. `refused`: the box did not take it.
 * `long`: the rewrite is long, so the person checks it first.
 */
export type WandHoldReason = 'edited' | 'dialog' | 'refused' | 'long'

/** Which rewriter a press uses: the fast one or the careful one. */
export type WandMode = 'quick' | 'thorough'

/**
 * What the prompt box holds, as far as the band knows. `unknown` until the
 * surface reports an edit, so a surface that never does still shows the wand.
 */
export type DraftKind = 'unknown' | 'empty' | 'command' | 'text'

/**
 * Where the wand stands; the band above the prompt draws one row per phase.
 * `summary` is the rewriter's one line on what it changed, or `''`.
 */
export type WandPhase =
  | { kind: 'idle' }
  | { kind: 'working'; target: string; mode: WandMode; startedAt: number }
  | {
      kind: 'ready'
      target: string
      rewritten: string
      summary: string
      why: WandHoldReason
    }
  | { kind: 'applied'; target: string; original: string; summary: string }
  | { kind: 'failed'; why: string; canRetry: boolean }

declare module 'claude-code' {
  interface PluginState {
    'prompt-wand': {
      phase: Shaped<WandPhase>
      draft: DraftKind
      used: boolean
      mode: WandMode
    }
  }
}
