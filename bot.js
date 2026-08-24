"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const os = require("os");

const TelegramBot = require("node-telegram-bot-api");
const { runJS } = require("./runner/jsRunner");

const {
  saveAllowedPackage,
  removeAllowedPackage,
  listAllowedPackages,
} = require("./runner/packageLoader");

const { execa } = require("execa");

/* ================= CONFIG ================= */

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

const ADMIN_ID = Number(process.env.ADMIN_ID);
const BOT_MODE = process.env.BOT_MODE || "PUBLIC";
const START_TIME = Date.now();

const GITHUB_REPO =
  "https://github.com/Xirtexe/telegram-js-tester-bot";

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

Or upload a file containing JavaScript.

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
• uploaded documents are executed as raw text
`;

/* ================= UTILITIES ================= */

function rateLimited(userId) {
  const now = Date.now();

  const bucket = userBuckets.get(userId) || [];

  const active = bucket.filter(
    (t) => now - t < RATE_LIMIT.WINDOW_MS
  );

  active.push(now);

  userBuckets.set(userId, active);

  return active.length > RATE_LIMIT.MAX;
}

/* ================= FILE → TEXT ================= */

/**
 * Download a Telegram document and return its contents as text.
 *
 * Important:
 * - Only Telegram "document" messages reach this function.
 * - Filename/extension is NOT checked.
 * - The file is treated as raw UTF-8 text.
 * - Temporary file is removed after reading.
 */
async function extractDocumentText(document) {
  const tempDir = path.join(os.tmpdir(), "js-runner");

  await fs.promises.mkdir(tempDir, {
    recursive: true,
  });

  let filePath;

  try {
    filePath = await bot.downloadFile(
      document.file_id,
      tempDir
    );

    const buffer = await fs.promises.readFile(filePath);

    return buffer.toString("utf8");
  } finally {
    if (filePath) {
      await fs.promises
        .unlink(filePath)
        .catch(() => {});
    }
  }
}

/* ================= EXECUTION ================= */

/**
 * Single execution path for BOTH:
 *
 * 1. > code
 * 2. uploaded documents
 *
 * This deliberately reuses the existing runJS() sandbox.
 */
async function executeCode(code, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!code || !code.trim()) {
    return bot.sendMessage(
      chatId,
      "No JavaScript code found."
    );
  }

  const isAdmin = userId === ADMIN_ID;

  const exec = Promise.race([
    runJS(code, {
      globals: isAdmin
        ? {
            bot,
            chatId,
          }
        : {},
    }),

    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Execution timeout")),
        30_000
      )
    ),
  ]);

  const result = await exec;

  if (result !== undefined && result !== null) {
    await bot.sendMessage(
      chatId,
      String(result)
    );
  }
}

/* ================= BOT HANDLER ================= */

bot.on("message", async (msg) => {
  /*
   * IMPORTANT:
   *
   * Do NOT do:
   *
   * if (!msg.text) return;
   *
   * here anymore.
   *
   * Telegram documents do not have msg.text.
   */

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    /* ================= BASIC CHECKS ================= */

    if (blockedUsers.has(userId)) {
      return bot.sendMessage(
        chatId,
        "Access restricted due to abuse."
      );
    }

    if (rateLimited(userId)) {
      return bot.sendMessage(
        chatId,
        "Rate limit exceeded. Try again shortly."
      );
    }

    /* ==================================================
       DOCUMENT EXECUTION
       ================================================== */

    if (msg.document) {
      try {
        await bot.sendMessage(
          chatId,
          "Reading file..."
        );

        const code = await extractDocumentText(
          msg.document
        );

        if (!code.trim()) {
          return bot.sendMessage(
            chatId,
            "The uploaded file is empty."
          );
        }

        /*
         * IMPORTANT:
         *
         * No prefix.
         * No Telegram Markdown parsing.
         * No modification of the source.
         *
         * The raw file contents go directly into
         * the SAME runJS() function used by > code.
         */
        return await executeCode(code, msg);

      } catch (err) {
        console.error(
          "[FILE EXECUTION]",
          err
        );

        return bot.sendMessage(
          chatId,
          `File execution failed:\n${err.message}`
        );
      }
    }

    /* ==================================================
       EVERYTHING BELOW REQUIRES TEXT
       ================================================== */

    if (!msg.text) {
      return;
    }

    const text = msg.text.trim();

    /* ================= START ================= */

    if (text === "/start") {
      return bot.sendMessage(
        chatId,
        "JS Runner Bot is online.\n\n" +
        "Run JavaScript using:\n" +
        "> your_code_here\n\n" +
        "Or upload a file containing JavaScript.\n\n" +
        "Type /help to see available commands."
      );
    }

    /* ================= HELP ================= */

    if (text === "/help") {
      return bot.sendMessage(
        chatId,
        HELP_TEXT
      );
    }

    /* ================= SUPPORT ================= */

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

    /* ================= ABOUT ================= */

    if (text === "/about") {
      return bot.sendMessage(
        chatId,
        "JS Runner Bot\n\n" +
        "A sandboxed JavaScript execution bot\n" +
        "built for learning, testing, and demos.\n\n" +
        "• Controlled environment\n" +
        "• Allow-listed packages only\n" +
        "• No system access for users"
      );
    }

    /* ================= STATUS ================= */

    if (text === "/status") {
      const uptime = Math.floor(
        (Date.now() - START_TIME) / 1000
      );

      return bot.sendMessage(
        chatId,
        `Status: Online
