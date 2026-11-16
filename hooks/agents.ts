// The subagent types a session can use, as the rewriter is told them. Pure:
// no `$`, no I/O. pipeline.ts gathers the inputs.

export type AgentEntry = {
  readonly name: string
  readonly description: string
  /** Where it was defined: `built-in`, `plugin`, `project`, `user` and so on. */
  readonly source: string
  /** The model its definition sets; undefined where it sets none or `inherit`. */
  readonly model: string | undefined
}

/** Where the list came from, which the rewriter is told. */
export type AgentCatalogue = {
  readonly entries: readonly AgentEntry[]
  /** True when the session listed its agents; false when only files were read. */
  readonly isListed: boolean
}

const MAX_AGENTS = 40
const MAX_DESCRIPTION_CHARS = 300

/** One frontmatter field's value, such as `name` or `model`. */
const field = (frontmatter: string, fieldName: string): string | undefined => {
  const match = new RegExp(`^${fieldName}:[ \\t]*(.*)$`, 'm').exec(frontmatter)
  const value = match?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2').trim()
  return value === undefined || value === '' ? undefined : value
}

/** An agent file's name, description and model, or undefined without a name. */
export const agentFromFile = (text: string, source: string): AgentEntry | undefined => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null || match[1] === undefined) return undefined

  const frontmatter = match[1]
  const name = field(frontmatter, 'name')
  if (name === undefined) return undefined

  const model = field(frontmatter, 'model')

  return {
    name,
    description: field(frontmatter, 'description') ?? '',
    source,
    model: model === undefined || model === 'inherit' ? undefined : model,
  }
}

/**
 * The session's offered agents with the models their files set. With no offer
 * seen yet (a session's first turn), the files alone and the built-in
 * general-purpose agent, which every session has.
 */
export const catalogueOf = (
  offered: readonly AgentEntry[],
  fromFiles: readonly AgentEntry[],
): AgentCatalogue => {
  const modelOf = new Map(fromFiles.map(agent => [agent.name, agent.model]))

  if (offered.length > 0) {
    return {
      entries: offered.map(agent => ({ ...agent, model: agent.model ?? modelOf.get(agent.name) })),
      isListed: true,
    }
  }

  const hasGeneral = fromFiles.some(agent => agent.name === 'general-purpose')
  const general: AgentEntry = {
    name: 'general-purpose',
    description: 'General-purpose agent for research, code search and multi-step tasks.',
    source: 'built-in',
    model: undefined,
  }

  return { entries: hasGeneral ? fromFiles : [...fromFiles, general], isListed: false }
}

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= MAX_DESCRIPTION_CHARS ? line : `${line.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
}

/** The `<available_subagents>` block for the rewriter. */
export const agentsBlock = (catalogue: AgentCatalogue): string => {
  const shown = catalogue.entries.slice(0, MAX_AGENTS)
  const hidden = catalogue.entries.length - shown.length
  const lines = shown.map(agent => {
    const model = agent.model === undefined ? 'no model set' : `model: ${agent.model}`
    return `- ${agent.name} (${agent.source}; ${model}): ${clip(agent.description)}`
  })
  const from = catalogue.isListed
    ? 'the session listed these agent types'
    : 'read from agent files; the session had not listed its agents yet, so plugin agents may be missing'

  return [
    `<available_subagents from="${from}">`,
    ...lines,
    ...(hidden > 0 ? [`[${hidden} more not shown]`] : []),
    '</available_subagents>',
  ].join('\n')
}
