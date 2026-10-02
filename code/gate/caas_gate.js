#!/usr/bin/env node
/*
 * caas_gate.js - CAAS (Chat-Agent Auto Session) gate.
 *   A stdio MCP proxy that exposes only chosen Claude Code tools to the Claude desktop app chat.
 *
 * WHY (measured 2026-09, claude mcp serve v2.1.283)
 *   `claude mcp serve` ignores permissions.deny and runs its tools (Bash, PowerShell, Write, Edit, Agent, ...)
 *   without conditions. A chat connected to it can do anything on the PC.
 *
 * HOW
 *   Register this proxy in claude_desktop_config.json instead of `claude mcp serve`:
 *     "claude-code": { "command": "node", "args": ["/path/to/caas_gate.js"] }
 *   The proxy starts `claude mcp serve` as a child and relays JSON-RPC (one message per line):
 *   - tools/list -> only ALLOW tools are returned
 *   - tools/call -> tools not in ALLOW are answered with an error and never reach the child
 *   - Read       -> only inside the tray folder (secret / forbidden paths are also refused, as a second line)
 *   - Glob       -> only inside the tray folder, and the pattern must be a plain relative pattern
 *   - SendMessage -> only to sessions whose name matches CAAS_SEND_ALLOW_RE (refused when it is not set)
 *   Read / Glob paths are also checked at their real location (after following links / junctions).
 *   fail-closed: a call that cannot be judged is refused.
 *
 * IMPORTANT: Claude desktop rewrites claude_desktop_config.json from memory when it quits.
 *   Edit the config only while the app is fully quit, then start it.
 *
 * NOT covered: other MCP servers in the same desktop app (file system, screen control, ...), and whatever
 *   an agent session does when the chat asks it via SendMessage (that is up to the agent's own permissions).
 *
 * CONFIG (env): CAAS_CLAUDE_EXE (default "claude"), CAAS_TRAY_DIR (default <cwd>/chat_agent_tray), CAAS_GATE_RECORD,
 *   CAAS_SEND_ALLOW_RE (regex of session names the chat may message, e.g. ^caas_agent_\d+(-\d+)?$ ; not set = SendMessage refused)
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const CLAUDE_EXE = process.env.CAAS_CLAUDE_EXE ||
  'claude';
const TRAY = (process.env.CAAS_TRAY_DIR ||
  path.join(process.cwd(), 'chat_agent_tray')).toLowerCase().replace(/\//g, '\\');
const RECORD = process.env.CAAS_GATE_RECORD ||
  path.join(require('os').tmpdir(), 'caas_gate.jsonl');

const ALLOW = new Set(['ListAgents', 'SendMessage', 'Read', 'Glob']);

// SendMessage recipients: only session names matching this regex. Not set -> SendMessage is refused (fail-closed).
const SEND_ALLOW_RE = process.env.CAAS_SEND_ALLOW_RE ? new RegExp(process.env.CAAS_SEND_ALLOW_RE, 'i') : null;

// Secret / forbidden paths (add your own private folders here)
const FORBIDDEN = [
  /(^|[\\/])\.env($|[.\\/])/i, /credentials/i, /\.pem$/i, /\.key$/i, /\.token$/i,
  /(^|[\\/])secrets([\\/]|$)/i, /(^|[\\/])\.ssh([\\/]|$)/i, /(^|[\\/])\.aws([\\/]|$)/i,
  /\.credentials\.json$/i, /(^|[\\/])\.claude\.json$/i, /accounts\.json$/i,
];

function record(row) {
  try { fs.mkdirSync(path.dirname(RECORD), { recursive: true });
        fs.appendFileSync(RECORD, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, row)) + '\n', 'utf8'); }
  catch (e) { /* never stop relaying because logging failed */ }
}

function norm(p) { return path.resolve(String(p)).toLowerCase(); }

