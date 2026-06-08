#!/usr/bin/env node
// Generates mkcert TLS certificates for this machine and writes them to certs/.
// Run via: npm run gencerts
// Prerequisite: mkcert must be installed and `mkcert -install` must have been run.

const { execSync } = require("child_process");
const os = require("os");
const path = require("path");

function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

const certsDir = path.join(__dirname, "..", "certs");
const hostname = os.hostname();
const lanIp = getLanIp();

const names = ["localhost", "127.0.0.1", hostname];
if (lanIp) names.push(lanIp);

const cmd = [
  "mkcert",
  `-cert-file "${path.join(certsDir, "cert.pem")}"`,
  `-key-file "${path.join(certsDir, "key.pem")}"`,
  ...names,
].join(" ");

console.log(`Generating certs for: ${names.join(", ")}`);
console.log(`Running: ${cmd}\n`);

try {
  execSync(cmd, { stdio: "inherit" });
  console.log("\nDone. Restart the app to pick up the new certificates.");
} catch {
  process.exit(1);
}
