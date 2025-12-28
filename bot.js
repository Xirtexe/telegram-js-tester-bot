"use strict";

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { runJS } = require("./runner/jsRunner");
const {
  saveAllowedPackage,
  removeAllowedPackage,
  listAllowedPackages,
} = require("./runner/packageLoader");
const { execa } = require("execa");

/* ================= CONFIG ================= */

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const ADMIN_ID = Number(process.env.ADMIN_ID);
const BOT_MODE = process.env.BOT_MODE || "PUBLIC";
const START_TIME = Date.now();

const GITHUB_REPO = "https://github.com/Xirtexe/telegram-js-tester-bot";

bot.sendMessage(
  ADMIN_ID,
  "JS Runner Bot started at: " + new Date().toISOString()
);
/* ================= RATE LIMIT ================= */

const RATE_LIMIT = {
  WINDOW_MS: 10_000,
  MAX: 5,
};

const userBuckets = new Map();
const blockedUsers = new Set();

/* ================= HELP TEXT ================= */

const HELP_TEXT = `JS Runner Bot

Run JavaScript:
> let x = 5;
return x;

Commands:
/help       Usage
/support    Support & package requests
/packages   Allowed packages & aliases
/feedback   Send feedback
/about      Bot information
/status     Bot status

Notes:
• return is required
• execution is sandboxed
• packages are preloaded
• do NOT use require() or import()
`;

/* ================= UTILITIES ================= */

function rateLimited(userId) {
  const now = Date.now();
  const bucket = userBuckets.get(userId) || [];
  const active = bucket.filter((t) => now - t < RATE_LIMIT.WINDOW_MS);

  active.push(now);
  userBuckets.set(userId, active);

  return active.length > RATE_LIMIT.MAX;
}

/* ================= BOT HANDLER ================= */

bot.on("message", async (msg) => {
  if (!msg.text) return;

  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    if (blockedUsers.has(userId)) {
      return bot.sendMessage(chatId, "Access restricted due to abuse.");
    }

    if (rateLimited(userId)) {
      return bot.sendMessage(chatId, "Rate limit exceeded. Try again shortly.");
    }

    /* START */
    if (text === "/start") {
      return bot.sendMessage(
        chatId,
        "JS Runner Bot is online.\n\nRun JavaScript using:\n> your_code_here\n\nType /help to see available commands."
      );
    }

    /* HELP */
    if (text === "/help") {
      return bot.sendMessage(chatId, HELP_TEXT);
    }

    /* SUPPORT */
    if (text === "/support") {
      return bot.sendMessage(
        chatId,
        `Support & Packages

This bot uses a controlled package allowlist.

If you need a specific npm package:
• share the package name
• explain your use case

Contact the maintainer to request approval.
@zetauh

GitHub:
${GITHUB_REPO}`
      );
    }

    /* ABOUT */
    if (text === "/about") {
      return bot.sendMessage(
        chatId,
        "JS Runner Bot\n\nA sandboxed JavaScript execution bot\nbuilt for learning, testing, and demos.\n\n• Controlled environment\n• Allow-listed packages only\n• No system access for users"
      );
    }

    /* STATUS */
    if (text === "/status") {
      const uptime = Math.floor((Date.now() - START_TIME) / 1000);
      return bot.sendMessage(
        chatId,
        `Status: Online
Uptime: ${uptime}s
Mode: ${BOT_MODE}`
      );
    }

    /* FEEDBACK */
    if (text.startsWith("/feedback")) {
      const feedback = text.replace("/feedback", "").trim();
      if (!feedback) {
        return bot.sendMessage(chatId, "Usage:\n/feedback your message");
      }

      await bot.sendMessage(
        ADMIN_ID,
        `Feedback from ${msg.from.username || userId}:\n\n${feedback}`
      );

      return bot.sendMessage(
        chatId,
        "Feedback sent.\nThank you for helping improve the bot."
      );
    }

    /* JS EXECUTION */
    if (text.startsWith(">")) {
      const code = text.slice(1).trim();
      if (!code) {
        return bot.sendMessage(chatId, "Example:\n> return 2 + 2;");
      }

      const isAdmin = userId === ADMIN_ID;

      const exec = Promise.race([
        runJS(code, {
          globals: isAdmin
            ? { bot, chatId } // 👑 FULL CONTROL
            : {}, // 👤 NO BOT ACCESS
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Execution timeout")), 30000)
        ),
      ]);

      const result = await exec;

      if (result !== undefined && result !== null) {
        await bot.sendMessage(chatId, String(result));
      }
    }

    /* INSTALL / REMOVE (ADMIN ONLY) */
    if (text.startsWith("/install") || text.startsWith("/remove")) {
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(
          chatId,
          "Dynamic package management is restricted.\nRequest packages via /support."
        );
      }

      const parts = text.split(/\s+/);
      const cmd = parts[0];
      const pkg = parts[1];
      const alias = parts[2]; // optional

      if (!pkg) {
        return bot.sendMessage(
          chatId,
          "Usage:\n/install <package> [alias]\n/remove <package>"
        );
      }

      try {
        if (cmd === "/install") {
          await execa("npm", ["install", pkg], { stdio: "ignore" });

          // save package + alias (alias optional)
          saveAllowedPackage(pkg, alias);

          return bot.sendMessage(
            chatId,
            `Package installed and allowed.

• Package: ${pkg}
• Alias: ${alias || pkg}

Restart the bot to activate.`
          );
        }

        if (cmd === "/remove") {
          await execa("npm", ["remove", pkg], { stdio: "ignore" });
          removeAllowedPackage(pkg);

          return bot.sendMessage(
            chatId,
            `Package removed: ${pkg}
Restart the bot to apply changes.`
          );
        }
      } catch (err) {
        console.error(err);
        return bot.sendMessage(
          chatId,
          `Package operation failed:\n${err.message}`
        );
      }
    }

    if (text === "/packages") {
      const pkgs = listAllowedPackages();

      if (!pkgs.length) {
        return bot.sendMessage(chatId, "No packages are currently allowed.");
      }

      const lines = pkgs.map((p) => `• ${p.pkg} → ${p.alias}`);

      return bot.sendMessage(
        chatId,
        `Allowed Packages:\n\n${lines.join("\n")}`
      );
    }

    if (text === "/restart") {
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(chatId, "Permission denied.");
      }

      await bot.sendMessage(chatId, "Restarting bot...");

      // graceful shutdown
      setTimeout(() => {
        process.exit(0);
      }, 500);
    }
  } catch (err) {
    console.error(err);
    return bot.sendMessage(chatId, `Error:\n${err.message}`);
  }
});

module.exports = bot;
