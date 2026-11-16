# Security policy

## Supported versions

Only the latest release gets security fixes. Update with `claude plugin update prompt-wand@prompt-wand`, then restart Claude Code.

## How the mod handles your data

Sharpen prompt runs inside Claude Code as a mod. These are its protections, as the code implements them:

- **Nothing is sent until you press a button.** Typing only tells the band whether the box is empty.
- **One model call per press**, made through Claude Code's own model access on your account. The mod makes no other network calls and runs no commands.
- **It sends** your draft, the `CLAUDE.md`, `.claude/CLAUDE.md` and `AGENTS.md` files inside the project, the top-level file and folder names, the target model's name and today's date. **🧩 With subagents** also sends each available subagent's name, description and model, but not its instructions.
- **It does not send** instruction files above the project, such as your personal `~/.claude/CLAUDE.md`.
- **It never sends a prompt for you.** The rewrite goes into the prompt box or a preview pane, and you choose whether to send it. **Undo** restores your draft until you send.
- **It holds no keys.** It reads the environment variables `HOME` and `CLAUDE_CONFIG_DIR` only to find your agent folder.
- **The only file it writes** is its own small store in Claude Code's configuration folder, which keeps your Quick or Thorough choice.

## Risks to know about

- **Prompt injection.** The rewriter reads your project's instruction files and, for **🧩 With subagents**, your agents' descriptions. A malicious file in a project you do not trust could steer the rewritten prompt. Read the rewrite before you send it, most of all in a repository you did not write.
- **Cost.** Each press is a model call that counts towards your Claude usage.

## Report a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and click **Report a vulnerability**, or go straight to <https://github.com/CodeWithBehnam/prompt-wand/security/advisories/new>.

Please do not open a public issue for a security problem.

Include:

- the prompt-wand version (`claude plugin list`) and the Claude Code version (`claude --version`)
- the steps to reproduce, and what an attacker could do
- any proof of concept, with API keys, tokens and personal data removed
