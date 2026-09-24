import { describe, it, expect } from "vitest";
import { escapeHtml, textToHtml } from "./html";

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;",
    );
  });

  it("turns a script tag into visible text", () => {
    const out = escapeHtml("<script>alert(1)</script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes an ampersand that is already part of an entity", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text, digits and links unchanged", () => {
    expect(escapeHtml("123456")).toBe("123456");
    expect(escapeHtml("Hi Ada, your portal is ready.")).toBe(
      "Hi Ada, your portal is ready.",
    );
    expect(
      escapeHtml("https://app.example.com/patient/register?email=a%40b.ng"),
    ).toBe("https://app.example.com/patient/register?email=a%40b.ng");
  });

  it("turns non-text values into text and null or undefined into nothing", () => {
    expect(escapeHtml(123456)).toBe("123456");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("textToHtml", () => {
  it("keeps line breaks as <br> and escapes everything else", () => {
    expect(textToHtml("Hi <b>Ada</b>,\n\nClick & go\r\nBye\rNow")).toBe(
      "Hi &lt;b&gt;Ada&lt;/b&gt;,<br><br>Click &amp; go<br>Bye<br>Now",
    );
  });

  it("cannot be used to add an image, link or script", () => {
    const out = textToHtml(
      `<img src=x onerror="alert(1)">\n<a href="https://evil.example">x</a>`,
    );
    expect(out).not.toMatch(/<(?!br>)/);
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("returns an empty string for null or undefined", () => {
    expect(textToHtml(null)).toBe("");
    expect(textToHtml(undefined)).toBe("");
  });
});
