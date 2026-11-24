import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCardThumbnailHtml } from "../src/features/chat/ArtifactCard";
import { splitChatAndArtifact } from "../src/lib/codefiles";

describe("ArtifactCard thumbnail & lifecycle safety", () => {
  it("injects sandbox shim at head start and 1280x720 viewport lock at head end", () => {
    const html = buildCardThumbnailHtml([
      {
        path: "index.html",
        language: "html",
        content:
          "<!doctype html><html><head><title>Login</title><style>body{min-height:3000px;overflow-y:scroll}</style></head><body><h1>Hi</h1><script>localStorage.getItem('x')</script></body></html>",
      },
    ]);

    expect(html).not.toBeNull();
    const shimIdx = html!.indexOf("data-oh-thumb-shim");
    const pageStyleIdx = html!.indexOf("min-height:3000px");
    const lockIdx = html!.indexOf("data-oh-thumb-lock");

    expect(shimIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(pageStyleIdx);
    expect(html).toContain("width:1280px!important;height:720px!important");
    expect(html).not.toContain("PREVIEW_STUDIO_BRIDGE");
  });

  it("keeps fallback build steps and title in English across streaming -> finished", () => {
    const partial = "Sure!\n\n```html index.html\n<!doctype html><html><head><title>Orbit</title><style>body{}</style></head><body>";
    const finished = `${partial}<div>Play</div><script>console.log(1)</script></body></html>\n\`\`\`\n\nAll done!`;

    const mid = splitChatAndArtifact(partial, true, "en");
    expect(mid.isBuilding).toBe(true);
    expect(mid.hasCode).toBe(true);
    expect(mid.title).toBe("Orbit");
    expect(mid.steps.every((s) => !/[\u0600-\u06FF]/.test(s.label))).toBe(true);

    const done = splitChatAndArtifact(finished, false, "en");
    expect(done.isBuilding).toBe(false);
    expect(done.hasCode).toBe(true);
    expect(done.title).toBe("Orbit");
    expect(done.completedSteps).toBe(done.steps.length);
    expect(done.steps.every((s) => !/[\u0600-\u06FF]/.test(s.label))).toBe(true);
  });

  it("isolates the thumbnail iframe layer and avoids broken color-mix fallbacks in .brc CSS", () => {
    const css = readFileSync(path.resolve(__dirname, "../src/index.css"), "utf8");
    const start = css.indexOf("/* ---- Build Result Card");
    expect(start).toBeGreaterThan(-1);
    const brcCss = css.slice(start);

    expect(brcCss).not.toContain("color-mix(");
    expect(brcCss).toContain("contain: strict;");
    expect(brcCss).toContain("clip-path: inset(0);");
    expect(brcCss).toContain(".brc-shot-stage");
    expect(brcCss).toContain("z-index: 3;");
  });
});
