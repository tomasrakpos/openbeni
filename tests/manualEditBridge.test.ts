import { describe, expect, it } from "vitest";
import { PREVIEW_STUDIO_BRIDGE_SCRIPT } from "@/features/preview/previewBridge";
import { buildPreviewHtml } from "@/lib/previewHtml";

function extractBridgeJs(): string {
  const match = PREVIEW_STUDIO_BRIDGE_SCRIPT.match(
    /^<script\b[^>]*>([\s\S]*?)<\/script>$/,
  );
  if (!match?.[1]) {
    throw new Error("Could not extract script body from PREVIEW_STUDIO_BRIDGE_SCRIPT");
  }
  return match[1];
}

describe("Preview Studio Manual Edit bridge", () => {
  it("contains syntactically valid JavaScript inside the injected <script> tag", () => {
    const js = extractBridgeJs();
    expect(() => new Function(js)).not.toThrow();
  });

  it("strips studio cursor, overlays, inline-edit attributes, and data-oh-* during exportCleanHtml", () => {
    const js = extractBridgeJs();
    expect(js).toContain('clone.style.removeProperty("cursor")');
    expect(js).toContain('clone.querySelectorAll("[data-oh-inline-edit]")');
    expect(js).toContain('inlineNodes[ie].removeAttribute("contenteditable")');
    expect(js).toContain('clone.attributes[ra].name.indexOf("data-oh-") === 0');
  });

  it("handles zero opacity and zero gradient angle without falling back to defaults", () => {
    const js = extractBridgeJs();
    expect(js).toContain("var opRaw = parseFloat(cs.opacity);");
    expect(js).toContain("isFinite(opRaw) ? Math.max(0, Math.min(1, opRaw)) : 1");
    expect(js).toContain("var gaRaw = el.dataset.ohGa !== undefined ? parseFloat(el.dataset.ohGa) : 135;");
    expect(js).toContain("var gradAngle = isFinite(gaRaw) ? gaRaw : 135;");
  });

  it("supports undo/redo history, inline text editing, arrow nudge, and element-specific attributes", () => {
    const js = extractBridgeJs();
    expect(js).toContain("function performUndo()");
    expect(js).toContain("function performRedo()");
    expect(js).toContain("function startInlineEdit(el)");
    expect(js).toContain("function finishInlineEdit(commit)");
    expect(js).toContain('data.type === "undo"');
    expect(js).toContain('data.type === "redo"');
    expect(js).toContain('data.type === "nudge"');
    expect(js).toContain('data.type === "mark-saved"');
    expect(js).toContain('typeof patch.imgSrc === "string"');
    expect(js).toContain('typeof patch.href === "string"');
    expect(js).toContain('if (tag === "textarea")');
    expect(js).toContain("el.textContent = nextText;");
  });

  it("blocks underlying mousedown/submit interactions and ignores touch hover stickiness in pick mode", () => {
    const js = extractBridgeJs();
    expect(js).toContain('document.addEventListener("mousedown"');
    expect(js).toContain('document.addEventListener("submit"');
    expect(js).toContain('if (e.pointerType === "touch") return;');
    expect(js).toContain("window.__ohStudioMode = mode;");
  });

  it("supports mobile tap selection and touch-hold highlight scrubbing without breaking scroll", () => {
    const js = extractBridgeJs();
    expect(js).toContain('document.addEventListener("touchstart"');
    expect(js).toContain('document.addEventListener("touchmove"');
    expect(js).toContain('document.addEventListener("touchend"');
    expect(js).toContain("function setPickCursorStyle(active)");
    expect(js).toContain("function highlightTouchAt(clientX, clientY)");
  });

  it("disables mobile horizontal pager swipe inside buildPreviewHtml when studio mode is active", () => {
    const built = buildPreviewHtml([
      {
        path: "index.html",
        language: "html",
        content: "<!doctype html><html><head><title>Test</title></head><body><h1>Hi</h1></body></html>",
      },
    ]);
    expect(built.runnable).toBe(true);
    expect(built.html).toContain('if(window.__ohStudioMode&&window.__ohStudioMode!=="off")return;');
    expect(built.html).toContain('data-oh-studio-bridge="1"');
  });
});
