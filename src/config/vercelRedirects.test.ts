import { describe, it, expect } from "vitest";
import vercelConfig from "../../vercel.json";

interface Redirect {
  source: string;
  has?: { type: string; value: string }[];
  destination: string;
  permanent?: boolean;
}

const redirects = (vercelConfig as { redirects: Redirect[] }).redirects;

function ruleForHost(host: string): Redirect {
  const rule = redirects.find((r) => r.has?.some((h) => h.type === "host" && h.value === host));
  if (!rule) throw new Error(`no redirect for ${host}`);
  return rule;
}

/**
 * Whether a redirect source matches a path. The sources here are a single
 * unnamed group, which path-to-regexp turns into ^<source>$ unchanged.
 */
function matches(rule: Redirect, path: string): boolean {
  expect(rule.source).toMatch(/^\/\(.*\)$/);
  return new RegExp(`^${rule.source}$`).test(path);
}

describe("vercel.json redirects", () => {
  const oldHost = ruleForHost("m-bhr.vercel.app");

  it("sends page addresses on the old host to mbhr.app", () => {
    expect(oldHost.destination).toBe("https://mbhr.app/$1");
    expect(oldHost.permanent).toBe(true);
    for (const path of ["/", "/login", "/patients", "/patients/01J8Z", "/reset-password", "/admin/conflicts"]) {
      expect(matches(oldHost, path)).toBe(true);
    }
  });

  it("serves the service worker, its files and the app files on the old host, so installed apps update", () => {
    for (const path of [
      "/sw.js",
      "/workbox-5a1b2c3d.js",
      "/manifest.webmanifest",
      "/registerSW.js",
      "/index.html",
      "/assets/index-abc123.js",
      "/assets/index-abc123.css",
      "/pwa-192x192.png",
      "/favicon.ico",
    ]) {
      expect(matches(oldHost, path)).toBe(false);
    }
  });

  it("still sends every path on www.mbhr.app to mbhr.app", () => {
    const www = ruleForHost("www.mbhr.app");
    for (const path of ["/", "/sw.js", "/assets/index-abc123.js"]) {
      expect(matches(www, path)).toBe(true);
    }
  });
});
