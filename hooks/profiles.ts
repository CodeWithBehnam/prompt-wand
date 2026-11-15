// Which Claude model the session runs, and what its prompting guide says to
// do differently. Pure: no `$`, no I/O.

export type ModelFamily = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

export type TargetModel = {
  readonly family: ModelFamily
  /** How a person reads it, such as "Claude Opus 5.5". */
  readonly label: string
  /** What `$.session.model()` answered, passed on to the rewriter as is. */
  readonly reported: string
}

const NAMES = {
  fable: 'Fable',
  mythos: 'Mythos',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
} as const

type NameKey = keyof typeof NAMES

// The minor version is one or two digits not followed by another, so a date
// suffix such as "-20260101" is never read as one.
const MODEL = /(fable|mythos|opus|sonnet|haiku)(?:[\s_-]*(\d{1,2})(?:[.\s_-](\d{1,2})(?!\d))?)?/i

const isNameKey = (word: string): word is NameKey => word in NAMES

/** Reads the family and version out of an id, an alias or a display name. */
export const targetFor = (reported: string): TargetModel => {
  const found = MODEL.exec(reported)
  const word = found?.[1]?.toLowerCase()

  if (found === null || word === undefined || !isNameKey(word)) {
    const label = reported.trim() === '' ? 'the selected model' : reported.trim()
    return { family: 'other', label, reported }
  }

  const version = [found[2], found[3]].filter(part => part !== undefined).join('.')
  const label = `Claude ${NAMES[word]}${version === '' ? '' : ` ${version}`}`
  // Mythos 5.2 shares the Fable 5.2 guide.
  const family: ModelFamily = word === 'mythos' ? 'fable' : word

  return { family, label, reported }
}

const FABLE = `- It follows instructions closely and literally, and treats "never" and "always" as absolute. Give each rule its scope and its reason. Leave out hard style limits such as a word count per sentence: they make its writing choppy.
- Code ownership changes how it works. If the developer wants the structure improved (refactor, consolidate, clean up), say that the model owns this code and that its design is up to the model. If the developer wants a focused change, or does not say, say that the developer owns the code and wants the smallest change that solves the task. Never put both in one prompt: a scope rule does not cancel an ownership sentence.
- On tasks with several parts it can end its turn early: it lists what is left, offers to continue, or stops at an ordinary error. List every part of the task, say what finished looks like, and tell it to carry on with work that does not depend on the developer's answer. Ordinary obstacles (errors, timeouts, failing commands) are to be diagnosed and worked through. It stops only when it cannot go on without the developer, or before a risky step.
- When approvals matter, name the exact actions that need a yes. Broad categories make it hold back routine work.
- Do not ask it to use subagents unless the task splits into independent parts that can run in parallel.
- If the developer wants a report at the end, ask for one that a reader who has not seen the work can follow: the key points first, plain words, no terms made up during the work.
- Instructions to think less, or to answer without deliberating, have no effect on it. Leave them out.`

const OPUS = `- It is strong at work with many steps in a real repository, and it gets to work quickly. When the task is loosely specified, tell it to look through the relevant files or sources first (name them where the draft or the project context makes them clear) before it changes anything.
- It responds well to concrete lists of patterns to avoid. A vague wish such as "make it look less generic" only swaps one default for another, so turn vague quality wishes in the draft into specific points that can be checked.
- State the completion condition up front. For a long task, ask it to keep a checklist of the parts and to continue until every part is done, stopping early only for a blocker that needs the developer.
- If the developer wants updates while it works, say when: a line before it starts and a short recap at the end.
- If the draft says speed matters, say so plainly: the earlier a correct result arrives, the better.`

const SONNET = `- How far it goes depends on the request. On an open-ended request it can start building when the developer only wanted ideas. If the draft asks for ideas, options or a plan, tell it to deliver that and stop, and not to build or change anything until the developer says to go ahead.
- It tends to add tests, documentation and small supporting files that nobody asked for. If the draft wants a focused change, tell it: when the requested work is done and checked, stop and report, and mention extra ideas at the end instead of doing them.
- It sometimes stops to check in before the work is done. Tell it to keep working until everything asked for is done, and to stop only when it cannot go on without the developer, or before a risky step.
- For code changes, ask it to run a real check that exercises the change before it reports done (the project's tests, type checker or build, or the changed command), and to say which check it could not run, and why, if none can run.
- For details that may have changed since its training (versions, prices, rules, API behaviour), ask it to check current sources or documentation instead of answering from memory.
- If the task asks for JSON that needs a few steps of working out, add this sentence: "Think the problem through before you answer."`

const HAIKU = `- Under a long agent system prompt, such as the coding agent's, it sometimes stops early and hands the task back. Tell it to keep working until everything asked for is done, and to stop to ask only when it cannot go on without the developer, or before a risky step. When the work is done and checked, it stops and reports, without adding features, docs or refactors that nobody asked for. Ideas for those go at the end of the report.
- For code changes, ask it to run a real check that exercises the change before it reports done (the tests that cover it, the type checker, the build, or the changed command), and, if no real check can run, to say which one it did not run and why.
- If the answer depends on facts that may have changed since its training (versions, prices, rules, anything "latest"), give today's date from <today> and ask it to check current sources first, even when it feels sure. Facts that cannot change need no search, so do not add a blanket instruction to search.`

const OTHER = `- The model is not one of the Claude families these notes cover. Apply the general rules only, and keep the prompt plain and explicit.`

/** The family's notes from its prompting guide, as lines the rewriter reads. */
export const notesFor = (family: ModelFamily): string => {
  switch (family) {
    case 'fable':
      return FABLE
    case 'opus':
      return OPUS
    case 'sonnet':
      return SONNET
    case 'haiku':
      return HAIKU
    case 'other':
      return OTHER
  }
}
