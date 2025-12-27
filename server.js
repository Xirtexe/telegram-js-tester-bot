require("dotenv").config();
const express = require("express");
const path = require("path");
const { runJS } = require("./runner/jsRunner");
const { log } = require("./utils/logger");

require("./bot"); // start bot

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/run", async (req, res) => {
  try {
    const { code } = req.body;
    const result = await runJS(code);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`Server running on http://localhost:${PORT}`));
