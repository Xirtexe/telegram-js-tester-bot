# JS Runner Bot

![Version](https://img.shields.io/badge/version-v1.1.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-production--ready-success)

A production-grade JavaScript execution bot designed for safe testing, learning, and experimentation.  
Execute sandboxed JavaScript using a simple `>` prefix via Telegram.

---

## Features

- Sandboxed JavaScript execution using Node.js `vm`
- Enforced `return` for deterministic output
- Telegram bot interface
- Admin-controlled execution capabilities
- Allow-listed npm packages with custom aliases
- Admin-only package install/remove
- Restart-safe architecture (PM2 compatible)
- Rate limiting and abuse detection
- Clean, extensible architecture

---

## Example

```js
let a = 5;
let b = 10;
return a + b;
```

**Output**
```
15
```

---

## Commands

### Public
- /start – Start the bot
- /help – Usage information
- /packages – List allowed packages and aliases
- /feedback <message> – Send feedback
- /about – Bot information
- /status – Bot status

### Admin only
- /install <pkg> [alias] – Install and allow a package
- /remove <pkg> – Remove a package
- /restart – Restart the bot (PM2 required)

---

## License

MIT License. See LICENSE file.
