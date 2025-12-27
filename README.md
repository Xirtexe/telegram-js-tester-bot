# JS Runner Bot

A production-ready JavaScript execution bot and web tool for fast testing, learning, and experimentation.  
Execute sandboxed JavaScript using a simple `>` prefix via Telegram or a web interface.

## Features
- Sandboxed JavaScript execution (Node.js `vm`)
- Enforced `return` for deterministic output
- Telegram bot + Web UI support
- Restricted package install/remove (`execa`)
- Strong error handling
- Clean, extensible architecture

## Example
```js
let a = 5;
let b = 10;
return a + b;
```
**Output:** `15`

## Setup
```bash
git clone <repo-url>
cd js-runner-prod
npm install
```
Create `.env`:
```ini
BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
PORT=3000
```
Run:
```bash
npm start
```

## Commands
- `/start` – Start bot  
- `/help` – Usage help  
- `> code` – Execute JavaScript  
- `/install <pkg>` – Install package (restricted)  
- `/remove <pkg>` – Remove package (restricted)

## API
`POST /api/run`
```json
{ "code": "let x = 2; return x * 5;" }
```

## Security
Admin-only package management.  
Do not expose publicly without auth, rate limits, and container isolation.

## License
MIT