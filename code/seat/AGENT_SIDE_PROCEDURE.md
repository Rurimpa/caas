# CAAS — agent-side procedure (Claude Code session)

This is what a running Claude Code session ("agent") does when it receives a CAAS request from the chat.

## 1. Recognize a CAAS request

A CAAS request arrives as a cross-session message that

- has **no** `from-name` (only `from="uds:...cc-msg-<hex>"` and `from-mode="prompting"`), and
- starts with the marker line:

```
[chat_agent_tray <request-id> reply-to=<tray folder> bell=<trigger_id>] Do not reply with SendMessage.
```

`<request-id>` looks like `CM-YYYYMMDD-HHMMSS-xxxx` (ASCII only).

## 2. Do NOT reply with SendMessage

Replying to the `from` address returns `success` but delivers nothing to the chat (measured).
Install `hooks/caas-reply-guard.js` so the session is stopped once if it tries.

## 3. Reply on paper

1. Write the full reply to `<tray folder>/<request-id>_<kind>_<nn>.md.tmp`
   - `<kind>` = `reply` | `progress` | `question`
   - first line: `FROM <your session name> [<your session ref>] <request-id>`
   - last line: `END`
2. Rename it to `.md` **in the same folder** (a rename on the same drive is atomic, so the chat never reads a half-written file).

Put only agent -> chat papers in the tray. Never put the chat's request itself there
(otherwise anyone who can drop a file could give the agent instructions).

## 4. Ring the bell (after the rename)

1. `RemoteTrigger action=get trigger_id=<bell>` and check all three before ringing:
   - the name starts with the bell name the chat gave it
   - `created_kind` is `reminder` and the creator is the chat owner's account
   - `bound_device` is the Claude desktop app
   If any check fails, do not ring; write why in the paper.
2. `RemoteTrigger action=run trigger_id=<bell>`

The agent only **runs** the bell. It never creates, updates, enables or disables it.
The bell is created on the chat side, by the person, and reused.

## 5. After the chat has read it

When the chat says it has read a paper, move it to `<tray folder>/done/`. Do not delete papers.

## Known limits (measured 2026-09)

- A bell wakes only the one chat conversation it was created in. A new chat needs a new bell.
- `run` does not consume a one-shot reminder; the scheduled time stays. Create the bell with a far-future date.
- Messages that arrive while the agent is busy are stored in the transcript as `queue-operation` / `attachment`, not `type:user`.
- Whether the chat can see the result when nobody is watching the screen was not measured.
