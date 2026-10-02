# CAAS — Chat–Agent Auto Session

> ⚠️ **Use CAAS only with the gate (`code/gate/caas_gate.js`) in place.** Without it, anyone who can talk to the chat can run any command on the PC. See [Safety](#safety).

**CAAS lets a person talk only to their everyday Claude.ai conversation, while Claude Code sessions that are already running on the same PC do the work, and the results come back to the same conversation without any further human input.**

Technical note (DOI): [10.5281/zenodo.23005933](https://doi.org/10.5281/zenodo.23005933) · Author: がけっぷちのふくしゃちょう / The Cliff-Edge Fukushacho

日本語＝[README.md](README.md) · Detailed setup＝[QUICKSTART.md](QUICKSTART.md)

## Run it in 5 minutes: 3 steps (checked on Windows)

You need: a Windows PC, Claude Desktop, Claude Code and Node.js.

**1. Install the gate** (in Claude Desktop)

Download [`caas-gate.mcpb`](https://github.com/Rurimpa/caas/releases/latest/download/caas-gate.mcpb), then in Claude Desktop open Settings → Extensions → Advanced settings → Install Extension…, choose the file and press Install (on some PCs double-clicking the file opens Claude Desktop; on ours Windows asked which app to use). Right after installing, Claude Desktop may show "cannot connect to the extension server" in red even though the chat can already use the gate (checked on Windows, 2026-10-02). **After changing a setting (tray folder, sessions the chat may message), quit Claude Desktop from the system tray and start it again** (turning the extension off and on was not enough: calls from the chat still used the old setting). At every start the gate writes one line with the settings it received and the ones it uses to `C:\Users\<you>\caas\gate_record.jsonl`. The gate is installed as a Claude Desktop extension. The default settings work as they are (tray = `C:\Users\<you>\caas\chat_agent_tray`, sessions the chat may message = `CAAS_agent_1`, `CAAS_agent_2`, ...).

(Without the extension, by hand: `npx github:Rurimpa/caas#v1.2.0 setup`. See QUICKSTART.md.)

**2. Prepare the session that does the work** (in Claude Code)

```
/plugin marketplace add Rurimpa/caas
/plugin install caas@caas
```

Then start the session in the folder where it should work: `claude --name CAAS_agent_1`

**3. Add the chat skill and talk** (in Claude.ai)

1. Upload [`chat-skill/caas-chat.zip`](chat-skill/caas-chat.zip) in Claude.ai under Settings → Capabilities → Skills.
2. In a new chat, send any message, then choose **Link to this computer** from the PC icon next to the conversation title (once per conversation; this is the one manual step).
3. Send "Set up CAAS". The chat checks everything and creates its bell (if you changed the tray folder, send its path too).

From then on, just say "ask CAAS_agent_1 to …".

---

## What is new

Parts of this already exist in public: sending from a chat to a running Claude Code session, and waking a bound session with a scheduled trigger. But every public bridge we found needs a human action on the chat side before the loop closes (typing `get`, asking "how is it going?", or waiting inside a single human-initiated turn).

CAAS closes the loop without a human:

| | CAAS | Dispatch (official) | cc-tap / mcp-relay / herald |
|---|---|---|---|
| Human talks to | their **everyday** Claude.ai conversation | a dedicated Dispatch conversation | everyday conversation |
| Work goes to | Claude Code sessions **already running** | newly spawned sessions | running sessions (herald: new) |
| Result returns without a human | **yes** | inside Dispatch only | no |

Why "everyday" and "already running" matter: the everyday conversation is where the person thinks (history, memory, projects); the running sessions carry accumulated context. Consolidating the human's window means driving *those*, not a separate front desk with temporary workers.

## How it works

```
[everyday chat] --(1) MCP message--> [gate] --> [running Claude Code session]
       ^                                                   |
       |                                          (2) write result to a file
       |                                          (3) run the bound trigger
       +------(4) the bound chat wakes, reads the file, continues------+
```

1. **Outbound.** Claude Desktop exposes the local Claude Code MCP server to the chat — through the gate (`code/gate/caas_gate.js`), which starts `claude mcp serve` as its child. The chat sends a message to a running session with its cross-session messaging tool. The first line carries a marker: `[<tray> <request-id> reply-to=<tray folder> bell=<trigger id>]` and "do not reply by message". See `code/chat/CHAT_SIDE_PROCEDURE.md` for the chat side, `code/seat/AGENT_SIDE_PROCEDURE.md` for the session side, and `code/hooks/caas-reply-guard.js` for a hook that stops a session from replying to the chat by message (which silently fails).
2. **Return — deliver.** The session writes `<request-id>_<kind>_<n>.md.tmp` into the tray folder and renames it to `.md` in the same folder (atomic on the same drive). `kind` is `reply`, `progress` or `question`. First line `FROM <session name> [<session id>] <request-id>`, last line `END`.
3. **Return — wake.** Only after the rename, the session runs a one-shot scheduled trigger (Claude Code `RemoteTrigger`, `action=run`). The trigger was **created by the human in the chat** and is bound to that conversation.
4. The chat wakes, finds the file with `Glob` inside the tray, reads only files that have both the `FROM` line and `END`, and continues. Finished files are moved to `done/` by the session (never deleted).

Rules: the session only *runs* the trigger — it never creates, edits, enables or disables it. Running a one-shot trigger did not consume it in our tests, so one trigger can be reused. A trigger wakes only the conversation it was created in.

## The gate

`code/gate/caas_gate.js` is a small stdio MCP proxy (Node.js, no AI inside). Claude Desktop starts it instead of `claude mcp serve`; it starts `claude mcp serve` as a child and relays JSON-RPC line by line.

- **Only four tools pass:** `ListAgents`, `SendMessage`, `Read`, `Glob`. Others are removed from `tools/list`, and a `tools/call` for any other tool is answered with an error and never reaches the child.
- **`Read` and `Glob` work only inside the tray folder** (`CAAS_TRAY_DIR`). The chat can find and read the sessions' reply files, and nothing else on the PC. Secret patterns (`.env`, credentials, keys, tokens, …) are refused even inside the tray. Paths are also checked at their real location, so a link or junction inside the tray cannot lead outside. The `Glob` pattern must be a plain relative pattern (no drive letter, leading `/` or `\`, `~ ( ) { } | ! @ +`) — an absolute pattern would ignore `path` and list files outside the tray.
- **`SendMessage` goes only to the sessions you name** with `CAAS_SEND_ALLOW_RE` (a regular expression matched against the session name, e.g. `^caas_agent_\d+(-\d+)?$`). If it is not set, `SendMessage` is refused.
- **Fail-closed:** a call whose arguments cannot be read is refused. Refusals are logged to `CAAS_GATE_RECORD` (default: a file in the OS temp folder).

Install — in `claude_desktop_config.json`, point the `claude-code` server at the gate:

```json
"claude-code": { "command": "node", "args": ["/path/to/caas_gate.js"],
                 "env": { "CAAS_TRAY_DIR": "/path/to/chat_agent_tray",
                          "CAAS_SEND_ALLOW_RE": "^caas_agent_\\d+(-\\d+)?$" } }
```

**Quit Claude Desktop completely before editing this file.** Claude Desktop writes `claude_desktop_config.json` back from memory when it quits, so an edit made while it is running is overwritten on exit. We hit this: after a restart the chat still talked to `claude mcp serve` directly. Check that no Claude Desktop process is left, edit, then start it. Verify afterwards that Claude Desktop → `node caas_gate.js` → `claude mcp serve` appear as parent and child processes, and that the chat now lists only the four tools.

Measured on 2026-09-28: after limiting `Read` to the tray, 10 of 10 direct tests passed on the gate's own side, and an independent test with a stub child passed 7 of 7 (Read inside the tray passed; Read outside the tray, Read escaping with `..`, and a `.env` Read inside the tray were refused; Glob inside the tray passed, outside refused; Bash refused; `tools/list` kept only allowed tools). Earlier, in the real chat, the 25 other Claude Code tools disappeared and tray `Glob`/`Read` still worked.

**Fixed on 2026-09-28 (later the same day):** the first public gate let a `Glob` with an absolute pattern (for example `E:/Users/**/*.md`) list file names outside the tray — the `Glob` tool ignores `path` when the pattern is absolute — and let `Read`/`Glob` follow a junction inside the tray to a folder outside. Against the old gate's own judge, both passed; against the new one, 13 of 13 tests gave the expected result (9 refused: absolute pattern, absolute pattern hidden in `{…}`, `..`, a path outside, `Glob` and `Read` through a junction, `Read` outside, `Bash`, `SendMessage` to a name not allowed; 4 allowed: `Glob` in the tray and in a subfolder, `Read` in the tray, `SendMessage` to an allowed name). These are tests of the gate's judge on one PC, not of the real chat. If you installed the first version, replace `caas_gate.js` and set `CAAS_SEND_ALLOW_RE`.

## Safety

**Read this before anything else.**

- On 2026-09-28 we tested `claude mcp serve` v2.1.283 (the same binary Claude Desktop launches): a `permissions.deny` rule in a project-level `.claude/settings.json` was **not honored** — the denied command ran through MCP `tools/call`. A user-level deny rule was not tested. 28 tools were exposed, including Bash, PowerShell and Write. **Claude Code's permission settings do not protect you here; the gate does.**
- **What the gate does not cover:**
  1. **Other MCP servers in the same Claude Desktop** (for example a file-system server or a screen-control extension). They are exposed to the chat independently of the gate. Review them yourself.
  2. **What a session does when the chat asks it by `SendMessage`.** The gate only checks the recipient's name (`CAAS_SEND_ALLOW_RE`); the receiving session then acts under its *own* permission settings. A session that runs without permission prompts will do whatever the chat asks. Choose receiving sessions and their settings accordingly, and make sure only you can use the conversation.
- **What the chat can no longer do with the gate:** start new Claude Code sessions, run shell commands, poll the tray with a shell loop, or read files outside the tray. The return leg is the trigger only.
- The tray never holds request bodies — only replies, progress and questions — so dropping a file into the tray cannot command a session.
- No inbound port or tunnel is opened. No credentials are read.

## Limits

- Relies on behavior not described in official documentation. An official bug report (anthropics/claude-code#94748) says bound sessions are *not* woken by triggers; ours were (the trigger's last run had the bound conversation's session id). It may stop working at any time.
- One trigger wakes one conversation. A new conversation needs a new trigger.
- Tested on one PC only (Windows 11, Claude Desktop, Max plan), on 2026-09-28.
- A session that finishes without writing its reply is not caught yet.
- If a receiving session is set to ask for tool permission, a human has to answer on the PC (not tested).

## Status

- [x] Tool-limiting gate (2026-09-28, verified in the real chat)
- [x] Minimal scripts and hooks extracted and anonymized
- [ ] Reproduced on a second PC

## License

Code (`code/`): MIT — see `LICENSE`. Documentation (this README and the procedures): CC BY 4.0.
