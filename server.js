require("dotenv").config();
const express = require("express");
const path = require("path");
const axios = require('axios');
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

const serverType = process.env.RENDER_EXTERNAL_URL
  ? 'RENDER'
  : process.env.KOYEB_PUBLIC_DOMAIN
  ? 'KOYEB'
  : null;

const uptimeUrl = serverType === 'RENDER'
  ? process.env.RENDER_EXTERNAL_URL
  : serverType === 'KOYEB'
  ? 'https://' + process.env.KOYEB_PUBLIC_DOMAIN
  : null;

setInterval(() => {
  if (!uptimeUrl) return;

  axios.get(uptimeUrl, {
    timeout: 5000,
    headers: { 'User-Agent': 'Uptime-Bot' },
    validateStatus: status => status < 500
  }).then(res => {
    console.log(`[${new Date().toISOString()}] Uptime Ping Success: ${res.status}`);
  }).catch(err => {
    console.log(`[${new Date().toISOString()}] Uptime Ping Failed: ${err.message}`);
  });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`Server running on http://localhost:${PORT}`));
