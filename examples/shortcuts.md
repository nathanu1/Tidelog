# Logging from your phone, launcher or editor

Everything goes through one endpoint. Point it at your server and you are done.

```
POST {LOGTRACK_URL}/api/activities/quick
Content-Type: application/json
Authorization: Bearer <API_TOKEN>        # only if the server sets API_TOKEN

{"text": "45m deep work @work #focus !4 ~5", "source": "shortcut"}
```

## iOS Shortcuts

1. New Shortcut → **Ask for Input** (Text), prompt "What did you do?"
2. **Get Contents of URL**
   - URL: `https://your-server/api/activities/quick`
   - Method: `POST`
   - Headers: `Content-Type: application/json` (+ `Authorization: Bearer …` if needed)
   - Request Body: JSON → `text` = *Provided Input*, `source` = `ios`
3. Add it to the Home Screen or trigger it from the Action Button / Back Tap.

A second shortcut with a fixed text like `"5m stretch @exercise"` becomes a one-tap button.

## Android (Tasker / HTTP Shortcuts)

Create an HTTP Shortcut with the same URL, method POST, body type JSON and a text variable for the prompt.

## Raycast / Alfred / any launcher

```bash
#!/usr/bin/env bash
# @raycast.schemaVersion 1
# @raycast.title Log activity
# @raycast.mode compact
# @raycast.argument1 { "type": "text", "placeholder": "45m deep work @work #focus" }
LOGTRACK_URL="${LOGTRACK_URL:-http://localhost:3000}" node /path/to/logdatatrack/bin/logtrack.js "$1"
```

## Shell alias

```bash
alias log='node /path/to/logdatatrack/bin/logtrack.js'
# or, after `npm link` in the project folder:
logtrack "25m reading @learning #books"
```

## Pomodoro-style from the terminal

```bash
logtrack start "Writing the spec @work #docs" && sleep 1500 && logtrack stop ~4
```

## Git commits as entries

Copy `examples/git-post-commit` into `.git/hooks/post-commit` of any repository. Each commit shows up as a Work entry tagged with the repo name, and the artwork reacts in real time.
