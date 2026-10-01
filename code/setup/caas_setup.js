#!/usr/bin/env node
/*
 * caas_setup.js — installs CAAS (Chat–Agent Auto Session) on this PC
 *
 * Does steps 1 and 3 of QUICKSTART.md in one run, then checks the result.
 *   1. Folders        <root>/chat_agent_tray (with done/), <root>/records, <root>/tools
 *   2. Gate & guard   copies code/gate/caas_gate.js and code/hooks/caas-reply-guard.js UNCHANGED.
 *                     The gate reads its settings from env, written into the Claude Desktop config (step 4).
 *   3. Reply guard    adds the guard (PreToolUse on SendMessage) to <seat-dir>/.claude/settings.json
 *   4. Desktop config adds the "claude-code" entry (pointing at the gate, with env) to claude_desktop_config.json.
 *                     - Refuses to write the real config while Claude Desktop is running
 *                       (Claude Desktop writes the file back from memory when it quits).
 *                     - Saves a backup (<config>.backup_<time>.json) first. Other MCP servers are kept.
 *                     - Stops if a different "claude-code" entry is already there (use --replace to overwrite).
 *   5. Check          starts the installed gate once and checks two things:
 *                     (a) tools/list shows exactly four tools (ListAgents, SendMessage, Read, Glob)
 *                     (b) a SendMessage to a name outside --send-allow is refused by the gate
 *                     Prints "result": "installed" only when both pass.
 *
 * Usage:
 *   node caas_setup.js --root <folder> [--send-allow "<regex of session names>"] [--seat-dir <folder>]
 *                      [--config <claude_desktop_config.json>] [--claude-exe <claude.exe>] [--node <node.exe>]
 *                      [--gate-src <caas_gate.js>] [--guard-src <caas-reply-guard.js>]
 *                      [--dry-run] [--verify-only] [--replace]
 *
 *   --root        where the gate, the tray and the gate's record go
 *   --send-allow  which session names the chat may message (becomes CAAS_SEND_ALLOW_RE). Not set = the chat can message nobody.
 *   --seat-dir    the folder where you start the Claude Code session that receives requests (default: --root)
 *   --config      default: %APPDATA%\Claude\claude_desktop_config.json (the real config of this PC).
 *                 To try the script safely, pass a copy here.
 *   --gate-src / --guard-src  default: ../gate/caas_gate.js and ../hooks/caas-reply-guard.js, seen from this file
 *
 * Tested on one PC only (Windows 11, Node.js 24), with a temporary folder and a copy of the config.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const WANT_TOOLS = ['Glob', 'ListAgents', 'Read', 'SendMessage'];

function args() {
  const a = { dryRun: false, verifyOnly: false, replace: false };
  // `npx github:Rurimpa/caas#<tag> setup ...` passes the word "setup" first; skip plain words
  const v = process.argv.slice(2);
  if (v[0] === 'setup') v.shift();
  for (let i = 0; i < v.length; i++) {
    const k = v[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--verify-only') a.verifyOnly = true;
    else if (k === '--replace') a.replace = true;
    else if (k.startsWith('--')) a[k.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v[++i];
  }
  a.root = path.resolve(a.root || path.join(os.homedir(), 'caas'));
  // The chat may message sessions named agent_1, agent_2, ... unless told otherwise
  a.sendAllow = a.sendAllow === undefined ? '^agent_\\d+$' : a.sendAllow;
  a.userConfig = path.resolve(a.userConfig || path.join(os.homedir(), '.caas', 'config.json'));
  a.config = path.resolve(a.config || path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'));
  a.node = a.node || process.execPath;
  a.claudeExe = a.claudeExe || findClaude();
  a.gateSrc = path.resolve(a.gateSrc || path.join(__dirname, '..', 'gate', 'caas_gate.js'));
  a.guardSrc = path.resolve(a.guardSrc || path.join(__dirname, '..', 'hooks', 'caas-reply-guard.js'));
  for (const f of [a.gateSrc, a.guardSrc]) if (!fs.existsSync(f)) fail(`part not found (${f})`);
  if (a.sendAllow) { try { new RegExp(a.sendAllow); } catch (e) { fail(`--send-allow is not a valid regular expression (${a.sendAllow})`); } }
  // The Claude Code plugin already installs the reply guard for every session.
  // Only without the plugin, pass --seat-dir to add the guard to that folder's settings.
  a.seatDir = a.seatDir ? path.resolve(a.seatDir) : null;
  return a;
}
function fail(msg) { console.log(JSON.stringify({ result: 'stopped', reason: msg }, null, 1)); process.exit(1); }
const steps = [];
function step(name, detail) { steps.push({ step: name, ...detail }); }

function findClaude() {
  const cands = [path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')];
  try {
    const w = cp.execFileSync('where', ['claude.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    w.split(/\r?\n/).filter(Boolean).forEach(p => cands.push(p.trim()));
  } catch (e) { /* not found */ }
  // Skip Claude Desktop's own claude.exe; we need the Claude Code CLI
  const hit = cands.find(p => p && fs.existsSync(p) && !/WindowsApps|AnthropicClaude/i.test(p));
  if (!hit) fail('Claude Code claude.exe not found (pass it with --claude-exe)');
  return hit;
}

