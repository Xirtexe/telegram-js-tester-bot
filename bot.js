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
      isAdmin,
      globals: isAdmin
  ? {
      bot,
      msg,
      chatId,
      require,
      __dirname,
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

/* ================= LIVE PACKAGE STATUS ================= */

/**
 * Creates one Telegram message and edits it during
 * package installation/removal.
 *
 * Telegram has edit-rate limits, so updates are
 * debounced instead of editing on every npm output.
 */
async function createLiveStatus(chatId) {
  let statusMessage = null;
  let lastText = "";
  let pendingText = null;
  let updateTimer = null;
  let updateInProgress = false;

  async function performEdit(text) {
    if (!statusMessage) {
      statusMessage = await bot.sendMessage(
        chatId,
        text
      );

      lastText = text;
      return;
    }

    if (text === lastText) {
      return;
    }

    if (updateInProgress) {
      pendingText = text;
      return;
    }

    updateInProgress = true;

    try {
      await bot.editMessageText(
        text,
        {
          chat_id: chatId,
          message_id: statusMessage.message_id,
        }
      );

      lastText = text;
    } catch (err) {
      const message = String(err.message || err);

      if (
        !message
          .toLowerCase()
          .includes("message is not modified")
      ) {
        console.error(
          "[STATUS EDIT]",
          message
        );
      }
    } finally {
      updateInProgress = false;

      if (
        pendingText &&
        pendingText !== lastText
      ) {
        const nextText = pendingText;

        pendingText = null;

        await performEdit(nextText);
      } else {
        pendingText = null;
      }
    }
  }

  async function update(text, immediate = false) {
    if (immediate) {
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }

      return performEdit(text);
    }

    pendingText = text;

    if (updateTimer) {
      return;
    }

    updateTimer = setTimeout(async () => {
      updateTimer = null;

      const nextText = pendingText;

      pendingText = null;

      if (nextText) {
        await performEdit(nextText);
      }
    }, 1000);
  }

  async function finish(text) {
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }

    pendingText = null;

    await performEdit(text);
  }

  return {
    update,
    finish,
    getMessage: () => statusMessage,
  };
}

/**
 * Limit live npm output so Telegram messages don't
 * become excessively large.
 */
function cleanPackageOutput(output, maxLength = 1800) {
  if (!output) {
    return "";
  }

  const text = String(output)
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r/g, "")
    .trim();

  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return (
    "..." +
    text.slice(-maxLength)
  );
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

      /*
       * ==================================================
       * LIVE PACKAGE OPERATION
       * ==================================================
       */

      const status = await createLiveStatus(
        chatId
      );

      /*
       * ==================================================
       * INSTALL
       * ==================================================
       */

      if (cmd === "/install") {
        try {
          await status.update(
            `Package Installation

Package: ${pkg}
Alias: ${alias || pkg}

Status: Preparing...`,
            true
          );

          await status.update(
            `Package Installation

Package: ${pkg}
Alias: ${alias || pkg}

Status: Installing package...`,
            true
          );

          /*
           * Keep stdout/stderr available so we can
           * display npm progress/output.
           */
          const npmProcess = execa(
            "npm",
            ["install", pkg],
            {
              stdout: "pipe",
              stderr: "pipe",
            }
          );

          let output = "";

          if (npmProcess.stdout) {
            npmProcess.stdout.on(
              "data",
              async (chunk) => {
                output += chunk.toString();

                const cleanOutput =
                  cleanPackageOutput(output);

                if (!cleanOutput) {
                  return;
                }

                await status.update(
                  `Package Installation

Package: ${pkg}
Alias: ${alias || pkg}

Status: Installing...

${cleanOutput}`
                );
              }
            );
          }

          if (npmProcess.stderr) {
            npmProcess.stderr.on(
              "data",
              async (chunk) => {
                output += chunk.toString();

                const cleanOutput =
                  cleanPackageOutput(output);

                if (!cleanOutput) {
                  return;
                }

                await status.update(
                  `Package Installation

Package: ${pkg}
Alias: ${alias || pkg}

Status: Installing...

${cleanOutput}`
                );
              }
            );
          }

          await npmProcess;

          await status.update(
            `Package Installation

Package: ${pkg}
Alias: ${alias || pkg}

Status: Package installed successfully.
Status: Updating allowlist...`,
            true
          );

          saveAllowedPackage(
            pkg,
            alias
          );

          await status.finish(
            `Package Installation

Package: ${pkg}
Alias: ${alias || pkg}

Status: Completed

Package installed and allowed successfully.

Restart the bot to activate the package.`
          );

          return;

        } catch (err) {
          console.error(
            "[PACKAGE INSTALL]",
            err
          );

          await status.finish(
            `Package Installation

Package: ${pkg}
Alias: ${alias || pkg}

Status: Failed

Error:
${err.message}`
          );

          return;
        }
      }

      /*
       * ==================================================
       * REMOVE
       * ==================================================
       */

      if (cmd === "/remove") {
        try {
          await status.update(
            `Package Removal

Package: ${pkg}

Status: Preparing...`,
            true
          );

          await status.update(
            `Package Removal

Package: ${pkg}

Status: Removing package...`,
            true
          );

          const npmProcess = execa(
            "npm",
            ["remove", pkg],
            {
              stdout: "pipe",
              stderr: "pipe",
            }
          );

          let output = "";

          if (npmProcess.stdout) {
            npmProcess.stdout.on(
              "data",
              async (chunk) => {
                output += chunk.toString();

                const cleanOutput =
                  cleanPackageOutput(output);

                if (!cleanOutput) {
                  return;
                }

                await status.update(
                  `Package Removal

Package: ${pkg}

Status: Removing...

${cleanOutput}`
                );
              }
            );
          }

          if (npmProcess.stderr) {
            npmProcess.stderr.on(
              "data",
              async (chunk) => {
                output += chunk.toString();

                const cleanOutput =
                  cleanPackageOutput(output);

                if (!cleanOutput) {
                  return;
                }

                await status.update(
                  `Package Removal

Package: ${pkg}

Status: Removing...

${cleanOutput}`
                );
              }
            );
          }

          await npmProcess;

          await status.update(
            `Package Removal

Package: ${pkg}

Status: Package removed successfully.
Status: Updating allowlist...`,
            true
          );

          removeAllowedPackage(pkg);

          await status.finish(
            `Package Removal

Package: ${pkg}

Status: Completed

Package removed successfully.

Restart the bot to apply the changes.`
          );

          return;

        } catch (err) {
          console.error(
            "[PACKAGE REMOVE]",
            err
          );

          await status.finish(
            `Package Removal

Package: ${pkg}

Status: Failed

Error:
${err.message}`
          );

          return;
        }
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
