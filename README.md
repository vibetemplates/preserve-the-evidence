# preserve-the-evidence

A Claude Code plugin that writes every session as a markdown file under `docs/claude-log/` in the project you're working in, and adds a `/note` slash command for logging annotations to the transcript without invoking any tools.

## What it does

- **Per-session markdown logs.** A `Stop` hook runs after every turn and writes `docs/claude-log/<YYYY-MM-DD>_<first-8-of-session-id>.md`. The same file is overwritten on each turn, so it always reflects the current state of the session. A new session gets a new file.
- **`/note` command.** Logs a note to the session transcript without executing any tools. Use it to leave a written mark for yourself in the log.
- **Cross-platform.** Pure Node.js using only built-ins (`fs`, `path`). No bash, no jq, no npm dependencies. Works on Windows, macOS, and Linux unchanged.

## Installation

### Install from this marketplace (recommended)

In Claude Code, run:

```
/plugin marketplace add vibetemplates/preserve-the-evidence
/plugin install preserve-the-evidence
```

That's it — the `Stop` hook and `/preserve-the-evidence:note` command become available immediately in the current project.

To uninstall or update later:

```
/plugin uninstall preserve-the-evidence
/plugin marketplace update vibetemplates/preserve-the-evidence
```

### Local development

If you're hacking on the plugin itself, clone the repo and point Claude Code at it directly:

```
git clone https://github.com/vibetemplates/preserve-the-evidence.git
claude --plugin-dir /path/to/preserve-the-evidence
```

## Configuration

The plugin supports three logging modes that control how tool calls appear in the log:

- `none` — Only user prompts and Claude's text responses. No tool calls at all.
- `summary` — Adds a one-line summary per tool call (e.g., `🔧 **Bash**: \`npm test\``). **Default.**
- `full` — Embeds full tool inputs (and tool results, for user entries) inside collapsible `<details>` blocks.

Mode is resolved in this order of precedence:

1. CLI argument passed to the script (first positional arg)
2. Environment variable `CLAUDE_LOG_MODE`
3. A file at `<project>/.claude/log-mode` containing one of `none`, `summary`, `full`
4. Default: `summary`

### Examples

Set mode via env var for a single session:

```
CLAUDE_LOG_MODE=full claude
```

Set mode persistently for a project by creating `.claude/log-mode`:

```
echo full > .claude/log-mode
```

## Output

Logs are written to `<project>/docs/claude-log/` with filenames like:

```
2026-04-20_a1b2c3d4.md
```

Each file begins with a header showing the short session id, date, time, and current mode, followed by rendered user and assistant messages in order.

## `/note` command

Once the plugin is installed, invoke:

```
/preserve-the-evidence:note Next we are working on authentication.
```

Claude will reply only with `📝 Noted.` — no files read, no commands run, no tools called. The note becomes part of the transcript and shows up in the next log write.

## Committing or ignoring logs

If you want the logs checked into the repo alongside the code they document, commit the `docs/claude-log/` directory as normal.

If you'd prefer to keep them local, add to your project's `.gitignore`:

```
docs/claude-log/
```

## Notes

- Hook scripts always exit 0 so they can never block Claude Code. Errors are written to stderr.
- `${CLAUDE_PLUGIN_ROOT}` in the hook command is substituted by Claude Code at runtime, so the plugin works from any install location, including paths with spaces.

## Author

Edward Honour ([@edhonour](https://github.com/edhonour))

## License

[MIT](LICENSE) — free to use, modify, and distribute.
