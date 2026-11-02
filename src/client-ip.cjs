"use strict";
const net = require("node:net");
const { fail } = require("./util.cjs");

// Normalize addresses before using them as quota keys. Never treat HTTP headers
// as an identity unless the immediate TCP peer was explicitly configured.
function canonicalIp(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (net.isIP(value) === 4) return value;
  if (net.isIP(value) !== 6 || value.includes("%")) return null;
  let ip;
  try {
    ip = new URL("http://[" + value + "]/").hostname.slice(1, -1);
  } catch {
    return null;
  }
  if (ip.startsWith("::ffff:")) {
    const hex = ip.slice(7).split(":");
    if (hex.length === 2) {
      const a = parseInt(hex[0], 16), b = parseInt(hex[1], 16);
      return [a >>> 8, a & 255, b >>> 8, b & 255].join(".");
    }
  }
  return ip;
}

function trustedProxyIps(value = "") {
  const entries = Array.isArray(value) ? value : String(value).split(",");
  const result = new Set();
  for (const entry of entries) {
    if (entry === "" && entries.length === 1) continue;
    const ip = canonicalIp(entry.trim());
    if (!ip) throw new Error("METIS_TRUSTED_PROXY_IPS : adresse IP invalide.");
    result.add(ip);
  }
  return result;
}

function clientIp(req, trusted) {
  const peer = canonicalIp(req.socket.remoteAddress) || "unknown";
  if (!trusted.has(peer)) return peer; // Untrusted peers cannot spoof XFF.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || !forwarded || forwarded.length > 1024)
    fail("INVALID_PROXY_HEADER", "En-tête IP du proxy manquant ou invalide.", 400);
  const hops = forwarded.split(",");
  if (hops.length > 16)
    fail("INVALID_PROXY_HEADER", "Chaîne de proxys trop longue.", 400);
  const ips = hops.map((hop) => canonicalIp(hop.trim()));
  if (ips.some((ip) => !ip))
    fail("INVALID_PROXY_HEADER", "Adresse IP transmise invalide.", 400);
  // Rightmost untrusted hop is the real client when trusted proxies append
  // the peer they observed. Earlier attacker-supplied hops are ignored.
  for (let i = ips.length - 1; i >= 0; i--)
    if (!trusted.has(ips[i])) return ips[i];
  fail("INVALID_PROXY_HEADER", "Adresse du client absente.", 400);
}
module.exports = { canonicalIp, trustedProxyIps, clientIp };