function writeFile(a, p, text) {
  if (a.dryRun) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

function placeParts(a) {
  const root = a.root;
  const tray = path.join(root, 'chat_agent_tray');
  for (const d of [tray, path.join(tray, 'done'), path.join(root, 'records'), path.join(root, 'tools')]) {
    if (!a.dryRun) fs.mkdirSync(d, { recursive: true });
  }
  step('folders', { root, tray });

  // Copied without changing a single character (settings are passed by env)
  writeFile(a, path.join(root, 'caas_gate.js'), fs.readFileSync(a.gateSrc, 'utf8'));
  writeFile(a, path.join(root, 'tools', 'caas-reply-guard.js'), fs.readFileSync(a.guardSrc, 'utf8'));
  step('gate and reply guard (copied unchanged)', { gate: path.join(root, 'caas_gate.js'), guard: path.join(root, 'tools', 'caas-reply-guard.js') });
}

function placeGuardHook(a) {
  const p = path.join(a.seatDir, '.claude', 'settings.json');
  let s = {};
  if (fs.existsSync(p)) { try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail(`${p} is not valid JSON`); } }
  const nodeExe = a.node.replace(/\\/g, '/');
  s.hooks = s.hooks || {};
  const file = 'caas-reply-guard.js';
  const guard = path.join(a.root, 'tools', file).replace(/\\/g, '/');
  const cmd = `"${nodeExe}" "${guard}"`;
  const list = s.hooks.PreToolUse = s.hooks.PreToolUse || [];
  const has = list.some(m => (m.hooks || []).some(h => String(h.command || '').includes(file)));
  if (!has) list.push({ matcher: 'SendMessage', hooks: [{ type: 'command', command: cmd, timeout: 20 }] });
  writeFile(a, p, JSON.stringify(s, null, 2) + '\n');
  step('reply guard hook', { file: p, note: 'applies only to Claude Code sessions started in --seat-dir' });
}

// One small file that the plugin's reply guard reads (where the tray is)
function writeUserConfig(a) {
  const c = { tray: path.join(a.root, 'chat_agent_tray'), root: a.root, send_allow: a.sendAllow };
  writeFile(a, a.userConfig, JSON.stringify(c, null, 2) + '\n');
  step('caas config', { file: a.userConfig, tray: c.tray, send_allow: c.send_allow });
}

function desktopRunning() {
  try {
    const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -match 'WindowsApps|AnthropicClaude' } | Measure-Object | Select-Object -ExpandProperty Count"],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return parseInt(out.trim(), 10) > 0;
  } catch (e) { return null; }   // unknown
}

