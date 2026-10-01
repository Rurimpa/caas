#!/usr/bin/env node
/*
 * caas-reply-guard.js — Claude Code PreToolUse hook (matcher: SendMessage)
 *
 * WHY
 *   A request that comes from the chat (Claude desktop app -> `claude mcp serve` -> SendMessage)
 *   arrives in the agent session WITHOUT a sender name (no `from-name`, `from-mode="prompting"`).
 *   If the agent replies with SendMessage to the `from` pipe address (as the system hint suggests),
 *   the call returns success but NOTHING reaches the chat.
 *   CAAS replies are written to the tray folder instead, and the chat is woken by the bell.
 *
 * WHAT IT DOES
 *   When the agent is about to SendMessage to a pipe address (`...cc-msg-<hex>`), it looks in the
 *   session transcript for an inbound message from that same pipe which
 *     (1) has no `from-name`, and
 *     (2) carries the CAAS marker `[chat_agent_tray` in its body.
 *   If found, it denies the call ONCE and tells the agent to write the reply to the tray and ring the bell.
 *   Anything else passes through unchanged.
 *
 * SAFETY LINES
 *   - fail-open: any error or unreadable transcript -> the call is allowed (never blocks by accident)
 *   - once per pipe per session (state file)
 *   - no network, no AI calls
 *
 * NOTE (measured): messages that arrive while the agent is busy are NOT stored as `type:user`
 *   in the transcript. They appear as `type:queue-operation` (operation `enqueue`, field `content`)
 *   and `type:attachment` (attachment.type `queued_command`, field `attachment.prompt`).
 *   All three forms are checked.
 *
 * INSTALL (settings.json)
 *   "hooks": { "PreToolUse": [ { "matcher": "SendMessage",
 *     "hooks": [ { "type": "command", "command": "node /path/to/caas-reply-guard.js", "timeout": 20 } ] } ] }
 *
 * CONFIG (environment variables, optional)
 *   CAAS_STATE_DIR  where to keep the once-per-pipe state (default: <os tmpdir>/caas-reply-guard)
 *   CAAS_TRAY_DIR   the tray folder shown in the message (default: "<your tray folder>")
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = process.env.CAAS_STATE_DIR || path.join(os.tmpdir(), 'caas-reply-guard');
// Tray folder shown in the message: env first, then ~/.caas/config.json (written by the setup script)
function trayFromUserConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.caas', 'config.json'), 'utf8')).tray || null; } catch (e) { return null; }
}
const TRAY_DIR = process.env.CAAS_TRAY_DIR || trayFromUserConfig() || '<your tray folder>';
const MARKER = '[chat_agent_tray';
const TAIL_BYTES = 4 * 1024 * 1024;

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }
function writeJson(p, o) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o), 'utf8'); } catch (e) { /* fail-open */ }
}

function textsOf(o) {
  if (o.type === 'user' && o.message) {
    const c = o.message.content;
    if (typeof c === 'string') return [c];
    if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => String(x.text || ''));
    return [];
  }
  if (o.type === 'queue-operation' && o.operation === 'enqueue' && typeof o.content === 'string') return [o.content];
  if (o.type === 'attachment' && o.attachment && o.attachment.type === 'queued_command' &&
      typeof o.attachment.prompt === 'string') return [o.attachment.prompt];
  return [];
}

// Returns { dest } if the pipe sent a CAAS-marked, nameless message; otherwise null.
function findChatRequest(transcriptPath, pipeId) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    const st = fs.statSync(transcriptPath);
    const len = Math.min(st.size, TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(len);
    try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
    let hit = null;
    for (const line of buf.toString('utf8').split('\n')) {
      if (line.indexOf(pipeId) < 0 || line.indexOf('chat_agent_tray') < 0) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { continue; }
      for (const t of textsOf(o)) {
        const at = t.indexOf('<cross-session-message');
        if (at < 0) continue;
        const head = t.slice(at, at + 400);
        if (head.indexOf('cc-msg-' + pipeId) < 0) continue;
        if (/from-name="/.test(head.slice(0, head.indexOf('>') + 1))) continue; // named = another agent session
        if (t.indexOf(MARKER, at) < 0) continue;
        const m = /返し先=([^\]\s]+)|reply-to=([^\]\s]+)/.exec(t.slice(at));
        hit = { dest: m ? (m[1] || m[2]) : null };
      }
    }
    return hit;
  } catch (e) { return null; }
}

function main(input) {
  let d;
  try { d = JSON.parse(input); } catch (e) { return; }
  if (d.tool_name !== 'SendMessage') return;
  const sid = String(d.session_id || '');
  const to = String((d.tool_input && d.tool_input.to) || '').trim();
  const pipe = /cc-msg-([0-9a-f]{16,64})/.exec(to);
  if (!sid || !pipe) return;

  const hit = findChatRequest(d.transcript_path, pipe[1]);
  if (!hit) return;

  const statePath = path.join(STATE_DIR, sid + '.json');
  const state = readJson(statePath, { blocked: [] });
  if ((state.blocked || []).indexOf(pipe[1]) >= 0) return; // only once per pipe
  state.blocked = (state.blocked || []).concat([pipe[1]]);
  writeJson(statePath, state);

  const reason =
    '[CAAS] This address is the chat (Claude desktop app). SendMessage to it reports success but delivers nothing.\n' +
    'Reply on paper instead:\n' +
    '  1) Write the full reply to ' + (hit.dest || TRAY_DIR) + ' as <request-id>_reply_<nn>.md.tmp, then rename it to .md\n' +
    '     (first line: FROM <your session name> <request-id>, last line: END)\n' +
    '  2) After the rename, ring the bell: RemoteTrigger action=run with the bell trigger_id given in the request.\n' +
    'This notice is shown once per address.';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

let buf = '';
const timer = setTimeout(() => process.exit(0), 30000); // never hang the session
if (timer.unref) timer.unref();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => { try { main(buf); } catch (e) { /* fail-open */ } process.exit(0); });
