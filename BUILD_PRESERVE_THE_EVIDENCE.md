# Build: `preserve-the-evidence` Claude Code Plugin

## Goal

Build a Claude Code plugin that:

1. **Logs every session** as a markdown file in the project's `docs/claude-log/` folder (one file per session, refreshed on every turn).
2. **Provides a `/note` slash command** that logs a note to the transcript without executing any tools.
3. **Works cross-platform** (Windows, macOS, Linux) — Node.js only, no bash, no external dependencies.
4. **Is distributable as a Claude Code plugin** via the `/plugin` system.

---

## Project Structure

Create a new directory `preserve-the-evidence/` with this layout:

```
preserve-the-evidence/
├── .claude-plugin/
│   └── plugin.json
├── commands/
│   └── note.md
├── hooks/
│   └── hooks.json
├── scripts/
│   └── log-session.js
├── README.md
└── .gitignore
```

---

## File 1: `.claude-plugin/plugin.json`

```json
{
  "name": "preserve-the-evidence",
  "version": "0.1.0",
  "description": "Writes each Claude Code session as markdown to docs/claude-log/. Includes /note command for non-executing annotations.",
  "author": "Ed / Kinetic Seas"
}
```

---

## File 2: `hooks/hooks.json`

```json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/log-session.js\""
    }]
  }]
}
```

The quotes around `${CLAUDE_PLUGIN_ROOT}/...` are required so paths with spaces (common on Windows) work correctly.

---

## File 3: `scripts/log-session.js`

This is the core script. It:

- Reads the Stop hook JSON payload from stdin (`session_id`, `transcript_path`, `cwd`).
- Reads the session's JSONL transcript file.
- Renders user and assistant messages as markdown.
- Writes output to `<cwd>/docs/claude-log/<YYYY-MM-DD>_<first-8-chars-of-session-id>.md`.
- Overwrites the same file each turn so it stays current.

### Mode resolution (for tool-call verbosity)

The script supports three modes:

- `none` — only prompts and Claude's text responses, no tool calls shown.
- `summary` — adds one-line summaries for each tool call (e.g., `🔧 **Bash**: \`npm test\``).
- `full` — includes full tool inputs and results inside collapsible `<details>` blocks.

Mode is resolved in this order of precedence:

1. CLI argument (first arg passed to the script)
2. Environment variable `CLAUDE_LOG_MODE`
3. Contents of `<cwd>/.claude/log-mode` (a one-line file containing `none`, `summary`, or `full`)
4. Default: `summary`

### Implementation

```javascript
#!/usr/bin/env node
// Claude Code Stop hook: writes a markdown transcript of the session.
// Mode resolution: CLI arg > env CLAUDE_LOG_MODE > .claude/log-mode file > "summary"

const fs = require('fs');
const path = require('path');

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function resolveMode(cwd, cliArg) {
  if (cliArg && ['none', 'summary', 'full'].includes(cliArg)) return cliArg;
  if (process.env.CLAUDE_LOG_MODE) return process.env.CLAUDE_LOG_MODE.trim();
  try {
    const f = fs.readFileSync(path.join(cwd, '.claude', 'log-mode'), 'utf8').trim();
    if (['none', 'summary', 'full'].includes(f)) return f;
  } catch {}
  return 'summary';
}

function parseJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function summarizeToolUse(block) {
  const { name, input = {} } = block;
  if (name === 'Bash') return `🔧 **Bash**: \`${(input.command || '').slice(0, 120)}\``;
  if (input.file_path) return `🔧 **${name}**: ${input.file_path}`;
  if (input.path) return `🔧 **${name}**: ${input.path}`;
  if (input.pattern) return `🔧 **${name}**: \`${input.pattern}\``;
  if (input.url) return `🔧 **${name}**: ${input.url}`;
  return `🔧 **${name}**`;
}

function renderUser(entry, mode) {
  const c = entry.message?.content;
  if (typeof c === 'string') {
    return `## 🧑 User\n\n${c}\n`;
  }
  if (!Array.isArray(c)) return '';
  const parts = [];
  for (const block of c) {
    if (block.type === 'text' && block.text) {
      parts.push(`## 🧑 User\n\n${block.text}`);
    } else if (block.type === 'tool_result' && mode === 'full') {
      const text = typeof block.content === 'string'
        ? block.content
        : (Array.isArray(block.content) ? block.content.map(x => x.text || '').join('\n') : '');
      parts.push(
        `<details><summary>🔧 tool result</summary>\n\n\`\`\`\n${text.slice(0, 4000)}\n\`\`\`\n</details>`
      );
    }
  }
  return parts.join('\n\n') + (parts.length ? '\n' : '');
}

