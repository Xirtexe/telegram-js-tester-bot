const util = require("util");

/**
 * Executes user-provided JS safely scoped inside an async function.
 * NOTE: This is NOT sandboxed. Do NOT expose to untrusted users publicly.
 */
async function runJS(code) {
  try {
    const wrapped = `(async () => { ${code} })()`;
    let result = await eval(wrapped);

    if (typeof result !== "string") {
      result = util.inspect(result, { depth: 1 });
    }

    console.log(result)

    return result;
  } catch (err) {
    return util.format(err);
  }
}

module.exports = { runJS };

