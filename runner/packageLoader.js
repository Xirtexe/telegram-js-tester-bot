"use strict";

const fs = require("fs");
const path = require("path");

const ALLOW_FILE = path.join(__dirname, "allowedPackages.json");

function loadAllowedPackages() {
  if (!fs.existsSync(ALLOW_FILE)) return {};

  const raw = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8"));
  const injected = {};

  for (const [pkg, meta] of Object.entries(raw)) {
    try {
      const mod = require(pkg);
      const alias = meta.alias || pkg;

      injected[alias] = mod;
    } catch {
      // ignore broken packages
    }
  }

  return injected;
}

function saveAllowedPackage(pkg, alias) {
  const data = fs.existsSync(ALLOW_FILE)
    ? JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8"))
    : {};

  data[pkg] = { alias: alias || pkg };

  fs.writeFileSync(ALLOW_FILE, JSON.stringify(data, null, 2));
}

function removeAllowedPackage(pkg) {
  if (!fs.existsSync(ALLOW_FILE)) return;

  const data = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8"));
  delete data[pkg];

  fs.writeFileSync(ALLOW_FILE, JSON.stringify(data, null, 2));
}

function listAllowedPackages() {
  if (!fs.existsSync(ALLOW_FILE)) return [];

  const data = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8"));
  return Object.entries(data).map(([pkg, meta]) => ({
    pkg,
    alias: meta.alias || pkg
  }));
}

module.exports = {
  loadAllowedPackages,
  saveAllowedPackage,
  removeAllowedPackage,
  listAllowedPackages
};