function renderAssistant(entry, mode) {
  const c = entry.message?.content;
  if (!Array.isArray(c)) return '';
  const parts = [];
  for (const block of c) {
    if (block.type === 'text' && block.text) {
      parts.push(`## 🤖 Claude\n\n${block.text}`);
    } else if (block.type === 'tool_use') {
      if (mode === 'none') continue;
      if (mode === 'summary') {
        parts.push(summarizeToolUse(block));
      } else if (mode === 'full') {
        parts.push(
          `<details><summary>🔧 ${block.name}</summary>\n\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n</details>`
        );
      }
    }
  }
  return parts.join('\n\n') + (parts.length ? '\n' : '');
}

function main() {
  const cliMode = process.argv[2];

  let hookInput;
  try {
    hookInput = JSON.parse(readStdin());
  } catch (e) {
    console.error('log-session: invalid stdin JSON');
    process.exit(0);
  }

  const { session_id, transcript_path, cwd } = hookInput;
  if (!session_id || !transcript_path || !cwd) process.exit(0);
  if (!fs.existsSync(transcript_path)) process.exit(0);

  const mode = resolveMode(cwd, cliMode);
  const entries = parseJsonl(transcript_path);

  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString();
  const shortId = session_id.slice(0, 8);

  const outDir = path.join(cwd, 'docs', 'claude-log');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${date}_${shortId}.md`);

  const lines = [`# Session ${shortId} — ${date} ${time}`, `_mode: ${mode}_`, ''];

  for (const entry of entries) {
    if (entry.type === 'user') {
      const rendered = renderUser(entry, mode);
      if (rendered.trim()) lines.push(rendered);
    } else if (entry.type === 'assistant') {
      const rendered = renderAssistant(entry, mode);
      if (rendered.trim()) lines.push(rendered);
    }
  }

  fs.writeFileSync(outFile, lines.join('\n'));
  process.exit(0);
}

main();
```

Hook scripts must **always exit 0** so they never block Claude Code — errors should be logged to stderr but not fail the session.

---

## File 4: `commands/note.md`

```markdown
---
description: Log a project note to the session transcript without executing anything
argument-hint: <text of the note>
---

The user is logging this note for the session record:

> $ARGUMENTS

Do NOT read files, run commands, or use any tools. Reply with only: `📝 Noted.`
```

Once installed, this command is invoked as `/preserve-the-evidence:note <text>`.

---

## File 5: `README.md`

Write a README covering:

- What the plugin does (per-session markdown logs, `/note` command)
- Installation:
  - Local testing: `claude --plugin-dir ./preserve-the-evidence`
  - Marketplace install: `/plugin marketplace add <user>/preserve-the-evidence` then `/plugin install preserve-the-evidence`
- Configuration:
  - How to set logging mode via `.claude/log-mode` file or `CLAUDE_LOG_MODE` env var
  - Three modes: `none`, `summary`, `full`
- Output format and location (`docs/claude-log/YYYY-MM-DD_<session-id>.md`)
- Using the `/note` command: `/preserve-the-evidence:note Next we are working on authentication.`
- Cross-platform support (Node.js built-ins only, no bash/jq dependencies)
- Suggested `.gitignore` tip if a user wants logs excluded, or commit instructions if they want them in the repo

---

## File 6: `.gitignore`

```
node_modules/
.DS_Store
*.log
```

---

## Build Steps

1. Create the directory structure above.
2. Write each file exactly as specified.
3. Verify `scripts/log-session.js` has no syntax errors: `node -c scripts/log-session.js`.
4. Initialize a git repo: `git init && git add . && git commit -m "Initial plugin"`.
5. Test locally from a separate project:
   ```
   cd ~/some-test-project
   claude --plugin-dir /path/to/preserve-the-evidence
   ```
6. Run a quick exchange in Claude Code and verify `docs/claude-log/` appears with a populated markdown file.
7. Test the `/preserve-the-evidence:note some note text` command — it should respond with `📝 Noted.` and appear in the log without triggering tool calls.
8. Test mode switching: create `.claude/log-mode` with `full` in the test project, run another turn, verify tool calls now appear as collapsible blocks.

---

## Acceptance Criteria

- [ ] Plugin installs cleanly with `--plugin-dir`
- [ ] `docs/claude-log/<date>_<short-id>.md` is created on first Stop event
- [ ] File is refreshed (overwritten) on each subsequent turn in the same session
- [ ] Each new session creates a new file (different short-id)
- [ ] `/preserve-the-evidence:note <text>` logs the note and replies only with `📝 Noted.`
- [ ] Mode defaults to `summary`; `.claude/log-mode` and `CLAUDE_LOG_MODE` both override it
- [ ] Works on Windows, macOS, and Linux without code changes
- [ ] Hook never blocks Claude Code even if the script errors

---

## Notes

- Do not add any npm dependencies. Node built-ins (`fs`, `path`) only.
- Do not use bash, jq, or any shell-specific features.
- Keep the plugin self-contained within the `preserve-the-evidence/` directory.
- `${CLAUDE_PLUGIN_ROOT}` is substituted by Claude Code at runtime — do not hardcode paths.
