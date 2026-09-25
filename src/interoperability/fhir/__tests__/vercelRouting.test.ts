// @vitest-environment node
import { describe, expect, it } from "vitest";
import vercelConfig from "../../../../vercel.json";

interface Rewrite {
  source: string;
  destination: string;
}

const rewrites = (vercelConfig as { rewrites: Rewrite[] }).rewrites;

describe("vercel.json routes /fhir/R4 to the gateway", () => {
  it("sends /fhir/R4 and everything under it to the function, before the app fallback", () => {
    const fhir = rewrites.findIndex((r) => r.source === "/fhir/R4/:path*");
    const base = rewrites.findIndex((r) => r.source === "/fhir/R4");
    const spa = rewrites.findIndex((r) => r.destination === "/index.html");
    expect(fhir).toBeGreaterThanOrEqual(0);
    expect(base).toBeGreaterThanOrEqual(0);
    expect(fhir).toBeLessThan(spa);
    expect(base).toBeLessThan(spa);
    expect(rewrites[fhir].destination).toBe("/api/fhir?__fhir_path=:path*");
  });
});