// real location after following links / junctions; null if the path does not exist
function real(p) {
  try { return fs.realpathSync.native(path.resolve(String(p))).toLowerCase().replace(/\//g, '\\'); }
  catch (e) { return null; }
}
const TRAY_REAL = real(TRAY) || TRAY;
function inTray(p) {
  const rp = norm(p);
  if (!(rp === TRAY || rp.startsWith(TRAY + '\\'))) return false;
  const re = real(p);   // an existing path is also checked at its real location (a link inside the tray cannot lead out)
  return re === null || re === TRAY_REAL || re.startsWith(TRAY_REAL + '\\');
}

// returns a reason string to deny, or null to allow
function judge(name, args) {
  if (!ALLOW.has(name)) return 'Tool "' + name + '" is closed by the CAAS gate (allowed: ' + [...ALLOW].join(', ') + ')';
  if (!args || typeof args !== 'object') return 'Arguments unreadable (fail-closed)';
  if (name === 'Read') {
    const p = args.file_path;
    if (typeof p !== 'string' || !p) return 'Read path unreadable (fail-closed)';
    if (FORBIDDEN.some((re) => re.test(p) || re.test(norm(p)))) return 'This path is secret/forbidden';
    // Read is allowed only inside the tray (CAAS only needs to read reply papers). FORBIDDEN stays as a second line.
    if (!inTray(p)) return 'Read is allowed only inside the tray folder';
  }
  if (name === 'Glob') {
    const base = typeof args.path === 'string' && args.path ? args.path : null;
    if (!base || !inTray(base)) return 'Glob is allowed only inside the tray folder; pass the tray full path as path';
    if (typeof args.pattern !== 'string' || !args.pattern) return 'Glob pattern unreadable (fail-closed)';
    if (/\.\./.test(args.pattern)) return '.. is not allowed in the Glob pattern';
    // An absolute pattern ignores `path` and searches outside the tray (measured 2026-09-28).
    // Absolute paths can also hide inside {a,b} or @(...), so symbols the chat does not need are refused.
    if (/^[\\/]/.test(args.pattern) || /[:~(){}|!@+\\]/.test(args.pattern)) return 'Only a plain relative Glob pattern is allowed (no drive letter, leading / or \\, ~ ( ) { } | ! @ +)';
  }
  if (name === 'SendMessage') {
    const to = typeof args.to === 'string' ? args.to.trim().replace(/\s*\[[^\]]*\]$/, '') : '';
    if (!to) return 'SendMessage recipient unreadable (fail-closed)';
    if (!SEND_ALLOW_RE) return 'SendMessage is refused: set CAAS_SEND_ALLOW_RE to the session names the chat may message';
    if (!SEND_ALLOW_RE.test(to)) return 'SendMessage is allowed only to sessions matching CAAS_SEND_ALLOW_RE';
  }
  return null;
}

// tests can require this file and call judge() without starting the relay
module.exports = { judge };
if (require.main !== module) return;

const env = Object.assign({}, process.env);
delete env.ANTHROPIC_API_KEY;   // keep the child on your subscription, not API billing
const child = cp.spawn(CLAUDE_EXE, ['mcp', 'serve'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'], shell: !process.env.CAAS_CLAUDE_EXE && process.platform === 'win32' });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
child.on('error', (e) => { record({ event: 'child spawn failed', error: String(e && e.message) }); process.exit(1); });

const pendingList = new Set();   // ids of tools/list requests
const send = (stream, obj) => stream.write(JSON.stringify(obj) + '\n');

function fromClient(msg) {
  if (msg && msg.method === 'tools/list' && msg.id != null) pendingList.add(msg.id);
  if (msg && msg.method === 'tools/call') {
    const p = msg.params || {};
    const why = judge(p.name, p.arguments);
    if (why) {
      record({ event: 'denied', tool: p.name, why: why,
               args: JSON.stringify(p.arguments || {}).slice(0, 300) });
      if (msg.id != null) send(process.stdout, { jsonrpc: '2.0', id: msg.id,
        result: { content: [{ type: 'text', text: '[CAAS gate] ' + why }], isError: true } });
      return;
    }
  }
  send(child.stdin, msg);
}

function fromServer(msg) {
  if (msg && msg.id != null && pendingList.has(msg.id)) {
    pendingList.delete(msg.id);
    if (msg.result && Array.isArray(msg.result.tools)) {
      msg.result.tools = msg.result.tools.filter((t) => t && ALLOW.has(t.name));
    }
  }
  send(process.stdout, msg);
}

function lineReader(stream, onMsg, onBad) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch (e) { onBad(line); continue; }
      if (Array.isArray(o)) o.forEach(onMsg); else onMsg(o);
    }
  });
}

// unreadable lines from the client are not forwarded (fail-closed)
lineReader(process.stdin, fromClient, (line) => record({ event: 'dropped unreadable line', from: 'client', head: line.slice(0, 120) }));
lineReader(child.stdout, fromServer, (line) => process.stdout.write(line + '\n'));
process.stdin.on('end', () => { try { child.stdin.end(); } catch (e) {} });
