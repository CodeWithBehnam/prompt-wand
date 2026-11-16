# Privacy policy

This policy covers prompt-wand (Sharpen prompt), an open-source mod for Claude Code. It takes effect on 16 November 2026 and describes version 0.2.2.

prompt-wand runs on your own computer, inside Claude Code. It has no server, no account and no analytics. Its author receives none of your data.

## What it reads

- **While you type:** it checks the prompt box only to tell whether it is empty or holds a command, so the band above the box can hide. It keeps only that result, not your text.
- **During a session:** it notes the name, description and source of each subagent type that Claude Code offers the model, in memory.
- **When you press a button:**
  - your draft in the prompt box
  - the `CLAUDE.md`, `.claude/CLAUDE.md` and `AGENTS.md` files from the project folder upwards (it uses only the ones inside the project)
  - the names of the files and folders at the project's top level
- **When you press 🧩 With subagents, also:** the agent definition files in the project's `.claude/agents` folder and in your `~/.claude/agents` folder, and the `HOME` and `CLAUDE_CONFIG_DIR` environment variables, to find that folder.

These hold personal data only if you wrote some into them. The mod does not look for personal data.

## What it sends, and to whom

Each button press makes one model call through Claude Code's own model access, on your existing Claude account, to Anthropic. The call carries:

- your draft, up to 40,000 characters
- the `CLAUDE.md`, `.claude/CLAUDE.md` and `AGENTS.md` files inside the project, cut to 24,000 characters in all
- the project's full path and the names of the first 150 files and folders at its top level
- the name of the target model and today's date
- for **🧩 With subagents** only: for up to 40 subagents, the name, where it is defined, its model and the first 300 characters of its description, but not its instructions

Instruction files above the project, such as your personal `~/.claude/CLAUDE.md`, are never sent. The mod makes no other network calls, has no MCP servers and sends nothing to anyone else. Anthropic handles the model call under your account's terms and its privacy policy: <https://www.anthropic.com/legal/privacy>.

## What it keeps, and for how long

- **For the session:** your draft and the rewrite, in Claude Code's session state, so **Undo** can bring your draft back. They are cleared when you send a prompt or press **Discard** or **Undo**.
- **Until you remove the mod:** one setting, your Quick or Thorough choice, in the mod's own store in Claude Code's configuration folder.

It keeps nothing else.

## What it never does

- It never sends a prompt for you. The rewrite goes into the prompt box or a preview pane, and you decide whether to send it.
- It runs no commands and edits no files in your project.
- It never asks for, stores or reads API keys or passwords.

## Children

prompt-wand is a developer tool for people who use Claude Code. It is not meant for people under 18.

## Changes

Any change to this policy is made in this file, and its history is on GitHub. A change to what the mod reads or sends also updates the README section "What it sends, and the cost".

## Contact

Ask a question or report a problem through the issues page: <https://github.com/CodeWithBehnam/prompt-wand/issues>. Report a security problem privately, as [SECURITY.md](SECURITY.md) explains.
