#!/usr/bin/env node
// Claude Code Stop hook: writes a markdown transcript of the session.
// Mode resolution: CLI arg > env CLAUDE_LOG_MODE > .claude/log-mode file > "both"
// In "both" mode, two files are written per session: a summary and a full audit.

const fs = require('fs');
const path = require('path');

const VALID_MODES = ['none', 'summary', 'full', 'both'];

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function resolveMode(cwd, cliArg) {
  if (cliArg && VALID_MODES.includes(cliArg)) return cliArg;
  const env = process.env.CLAUDE_LOG_MODE && process.env.CLAUDE_LOG_MODE.trim();
  if (env && VALID_MODES.includes(env)) return env;
  try {
    const f = fs.readFileSync(path.join(cwd, '.claude', 'log-mode'), 'utf8').trim();
    if (VALID_MODES.includes(f)) return f;
  } catch {}
  return 'both';
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

function renderDocument(entries, mode, shortId, date, time) {
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
  return lines.join('\n');
}

function safeWrite(filePath, contents) {
  try {
    fs.writeFileSync(filePath, contents);
  } catch (e) {
    console.error(`log-session: failed to write ${filePath}: ${e.message}`);
  }
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
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    console.error(`log-session: failed to create ${outDir}: ${e.message}`);
    process.exit(0);
  }

  const baseName = `${date}_${shortId}`;

  if (mode === 'both') {
    safeWrite(
      path.join(outDir, `${baseName}.md`),
      renderDocument(entries, 'summary', shortId, date, time)
    );
    safeWrite(
      path.join(outDir, `${baseName}.full.md`),
      renderDocument(entries, 'full', shortId, date, time)
    );
  } else {
    safeWrite(
      path.join(outDir, `${baseName}.md`),
      renderDocument(entries, mode, shortId, date, time)
    );
  }

  process.exit(0);
}

main();
