# Contributing to Sharpen prompt

Thanks for helping. This guide shows how to run the mod from a clone, check a change and send it.

By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Report a bug or suggest an idea

Use the issue forms: **Bug report** or **Feature request**. Remove API keys, tokens and private text before you paste anything.

For a security problem, follow [SECURITY.md](SECURITY.md). Do not open a public issue.

## Run it locally

You need Claude Code with mod support. The mod is tested with Claude Code 2.1.325.

```bash
git clone https://github.com/CodeWithBehnam/prompt-wand.git
claude --plugin-dir ./prompt-wand
```

If you also have the mod installed, disable the installed copy first, so only your clone loads:

```bash
claude plugin disable prompt-wand@prompt-wand
```

In an interactive session Claude Code watches the folder and reloads the mod when you save a file. It also writes the API types to `.claude-plugin/types/`, which git ignores.

## Check a change

Run both checks from the folder above the clone:

```bash
claude plugin validate ./prompt-wand
tsc -p ./prompt-wand
```

`tsc` is the TypeScript compiler, which you install yourself; the repository has no `package.json`. It needs the types that Claude Code writes when it loads the folder, so start a session with `--plugin-dir` once first.

The repository has no automated tests yet. Try your change in a live session, in the terminal or the Claude desktop app, and say where you tried it.

## Project rules

The pull request template asks you to confirm these:

- **No new dependencies.** The hooks module has no npm packages, DOM or Node APIs. Everything outside it goes through `$`.
- **Top-level functions.** Every function that takes `$` is a top-level `function` declaration, as `claude plugin validate` requires.
- **Editable models.** A new model is a setting in `.claude-plugin/plugin.json`, not a fixed value in the code.
- **Say what is sent.** If your change sends anything new to the rewriter, add it to "What it sends, and the cost" in the README.
- **State shape.** If you change `WandPhase` in `types/index.d.ts`, change the `shape` tag of the `phase` atom in `hooks/register.tsx` too.
- **Writing style.** Interface text and docs use British English, plain language and short sentences, with no em dashes.
- **No secrets.** Keep API keys, tokens and personal data out of the code, the docs and the pull request.
- **Version.** Leave the version number alone. The maintainer sets it at release.

## Send a pull request

1. Fork the repository and make a branch for your change.
2. Write commit messages in the Conventional Commits style, as the history does: `feat:`, `fix:`, `docs:` or `chore:`, then a short subject in the imperative mood.
3. Open a pull request and fill in the template: a summary, the output of both checks, and where you tried the change.
