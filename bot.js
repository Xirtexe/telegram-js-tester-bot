require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { runJS } = require("./runner/jsRunner");
const { execa } = require("execa");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const HELP_TEXT = `
JS Runner Bot

Run JavaScript:
> let name = 'shahid';
return name;

Install package:
/install lodash

Remove package:
/remove lodash

Rules:
- JS must contain return
- Execution is sandboxed
- Package commands must be restricted in production
`;

bot.on("message", async (msg) => {
  if (!msg.text) return;

  const text = msg.text.trim();
  const chatId = msg.chat.id;

  try {
    // START
    if (text === "/start") {
      return bot.sendMessage(
        chatId,
        "JS Runner Bot is online.\nType /help for usage."
      );
    }

    // HELP
    if (text === "/help") {
      return bot.sendMessage(chatId, HELP_TEXT);
    }

    // JS EXECUTION
    if (text.startsWith(">")) {
      const code = text.slice(1).trim();

      if (!code) {
        return bot.sendMessage(
          chatId,
          "Example:\n> let x = 10;\nreturn x;"
        );
      }

      const result = await runJS(code);
      return bot.sendMessage(chatId, String(result));
    }

    // INSTALL PACKAGE
    if (text.startsWith("/install")) {
      const pkg = text.split(/\s+/)[1];
      if (!pkg) return bot.sendMessage(chatId, "Package name required");

      await execa("npm", ["install", pkg], { stdio: "ignore" });
      return bot.sendMessage(chatId, `Installed: ${pkg}`);
    }

    // REMOVE PACKAGE
    if (text.startsWith("/remove")) {
      const pkg = text.split(/\s+/)[1];
      if (!pkg) return bot.sendMessage(chatId, "Package name required");

      await execa("npm", ["remove", pkg], { stdio: "ignore" });
      return bot.sendMessage(chatId, `Removed: ${pkg}`);
    }

  } catch (err) {
    console.error(err);
    return bot.sendMessage(chatId, `Error:\n${err.message}`);
  }
});
