"use strict";

const vm = require("vm");
const util = require("util");
const { loadAllowedPackages } = require("./packageLoader");

/* ================= BASE SAFE GLOBALS ================= */

function createContext(extraGlobals = {}) {
  const injectedPackages = loadAllowedPackages();

  return vm.createContext({
    // JS built-ins
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    JSON,
    RegExp,
    Promise,

    // allowed packages (aliased)
    ...injectedPackages,

    // admin-only extras (conditionally injected)
    ...extraGlobals,

    console: Object.freeze({
      log() {},
      warn() {},
      error() {}
    }),

    setTimeout,
    clearTimeout
  });
}

/* ================= ABUSE DETECTION ================= */

function detectAbuse(code) {
  const blocked = [
    /\bprocess\b/,
    /\brequire\s*\(/,
    /\bimport\b/,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /\bconstructor\b/,
    /\b__proto__\b/,
    /\bglobalThis\b/,
    /\bglobal\b/,
    /\bchild_process\b/,
    /\bfs\b/,
    /\bnet\b/,
    /\bcluster\b/,
    /\bwhile\s*\(\s*true\s*\)/,
    /\bfor\s*\(\s*;\s*;\s*\)/
  ];

  return blocked.some(rx => rx.test(code));
}

/* ================= RUNNER ================= */

async function runJS(code, options = {}) {
  try {
    if (detectAbuse(code)) {
      throw new Error("Unsafe operation detected");
    }

    const context = createContext(options.globals || {});

    const wrapped = `
      (async () => {
        "use strict";
        ${code}
      })()
    `;

    const script = new vm.Script(wrapped);
    const result = await script.runInContext(context, { timeout: 1000 });

    return typeof result === "string"
      ? result
      : util.inspect(result, { depth: 1 });

  } catch (err) {
    return err.message;
  }
}

module.exports = { runJS };
