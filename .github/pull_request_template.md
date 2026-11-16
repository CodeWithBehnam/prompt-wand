## Summary

<!-- What does this change, and why? Link the issue if there is one. -->

## How I checked it

<!-- Paste the last lines of each check. -->

- [ ] `claude plugin validate .` passes
- [ ] `tsc -p .` passes (load the folder once with `claude --plugin-dir .` so Claude Code writes the types)
- [ ] I tried the change in a live session. Where: <!-- terminal, desktop app -->

```
<!-- validate and tsc output -->
```

## Project rules

- [ ] No new dependencies. The hooks module has no npm packages, DOM or Node APIs: everything outside it goes through `$`.
- [ ] Every function that takes `$` is a top-level `function` declaration, as `claude plugin validate` requires.
- [ ] Model IDs stay editable: a new model is a setting in `.claude-plugin/plugin.json`, not a fixed value in the code.
- [ ] If the change sends anything new to the rewriter, the README's "What it sends, and the cost" lists it.
- [ ] If the change alters `WandPhase` in `types/index.d.ts`, the `shape` tag of the `phase` atom in `hooks/register.tsx` is changed too.
- [ ] Interface text and docs use British English and plain language, with no em dashes.
- [ ] No API keys, tokens or personal data in the code, the docs or this pull request.
- [ ] I did not change the version number. The maintainer sets it at release.