Uptime: ${uptime}s
Mode: ${BOT_MODE}`
      );
    }

    /* ================= FEEDBACK ================= */

    if (text.startsWith("/feedback")) {
      const feedback = text
        .replace("/feedback", "")
        .trim();

      if (!feedback) {
        return bot.sendMessage(
          chatId,
          "Usage:\n/feedback your message"
        );
      }

      await bot.sendMessage(
        ADMIN_ID,
        `Feedback from ${
          msg.from.username || userId
        }:\n\n${feedback}`
      );

      return bot.sendMessage(
        chatId,
        "Feedback sent.\n" +
        "Thank you for helping improve the bot."
      );
    }

    /* ==================================================
       TEXT JS EXECUTION
       ================================================== */

    if (text.startsWith(">")) {
      const code = text
        .slice(1)
        .trim();

      if (!code) {
        return bot.sendMessage(
          chatId,
          "Example:\n> return 2 + 2;"
        );
      }

      return await executeCode(
        code,
        msg
      );
    }

    /* ================= INSTALL / REMOVE ================= */

    if (
      text.startsWith("/install") ||
      text.startsWith("/remove")
    ) {
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(
          chatId,
          "Dynamic package management is restricted.\n" +
          "Request packages via /support."
        );
      }

      const parts = text.split(/\s+/);

      const cmd = parts[0];
      const pkg = parts[1];
      const alias = parts[2];

      if (!pkg) {
        return bot.sendMessage(
          chatId,
          "Usage:\n" +
          "/install <package> [alias]\n" +
          "/remove <package>"
        );
      }

      try {
        if (cmd === "/install") {
          await execa(
            "npm",
            ["install", pkg],
            {
              stdio: "ignore",
            }
          );

          saveAllowedPackage(
            pkg,
            alias
          );

          return bot.sendMessage(
            chatId,
            `Package installed and allowed.

• Package: ${pkg}
• Alias: ${alias || pkg}
Restart the bot to activate.`
          );
        }

        if (cmd === "/remove") {
          await execa(
            "npm",
            ["remove", pkg],
            {
              stdio: "ignore",
            }
          );

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

    /* ================= PACKAGES ================= */

    if (text === "/packages") {
      const pkgs =
        listAllowedPackages();

      if (!pkgs.length) {
        return bot.sendMessage(
          chatId,
          "No packages are currently allowed."
        );
      }

      const lines = pkgs.map(
        (p) =>
          `• ${p.pkg} → ${p.alias}`
      );

      return bot.sendMessage(
        chatId,
        `Allowed Packages:\n\n${lines.join("\n")}`
      );
    }

    /* ================= RESTART ================= */

    if (text === "/restart") {
      if (userId !== ADMIN_ID) {
        return bot.sendMessage(
          chatId,
          "Permission denied."
        );
      }

      await bot.sendMessage(
        chatId,
        "Restarting bot..."
      );

      setTimeout(() => {
        process.exit(0);
      }, 500);
    }

  } catch (err) {
    console.error(err);

    return bot.sendMessage(
      chatId,
      `Error:\n${err.message}`
    );
  }
});

module.exports = bot;
