#!/usr/bin/env node
/*
 * start.js - starts the CAAS gate inside the Claude Desktop extension (.mcpb).
 *
 * The gate (caas_gate.js, copied here unchanged at build time) reads its settings from env.
 * This file only fills in what the person did not set, then runs the gate in this same process:
 *   - CAAS_TRAY_DIR      : <home>\caas\chat_agent_tray (created if missing, with done\)
 *   - CAAS_GATE_RECORD   : <home>\caas\gate_record.jsonl
 *   - CAAS_CLAUDE_EXE    : found like the setup script does (Claude Desktop's own claude.exe is skipped);
 *                          if nothing is found it stays unset and the gate runs "claude" from PATH
 *   - CAAS_SEND_ALLOW_RE : ^caas_agent_\d+(-\d+)?$
 * A value that is empty or still holds an unreplaced ${...} is treated as not set.
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = os.homedir();
const isSet = (v) => typeof v === 'string' && v.trim() !== '' && !v.includes('${');
function pick(name, fallback) {
  if (!isSet(process.env[name])) {
    if (fallback == null) delete process.env[name];
    else process.env[name] = fallback;
  }
  return process.env[name];
}

function findClaude() {
  const cands = [];
  if (isSet(process.env.CAAS_CLAUDE_EXE)) cands.push(process.env.CAAS_CLAUDE_EXE);
  if (process.platform === 'win32') {
    cands.push(path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
    cands.push(path.join(home, '.local', 'bin', 'claude.exe'));
    try {
      const w = cp.execFileSync('where', ['claude.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      w.split(/\r?\n/).filter(Boolean).forEach((p) => cands.push(p.trim()));
    } catch (e) { /* not found */ }
  }
  // Skip Claude Desktop's own claude.exe; the gate needs the Claude Code CLI
  return cands.find((p) => p && fs.existsSync(p) && !/WindowsApps|AnthropicClaude/i.test(p)) || null;
}

const given = {};
['CAAS_TRAY_DIR', 'CAAS_GATE_RECORD', 'CAAS_SEND_ALLOW_RE', 'CAAS_CLAUDE_EXE'].forEach((k) => { given[k] = process.env[k] === undefined ? null : process.env[k]; });
const tray = pick('CAAS_TRAY_DIR', path.join(home, 'caas', 'chat_agent_tray'));
try { fs.mkdirSync(path.join(tray, 'done'), { recursive: true }); } catch (e) { /* the gate still runs; Glob finds nothing */ }
pick('CAAS_GATE_RECORD', path.join(home, 'caas', 'gate_record.jsonl'));
pick('CAAS_SEND_ALLOW_RE', '^caas_agent_\\d+(-\\d+)?$');
const claudeExe = findClaude();
process.env.CAAS_CLAUDE_EXE = '';
pick('CAAS_CLAUDE_EXE', claudeExe);

// One line at start: what the app passed, and what the gate will use (helps when a setting seems ignored).
try {
  const used = {};
  Object.keys(given).forEach((k) => { used[k] = process.env[k] === undefined ? null : process.env[k]; });
  fs.mkdirSync(path.dirname(process.env.CAAS_GATE_RECORD), { recursive: true });
  fs.appendFileSync(process.env.CAAS_GATE_RECORD, JSON.stringify({ ts: new Date().toISOString(), event: 'started', given, used }) + '\n', 'utf8');
} catch (e) { /* never stop because logging failed */ }

// Run the gate as the main module of this process (it relays only when it is the main module).
const gate = path.join(__dirname, 'caas_gate.js');
process.argv[1] = gate;
require('module').runMain(gate);
