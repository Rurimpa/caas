# CAAS — Detailed setup (by hand)

> **Most people do not need this page.** The 3 steps at the top of the [README](README.en.md) are enough. This page is for doing it by hand, without the Claude Code plugin, or for understanding what each step does.
>
> | README step | What it covers on this page |
> |---|---|
> | 1. `npx github:Rurimpa/caas#v1.1.0 setup` | step 1 (the gate) — the Fast path below |
> | 2. `/plugin install caas@caas`, then `claude --name agent_1` | step 2 (named session) and step 3 (reply guard + session procedure) |
> | 3. chat skill `caas-chat.zip`, link the chat, "Set up CAAS" | step 4 (link to this PC), step 5 (bell) and step 6 (first round trip) |

This page walks you from nothing to one working round trip: you ask in your everyday Claude.ai conversation, a Claude Code session on the same PC does the work, and the answer comes back to the same conversation without you typing anything else.

Read [Safety](README.en.md#safety) in the README first. Do not skip the gate.

Tested on one PC only (Windows 11, Claude Desktop, Max plan), September 2026. Other setups are untested.

---

## 0. What you need

- **Claude Desktop** (the desktop app), signed in.
- **Claude Code** (the CLI) on the same PC, able to run `claude mcp serve`.
- **Node.js** (to run the gate and the hook).
- A folder for replies — the **tray**. Example: `C:\caas\chat_agent_tray\` with an empty `done\` folder inside it.

## Fast path: let the setup script do step 1

`code/setup/caas_setup.js` does step 1 below (and step 3 too, if you pass `--seat-dir`) in one run and then checks the result. **Quit Claude Desktop completely first** — the script refuses to write the config while Claude Desktop is running.

```
npx github:Rurimpa/caas#v1.1.0 setup --dry-run
npx github:Rurimpa/caas#v1.1.0 setup
```

(From a downloaded copy: `node code/setup/caas_setup.js setup …` with the same options.)

- `--root` — where the gate, the tray (`chat_agent_tray\` with `done\`) and the gate's record go. Default: `<your home folder>\caas`.
- `--send-allow` — which session names the chat may message (same as `CAAS_SEND_ALLOW_RE`). Default: `^agent_\d+$` (sessions named `agent_1`, `agent_2`, …). Pass `--send-allow ""` to let the chat message nobody.
- `--seat-dir` — only if you do **not** use the Claude Code plugin: the folder where you will start the session (step 2). The reply guard is then added to `<seat-dir>\.claude\settings.json`. With the plugin, leave it out (the plugin already adds the guard).
- `--dry-run` — shows what it would do and writes nothing.
- The tray location is also written to `<your home folder>\.caas\config.json`, where the reply guard reads it.

What it does: copies the gate and the reply guard **unchanged**, adds the `claude-code` entry (with the `env` settings) to `claude_desktop_config.json` after saving a backup next to it, keeps your other MCP servers, and stops if a different `claude-code` entry is already there (add `--replace` to overwrite it). Then it starts the gate once and checks two things: the chat sees exactly four tools, and a `SendMessage` to a name outside `--send-allow` is refused by the gate. It prints `"result": "installed"` only when both pass.

Tested on one PC only (a temporary folder and a copy of the config). If you prefer to do it by hand, follow steps 1 and 3.

## 1. Put the gate between Claude Desktop and Claude Code

1. Copy `code/gate/caas_gate.js` somewhere stable, e.g. `C:\caas\caas_gate.js`.
2. **Quit Claude Desktop completely** (check that no Claude Desktop process is left). Claude Desktop rewrites its config file from memory when it quits, so an edit made while it runs is lost.
3. Open `claude_desktop_config.json` and point the `claude-code` MCP server at the gate:

```json
"claude-code": {
  "command": "node",
  "args": ["C:\\caas\\caas_gate.js"],
  "env": {
    "CAAS_TRAY_DIR": "C:\\caas\\chat_agent_tray",
    "CAAS_SEND_ALLOW_RE": "^agent_\\d+$"
  }
}
```

   - `CAAS_TRAY_DIR` — the tray. The chat can `Read` / `Glob` only inside it.
   - `CAAS_SEND_ALLOW_RE` — which session names the chat may message. If you leave it out, the chat can message nobody.
4. Start Claude Desktop again.
5. **Check:** in a chat, the Claude Code tools should be exactly four: `ListAgents`, `SendMessage`, `Read`, `Glob`. On the PC, the process tree should show Claude Desktop → `node caas_gate.js` → `claude mcp serve`.

## 2. Start a named Claude Code session

Open a terminal in the folder where the work should happen and start a session whose name matches `CAAS_SEND_ALLOW_RE`:

```
claude --name agent_1
```

This session is the one the chat will talk to. It acts under **its own** permission settings — the gate does not limit what it does. Choose its settings with that in mind.

## 3. Install the reply guard in the session

A session that receives a request from the chat tends to answer with `SendMessage`. That call reports success but **nothing reaches the chat**. The hook stops it once and points it to the tray instead.

Add to the session's `settings.json`:

```json
"hooks": { "PreToolUse": [ { "matcher": "SendMessage",
  "hooks": [ { "type": "command", "command": "node C:\\caas\\caas-reply-guard.js", "timeout": 20 } ] } ] }
```

Give the session the agent-side procedure (`code/seat/AGENT_SIDE_PROCEDURE.md`), for example by putting it in the project's `CLAUDE.md`.

## 4. Open a conversation that is linked to this PC

A new Claude.ai conversation is **not** linked to the PC at first — it has no Claude Code tools.

- Start the conversation first (send any message). Then choose **"Link to this computer"** from the PC icon next to the conversation title. On the empty "New chat" screen the option is not there yet.
- A linked conversation shows a PC icon next to its title.
- Once linked, the conversation can also be used from the web version of Claude.ai.

Give the conversation the chat-side procedure (`code/chat/CHAT_SIDE_PROCEDURE.md`), for example as a skill.

## 5. Create the bell

The bell is how a session wakes the conversation. Ask the conversation to create it:

> Create a one-shot scheduled message named "<conversation name> bell", dated 2030-01-01, with this text: "Bell: a session put a reply in <tray folder>. Read the .md files in it that have a FROM first line and an END last line, and report them to me."

The conversation creates it with its scheduled-message tool and tells you the trigger id (`trig_…`). Running it later does not consume it, so one bell is reused.

A bell wakes **only the conversation it was created in**. A new conversation needs a new bell.

## 6. First round trip

In the conversation, ask something small, e.g.:

> Using CAAS, ask agent_1 what folder it is working in.

What should happen:

1. The chat calls `ListAgents`, then `SendMessage` to `agent_1` with the marker line `[chat_agent_tray CM-… reply-to=… bell=trig_…]`.
2. `agent_1` writes `CM-…_reply_01.md` into the tray (first line `FROM …`, last line `END`) and runs the bell.
3. The conversation wakes by itself, reads the file and answers you.

If nothing comes back, look at the PC screen first: the session may be waiting for a permission answer.

## Things to know

- **Sharing:** a conversation linked to the PC is shared as a *session*. Even with "public" visibility, only people signed in to claude.ai can open it. Anyone viewing a shared conversation can only read it — no one can type into your conversation from a share link.
- **What a share shows:** your messages, the replies, a one-line summary of tool use, the bell card, and the bell's wake-up message (which contains the tray path). Attached files are not included.
- **Old conversations:** when you move to a new conversation, disable the old conversation's bell rather than deleting things you are not sure about.