function writeDesktopConfig(a) {
  const real = path.resolve(path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'));
  const isReal = a.config.toLowerCase() === real.toLowerCase();
  if (isReal) {
    const run = desktopRunning();
    const why = run ? 'Claude Desktop is running. Quit it completely (including the tray icon) before the real install — if it is running, it overwrites the config with the old content when it quits'
      : 'Could not tell whether Claude Desktop is running';
    // --dry-run writes nothing, so show the plan anyway and only warn
    if (run !== false && a.dryRun) step('warning', { message: why });
    else if (run !== false) fail(why + '. Stopping without writing');
  }
  let c = {};
  if (fs.existsSync(a.config)) {
    try { c = JSON.parse(fs.readFileSync(a.config, 'utf8')); } catch (e) { fail(`${a.config} is not valid JSON. Stopping without writing`); }
  }
  c.mcpServers = c.mcpServers || {};
  const entry = gateEntry(a);
  const cur = c.mcpServers['claude-code'];
  if (cur && JSON.stringify(cur) !== JSON.stringify(entry) && !a.replace && a.dryRun) {
    step('warning', { message: 'The config already has a different "claude-code" entry. The real install will stop unless you add --replace', current: cur });
  } else if (cur && JSON.stringify(cur) !== JSON.stringify(entry) && !a.replace) {
    fail(`the config already has a "claude-code" entry (${JSON.stringify(cur)}). Add --replace to overwrite it`);
  }
  c.mcpServers['claude-code'] = entry;
  let backup = null;
  if (!a.dryRun) {
    if (fs.existsSync(a.config)) {
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
      backup = a.config.replace(/\.json$/i, '') + `.backup_${ts}.json`;
      fs.copyFileSync(a.config, backup);
    }
    fs.mkdirSync(path.dirname(a.config), { recursive: true });
    fs.writeFileSync(a.config, JSON.stringify(c, null, 2) + '\n', 'utf8');
  }
  step('Claude Desktop config', { config: a.config, real_desktop_config: isReal, backup, other_servers_kept: Object.keys(c.mcpServers).filter(k => k !== 'claude-code') });
}

function gateEntry(a) {
  const e = { command: a.node, args: [path.join(a.root, 'caas_gate.js')] };
  e.env = { CAAS_TRAY_DIR: path.join(a.root, 'chat_agent_tray'), CAAS_CLAUDE_EXE: a.claudeExe,
    CAAS_GATE_RECORD: path.join(a.root, 'records', 'gate.jsonl') };
  if (a.sendAllow) e.env.CAAS_SEND_ALLOW_RE = a.sendAllow;
  return e;
}

function verify(a) {
  return new Promise(resolve => {
    const gatePath = path.join(a.root, 'caas_gate.js');
    if (!fs.existsSync(gatePath)) return resolve({ ok: false, why: 'the gate is not installed' });
    const e = gateEntry(a);
    const p = cp.spawn(a.node, [gatePath], { stdio: ['pipe', 'pipe', 'pipe'], env: Object.assign({}, process.env, e.env) });
    let tools = null;
    let buf = '', done = false;
    const finish = r => { if (done) return; done = true; try { p.kill(); } catch (e) { /* */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, why: 'no answer to tools/list within 60 seconds' }), 60000);
    p.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
        if (msg.id === 1) {
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        } else if (msg.id === 2) {
          tools = ((msg.result && msg.result.tools) || []).map(t => t.name).sort();
          // Send to a name outside --send-allow (a name that does not exist) and check that the gate refuses it
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call',
            params: { name: 'SendMessage', arguments: { to: 'caas_setup_check_nobody', message: 'x' } } }) + '\n');
        } else if (msg.id === 3) {
          clearTimeout(timer);
          const r = msg.result || {};
          const text = ((r.content || [])[0] || {}).text || '';
          const refused = r.isError === true && text.startsWith('[CAAS');
          finish({ ok: JSON.stringify(tools) === JSON.stringify(WANT_TOOLS) && refused, tools, send_to_wrong_name_refused: refused, gate_said: text.slice(0, 120) });
        }
      }
    });
    p.on('exit', code => finish({ ok: false, why: `the gate exited (exit ${code})` }));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'caas_setup', version: '1' } } }) + '\n');
  });
}

(async () => {
  const a = args();
  if (!fs.existsSync(a.node)) fail(`node not found (${a.node})`);
  step('found', { node: a.node, claude_exe: a.claudeExe, config: a.config });
  if (!a.verifyOnly) {
    placeParts(a);
    if (a.seatDir) placeGuardHook(a);
    writeUserConfig(a);
    writeDesktopConfig(a);
  }
  const v = a.dryRun ? { ok: null, why: '--dry-run: the gate was not started' } : await verify(a);
  step('check', v);
  const ok = a.dryRun || v.ok;
  console.log(JSON.stringify({ result: a.dryRun ? 'dry-run' : (ok ? 'installed' : 'check_failed'), steps,
    next: ok && !a.dryRun ? [
      'Start Claude Desktop again.',
      'Start the session that does the work:  claude --name agent_1',
      'In your Claude.ai chat (with the CAAS chat skill added), say:  "My CAAS tray is ' + path.join(a.root, 'chat_agent_tray') + '. Set up CAAS."',
    ] : (a.dryRun ? 'Nothing was written. Run again without --dry-run to install.' : undefined) }, null, 1));
  process.exit(ok ? 0 : 1);
})();
