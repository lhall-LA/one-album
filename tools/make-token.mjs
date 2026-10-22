#!/usr/bin/env node
// Makes an Apple MusicKit developer token (a signed JWT) from your .p8 key.
// Runs on Windows, Mac or Linux with Node 18+. No packages needed.
//
// Usage:
//   node tools/make-token.mjs --team ABCDE12345 --key XYZ987WVU6 --p8 C:\keys\AuthKey_XYZ987WVU6.p8 --origin https://yourname.github.io
//
// --team    Your Apple Developer Team ID (top right of developer.apple.com/account)
// --key     The Key ID of your MusicKit key
// --p8      Path to the .p8 file you downloaded. NEVER commit this file.
// --origin  The site the token is allowed on (recommended). Repeat for several.
// --days    Lifetime in days, max 180 (default 180). Make a new one before it expires.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : undefined; };
const all = (name) => args.flatMap((a, i) => (a === "--" + name ? [args[i + 1]] : []));

const team = opt("team"), kid = opt("key"), p8 = opt("p8");
const origins = all("origin");
const days = Math.min(180, Number(opt("days") || 180));

if (!team || !kid || !p8) {
  console.error("Missing --team, --key or --p8. See the top of this file for usage.");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: "ES256", kid };
const payload = { iss: team, iat: now, exp: now + days * 86400 };
if (origins.length) payload.origin = origins;

const b64 = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
const unsigned = `${b64(header)}.${b64(payload)}`;
const key = createPrivateKey(readFileSync(p8));
const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");

console.log(`${unsigned}.${signature}`);
console.error(`\nToken valid until ${new Date((now + days * 86400) * 1000).toDateString()}` +
  (origins.length ? ` · locked to ${origins.join(", ")}` : " · not locked to a site (add --origin)"));
console.error("Paste it into config.js as developerToken.");
