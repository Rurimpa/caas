# CAAS — chat-side procedure (Claude.ai conversation)

Instructions for the Claude.ai conversation (Claude Desktop) that sends work to running Claude Code sessions and receives the results. Put this text where your chat can use it (for example as a skill or project instruction). The session side is in `../seat/AGENT_SIDE_PROCEDURE.md`.

## Prerequisites

- The conversation is opened in Claude Desktop on the PC, and the Claude Code MCP server is exposed **through the gate** (`../gate/caas_gate.js`). The chat then has exactly four Claude Code tools: `ListAgents`, `SendMessage`, `Read`, `Glob`.
- Use it only while the human is in the conversation, unless you have separately decided how unattended runs are allowed.

## Outbound: chat → session (SendMessage)

1. Call `ListAgents` and copy the target session's name. Never guess a name.
2. Give the request an id: `CM-YYYYMMDD-HHMMSS-xxxx` (xxxx = 4 hex digits, ASCII only).
3. The first line of the message must be:
   `[chat_agent_tray CM-… reply-to=<full path of the tray folder> bell=<trigger id>] Do not reply by SendMessage.`
4. Never put the request body in a file. Requests travel only by `SendMessage` (a file in a folder would let anyone command a session).
5. When you pass on the human's approval, include three things: what it covers, the human's exact words and time, and where the receiver can verify it. The receiver does not treat an approval without these as an approval.

## Return: session → chat (tray file + bell)

- The session writes `<tray>/<request-id>_<reply|progress|question>_<n>.md` (it writes `.md.tmp` and renames it in the same folder).
- First line `FROM <session name> [<session id>] <request-id>`, last line `END`. Treat a file as read only when both are present. Never read `.tmp` files; report them to the human if you see them.
- A session replying by `SendMessage` does not reach the chat. Silence there is not a failure.

## Waiting

- The only way to wait is to be woken by the bell (below). With the gate, the chat cannot poll the tray with a shell loop.
- When woken, use `Glob` with the tray's full path as `path` to list files, then `Read` them. `Read` and `Glob` work only inside the tray.
- If nothing appears, do not write "it was not delivered"; write "not measured". The receiving session may be waiting for a permission answer on the PC — ask the human to check the PC screen. The chat never answers a permission prompt on the human's behalf.

## The bell (a session wakes the chat)

- After the rename, the session runs the bell with `RemoteTrigger` `action=run`. The chat is woken automatically.
- The **human creates the bell in this conversation** with the chat's scheduled-message tool: a one-shot trigger dated far in the future, reused many times (running it does not consume it). Sessions only run it; they never create, update, enable or disable it.
- A bell is bound to the conversation it was created in. **In a new conversation, create a new bell and give its trigger id to the sessions.** Delete the bell of an old conversation.
- Before running, the session reads the bell and checks three things: its name starts with your bell name, its kind is a reminder, and its bound device is Claude Desktop.
- When woken: read the files in the tray → report to the human → send the next request if needed. Ask the session in charge to move finished files to `done/` (never delete).

## Known constraints

- Calling `RemoteTrigger` from the chat through the Claude Code MCP server is rejected ("run requires trigger_id"; arguments do not arrive). Sessions ring the bell, not the chat. With the gate, the chat does not have `RemoteTrigger` at all.
- The path itself reads no credentials. If a process on the PC reads stored secrets to authenticate, that is outside this procedure and needs its own review.
