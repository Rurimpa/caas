---
name: caas-chat
description: >
  Use when the user says "Set up CAAS", gives you their CAAS tray folder, asks you to have a Claude Code
  session on their PC do some work, or when you are woken by a CAAS bell. Sends work to a running
  Claude Code session through the CAAS gate and reads the answer from the tray folder.
---

# CAAS — chat side (Claude.ai conversation)

You can send work to a Claude Code session that is already running on the user's PC, and the answer comes
back to this conversation by itself. The PC-side install is done by the user with the setup script.

## 0. First time in a conversation: "Set up CAAS"

Do these in order and tell the user what you found at each step.

1. **Is this conversation linked to the PC?** Check whether you have the Claude Code tools
   `ListAgents`, `SendMessage`, `Read`, `Glob`.
   - If you do **not** have them, stop and tell the user exactly this:
     "This conversation is not linked to your PC yet. Click the PC icon next to the conversation title
     and choose **Link to this computer**, then say *Set up CAAS* again."
     (A brand-new chat cannot be linked from the empty New chat screen; it must have one message first.)
   - If you have more Claude Code tools than these four, warn the user: the gate may not be installed.
2. **Tray folder.** You need its full path. If the user installed the CAAS Gate extension with its default
   settings, it is `C:\Users\<Windows user name>\caas\chat_agent_tray`; if they used the setup script, it printed it.
   If the user has not given it, ask for their Windows user name (or the path shown in Claude Desktop →
   Settings → Extensions → CAAS Gate). Check it with `Glob` (path = the tray, pattern = `*`).
3. **Bell.** Create a one-shot scheduled message in **this** conversation with your scheduled-message tool:
   - name: `CAAS bell`
   - date: 2030-01-01 (far future; running it does not use it up)
   - text: `Bell: a session put an answer in <tray folder>. Read the .md files there that start with FROM and end with END, and report them to me.`
   Tell the user the trigger id (`trig_…`). You will put it in every request.
4. **Sessions.** Call `ListAgents` and show the names. If none is running, tell the user to start one
   in a terminal: `claude --name agent_1`.

## 1. Sending work

1. `ListAgents`, then copy the target name exactly. Never guess a name.
2. Make a request id: `CM-YYYYMMDD-HHMMSS-xxxx` (xxxx = 4 random hex digits).
3. `SendMessage` to that name. The first line must be:
   `[chat_agent_tray CM-… reply-to=<tray folder> bell=<trigger id>] Do not reply with SendMessage.`
   Then write the request in plain words.
4. Tell the user it was sent. Do not write files yourself; requests travel only by SendMessage.

## 2. When the bell wakes you

1. `Glob` the tray (path = tray folder, pattern = `*.md`).
2. `Read` only files whose first line starts with `FROM` and whose last line is `END`. Ignore `.tmp` files.
3. Report the content to the user, then send the next request if needed.
4. Ask the session (by SendMessage, with the same marker line) to move the files you read to `done/`.

## If nothing comes back

Do not say "it failed". Say "no answer yet" and ask the user to look at the PC: the session may be
waiting for a permission answer, or Claude Desktop may be closed.

## Limits

- The gate lets you use only four tools and read only inside the tray. That is on purpose.
- A bell wakes only the conversation it was created in. In a new conversation, run "Set up CAAS" again.
