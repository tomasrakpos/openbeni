const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const file = path.join(process.env.USERPROFILE, ".local", "share", "opencode", "opencode.db");
const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare("select data from session_message").all();
const PATTERN = /coa_[A-Za-z0-9]{16,}/g;
const found = new Set();
for (const row of rows) {
  for (const match of row.data.matchAll(PATTERN)) found.add(match[0]);
}
if (found.size === 0) {
  console.log("no keys found");
  process.exit(0);
}
const envPath = path.join(__dirname, "..", ".env");
let env = fs.readFileSync(envPath, "utf8");
if (/^COARENA_KEYS=/m.test(env)) {
  env = env.replace(/^COARENA_KEYS=.*$/m, `COARENA_KEYS=${[...found].join(",")}`);
} else {
  env = env.trimEnd() + `\nCOARENA_KEYS=${[...found].join(",")}\n`;
}
fs.writeFileSync(envPath, env);
console.log(`wrote ${found.size} key(s) to .env`);
