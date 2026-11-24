// Self-contained studio bridge injected into the sandboxed preview iframe.
// Uses !important inline overrides & smart inline->inline-block promotion so
// every visual edit works reliably, plus live HTML/CSS/JS component injection.

export type PreviewStudioMode = "off" | "capture" | "ai-pick" | "manual-edit";
export type ShadowPreset = "none" | "soft" | "medium" | "strong" | "glow";
export type TextShadowPreset = "none" | "soft" | "strong" | "glow";
export type BorderStyleKind = "solid" | "dashed" | "dotted";
export type TextTransformKind = "none" | "uppercase" | "lowercase" | "capitalize";
export type FillModeKind = "solid" | "gradient" | "transparent";
export type DisplayModeKind = "auto" | "block" | "flex" | "grid" | "inline-block";
export type FlexDirKind = "row" | "column";
export type OverflowKind = "visible" | "hidden" | "auto";
export type CursorKind = "auto" | "pointer" | "grab";
export type DirKind = "auto" | "ltr" | "rtl";
export type JustifyKind = "flex-start" | "center" | "flex-end" | "space-between";
export type AlignItemsKind = "stretch" | "flex-start" | "center" | "flex-end";
export type ObjectFitKind = "cover" | "contain" | "fill";
export type CodeInjectMode = "replace" | "inside" | "css" | "js";

export interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ElementStylesSnapshot {
  width: string;
  height: string;
  widthPx: number;
  heightPx: number;
  fillMode: FillModeKind;
  backgroundColor: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  color: string;
  align: "left" | "center" | "right";
  dir: DirKind;
  displayMode: DisplayModeKind;
  flexDirection: FlexDirKind;
  justifyContent: JustifyKind;
  alignItems: AlignItemsKind;
  overflow: OverflowKind;
  cursor: CursorKind;
  gapPx: number;
  fontSizePx: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacingPx: number;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  textTransform: TextTransformKind;
  textShadow: TextShadowPreset;
  borderRadiusPx: number;
  borderWidthPx: number;
  borderStyle: BorderStyleKind;
  borderColor: string;
  paddingX: number;
  paddingY: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  opacityPct: number;
  offsetX: number;
  offsetY: number;
  rotateDeg: number;
  scalePct: number;
  skewXDeg: number;
  zIndex: number;
  shadowPreset: ShadowPreset;
  backdropBlurPx: number;
  brightnessPct: number;
  contrastPct: number;
  saturatePct: number;
  hueRotateDeg: number;
  grayscalePct: number;
  hidden: boolean;
  hasParent: boolean;
  objectFit: ObjectFitKind;
}

export interface SelectedElementInfo {
  selectionKey: string;
  tag: string;
  id: string;
  classes: string[];
  label: string;
  selector: string;
  text: string;
  hasEditableText: boolean;
  imgSrc?: string;
  imgAlt?: string;
  href?: string;
  targetBlank?: boolean;
  outerHtml: string;
  rect: ElementRect;
  styles: ElementStylesSnapshot;
}

export interface ElementStylePatch {
  text?: string;
  imgSrc?: string;
  imgAlt?: string;
  objectFit?: ObjectFitKind;
  href?: string;
  targetBlank?: boolean;
  align?: "left" | "center" | "right";
  dir?: DirKind;
  displayMode?: DisplayModeKind;
  flexDirection?: FlexDirKind;
  justifyContent?: JustifyKind;
  alignItems?: AlignItemsKind;
  overflow?: OverflowKind;
  cursor?: CursorKind;
  gapPx?: number;
  width?: string;
  height?: string;
  fillMode?: FillModeKind;
  backgroundColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  color?: string;
  fontSizePx?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacingPx?: number;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  textTransform?: TextTransformKind;
  textShadow?: TextShadowPreset;
  borderRadiusPx?: number;
  borderWidthPx?: number;
  borderStyle?: BorderStyleKind;
  borderColor?: string;
  paddingX?: number;
  paddingY?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  opacityPct?: number;
  offsetX?: number;
  offsetY?: number;
  rotateDeg?: number;
  scalePct?: number;
  skewXDeg?: number;
  zIndex?: number;
  shadowPreset?: ShadowPreset;
  backdropBlurPx?: number;
  brightnessPct?: number;
  contrastPct?: number;
  saturatePct?: number;
  hueRotateDeg?: number;
  grayscalePct?: number;
  hidden?: boolean;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StudioFromIframeMessage =
  | { __ohStudio: true; type: "element-selected"; mode: "ai-pick" | "manual-edit"; info: SelectedElementInfo }
  | { __ohStudio: true; type: "element-synced"; info: SelectedElementInfo }
  | { __ohStudio: true; type: "selection-cleared" }
  | { __ohStudio: true; type: "history-state"; canUndo: boolean; canRedo: boolean; dirty: boolean }
  | { __ohStudio: true; type: "element-rect"; rect: ElementRect }
  | { __ohStudio: true; type: "element-deleted" }
  | { __ohStudio: true; type: "element-duplicated" }
  | { __ohStudio: true; type: "code-applied"; ok: boolean; error?: string }
  | { __ohStudio: true; type: "capture-result"; requestId: string; dataUrl: string }
  | { __ohStudio: true; type: "capture-error"; requestId: string; message: string }
  | { __ohStudio: true; type: "export-html-result"; requestId: string; html: string };

export const PREVIEW_STUDIO_BRIDGE_SCRIPT = `<script data-oh-studio-bridge="1">
(function(){
  if (window.__ohStudioBridge) return;
  window.__ohStudioBridge = true;
  window.__ohStudioMode = "off";

  var mode = "off";
  var hoveredEl = null;
  var selectedEl = null;
  var originalSnapshot = null;
  var selectionSeq = 0;
  var customRuleSeq = 0;
  var rectRaf = 0;
  var inlineEditingEl = null;
  var inlineEditBeforeText = "";
  var resizeObs = null;

  var MAX_HISTORY = 40;
  var undoStack = [];
  var redoStack = [];
  var historyVersion = 0;
  var savedHistoryVersion = 0;
  var patchUndoTimer = 0;

  var hoverBox = null;
  var hoverTag = null;
  var selectBox = null;
  var selectTag = null;

  var SHADOW_MAP = {
    none: "none",
    soft: "0 4px 16px rgba(0,0,0,0.16)",
    medium: "0 12px 30px -6px rgba(0,0,0,0.32)",
    strong: "0 24px 52px -10px rgba(0,0,0,0.55)",
    glow: "0 0 28px rgba(124,77,255,0.62)"
  };

  var TEXT_SHADOW_MAP = {
    none: "none",
    soft: "0 2px 8px rgba(0,0,0,0.28)",
    strong: "0 4px 14px rgba(0,0,0,0.62)",
    glow: "0 0 14px rgba(155,114,255,0.75)"
  };

  function setImp(el, prop, val) {
    if (val === "" || val === null || val === undefined) {
      el.style.removeProperty(prop);
    } else {
      el.style.setProperty(prop, String(val), "important");
    }
  }

  function isOverlayNode(el) {
    if (!el || el.nodeType !== 1) return false;
    return Boolean(el.closest && el.closest("[data-oh-studio-ui]"));
  }

  function ensureOverlays() {
    if (!document.body) return;
    if (!hoverBox) {
      hoverBox = document.createElement("div");
      hoverBox.setAttribute("data-oh-studio-ui", "1");
      hoverBox.style.cssText = [
        "position:fixed",
        "left:0",
        "top:0",
        "width:0",
        "height:0",
        "pointer-events:none",
        "z-index:2147483645",
        "border:1.5px solid #3b82f6",
        "background:rgba(59,130,246,0.11)",
        "border-radius:4px",
        "box-shadow:0 0 0 1px rgba(255,255,255,0.22) inset",
        "display:none",
        "will-change:transform,width,height",
        "transition:transform 45ms linear,width 45ms linear,height 45ms linear"
      ].join(";");
      hoverTag = document.createElement("div");
      hoverTag.setAttribute("data-oh-studio-ui", "1");
      hoverTag.style.cssText = [
        "position:absolute",
        "left:-1px",
        "top:-22px",
        "padding:2px 7px",
        "border-radius:6px",
        "background:#2563eb",
        "color:#fff",
        "font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
        "white-space:nowrap",
        "max-width:220px",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "box-shadow:0 4px 12px rgba(37,99,235,0.35)"
      ].join(";");
      hoverBox.appendChild(hoverTag);
    }
    if (hoverBox && !document.body.contains(hoverBox)) {
      document.body.appendChild(hoverBox);
    }
    if (!selectBox) {
      selectBox = document.createElement("div");
      selectBox.setAttribute("data-oh-studio-ui", "1");
      selectBox.style.cssText = [
        "position:fixed",
        "left:0",
        "top:0",
        "width:0",
        "height:0",
        "pointer-events:none",
        "z-index:2147483646",
        "border:2px solid #2563eb",
        "background:rgba(59,130,246,0.07)",
        "border-radius:5px",
        "box-shadow:0 0 0 3px rgba(59,130,246,0.20)",
        "display:none",
        "will-change:transform,width,height"
      ].join(";");
      selectTag = document.createElement("div");
      selectTag.setAttribute("data-oh-studio-ui", "1");
      selectTag.style.cssText = [
        "position:absolute",
        "left:-2px",
        "top:-22px",
        "padding:2px 7px",
        "border-radius:6px",
        "background:#1d4ed8",
        "color:#fff",
        "font:600 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
        "white-space:nowrap",
        "max-width:260px",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "box-shadow:0 4px 12px rgba(29,78,216,0.35)"
      ].join(";");
      selectBox.appendChild(selectTag);
    }
    if (selectBox && !document.body.contains(selectBox)) {
      document.body.appendChild(selectBox);
    }
  }

  function hideOverlays() {
    if (hoverBox) hoverBox.style.display = "none";
    if (selectBox) selectBox.style.display = "none";
  }

  function positionBox(box, rect, tagNode, tagText) {
    if (!box) return;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.transform = "translate3d(" + rect.left.toFixed(1) + "px," + rect.top.toFixed(1) + "px,0)";
    box.style.width = rect.width.toFixed(1) + "px";
    box.style.height = rect.height.toFixed(1) + "px";
    if (tagNode) {
      tagNode.textContent = tagText || "";
      tagNode.style.top = rect.top < 26 ? (rect.height + 4) + "px" : "-22px";
    }
  }

  function syncSelectOverlay() {
    if (!selectedEl || !document.contains(selectedEl)) {
      if (selectBox) selectBox.style.display = "none";
      return;
    }
    ensureOverlays();
    var r = selectedEl.getBoundingClientRect();
    var editing = inlineEditingEl === selectedEl;
    if (selectBox) {
      selectBox.style.borderColor = editing ? "#10b981" : "#2563eb";
      selectBox.style.background = editing ? "rgba(16,185,129,0.06)" : "rgba(59,130,246,0.07)";
      selectBox.style.boxShadow = editing
        ? "0 0 0 3px rgba(16,185,129,0.24)"
        : "0 0 0 3px rgba(59,130,246,0.20)";
    }
    if (selectTag) {
      selectTag.style.background = editing ? "#059669" : "#1d4ed8";
    }
    var dims = Math.round(r.width) + "×" + Math.round(r.height);
    var label = editing
      ? describeElement(selectedEl) + " · editing"
      : describeElement(selectedEl) + " · " + dims;
    positionBox(selectBox, r, selectTag, label);
  }

  function observeSelectedEl(el) {
    if (resizeObs) {
      try { resizeObs.disconnect(); } catch (_) {}
      resizeObs = null;
    }
    if (!el || typeof window.ResizeObserver !== "function") return;
    try {
      resizeObs = new window.ResizeObserver(function() {
        scheduleRectSync();
      });
      resizeObs.observe(el);
    } catch (_) {}
  }

  function captureHistoryState() {
    if (!document.body) return null;
    var bodyClone = document.body.cloneNode(true);
    var uiNodes = bodyClone.querySelectorAll("[data-oh-studio-ui]");
    for (var i = 0; i < uiNodes.length; i++) {
      uiNodes[i].parentNode && uiNodes[i].parentNode.removeChild(uiNodes[i]);
    }
    var inlineNodes = bodyClone.querySelectorAll("[data-oh-inline-edit]");
    for (var j = 0; j < inlineNodes.length; j++) {
      inlineNodes[j].removeAttribute("contenteditable");
      inlineNodes[j].removeAttribute("data-oh-inline-edit");
    }
    var cssStyles = [];
    var styleEls = document.querySelectorAll('style[data-oh-custom-css="1"]');
    for (var s = 0; s < styleEls.length; s++) {
      cssStyles.push(styleEls[s].textContent || "");
    }
    return {
      bodyHtml: bodyClone.innerHTML,
      customCss: cssStyles,
      version: historyVersion
    };
  }

  function notifyHistory() {
    window.parent.postMessage({
      __ohStudio: true,
      type: "history-state",
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      dirty: historyVersion !== savedHistoryVersion
    }, "*");
  }

  function pushUndoSnapshot() {
    if (patchUndoTimer) {
      window.clearTimeout(patchUndoTimer);
      patchUndoTimer = 0;
    }
    var snap = captureHistoryState();
    if (!snap) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    historyVersion += 1;
    notifyHistory();
  }

  function markPatchUndoBoundary() {
    if (!patchUndoTimer) {
      var snap = captureHistoryState();
      if (snap) {
        undoStack.push(snap);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        historyVersion += 1;
        notifyHistory();
      }
    } else {
      window.clearTimeout(patchUndoTimer);
    }
    patchUndoTimer = window.setTimeout(function() {
      patchUndoTimer = 0;
    }, 450);
  }

  function restoreHistoryState(entry) {
    if (!entry || !document.body) return;
    finishInlineEdit(false);
    if (patchUndoTimer) {
      window.clearTimeout(patchUndoTimer);
      patchUndoTimer = 0;
    }
    var oldStyles = document.querySelectorAll('style[data-oh-custom-css="1"]');
    for (var i = 0; i < oldStyles.length; i++) {
      oldStyles[i].parentNode && oldStyles[i].parentNode.removeChild(oldStyles[i]);
    }
    document.body.innerHTML = entry.bodyHtml;
    var headTarget = document.head || document.body;
    for (var j = 0; j < entry.customCss.length; j++) {
      var st = document.createElement("style");
      st.setAttribute("data-oh-custom-css", "1");
      st.textContent = entry.customCss[j];
      headTarget.appendChild(st);
    }
    ensureOverlays();
    historyVersion = entry.version;
    var restoredSel = document.querySelector('[data-oh-sel="1"]');
    if (restoredSel && restoredSel !== document.body && restoredSel !== document.documentElement) {
      selectedEl = restoredSel;
      originalSnapshot = snapshotElement(selectedEl);
      observeSelectedEl(selectedEl);
      selectionSeq += 1;
      syncSelectOverlay();
      window.parent.postMessage({
        __ohStudio: true,
        type: "element-selected",
        mode: mode === "ai-pick" ? "ai-pick" : "manual-edit",
        info: buildElementInfo(selectedEl, "sel-" + selectionSeq)
      }, "*");
    } else {
      selectedEl = null;
      originalSnapshot = null;
      observeSelectedEl(null);
      if (selectBox) selectBox.style.display = "none";
      window.parent.postMessage({ __ohStudio: true, type: "selection-cleared" }, "*");
    }
    notifyHistory();
  }

  function performUndo() {
    if (undoStack.length === 0) return false;
    var current = captureHistoryState();
    var prev = undoStack.pop();
    if (current) {
      redoStack.push(current);
      if (redoStack.length > MAX_HISTORY) redoStack.shift();
    }
    restoreHistoryState(prev);
    return true;
  }

  function performRedo() {
    if (redoStack.length === 0) return false;
    var current = captureHistoryState();
    var next = redoStack.pop();
    if (current) {
      undoStack.push(current);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
    }
    restoreHistoryState(next);
    return true;
  }

  function finishInlineEdit(commit) {
    if (!inlineEditingEl) return;
    var el = inlineEditingEl;
    inlineEditingEl = null;
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-oh-inline-edit");
    if (!commit) {
      setDirectText(el, inlineEditBeforeText);
    }
    syncSelectOverlay();
    if (selectedEl === el && document.contains(el)) {
      window.parent.postMessage({
        __ohStudio: true,
        type: "element-synced",
        info: buildElementInfo(el, "sel-" + selectionSeq)
      }, "*");
    }
  }

  function startInlineEdit(el) {
    if (!el || mode !== "manual-edit") return;
    var tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "img" || tag === "svg" || tag === "canvas" || tag === "hr" || tag === "br") return;
    var txt = getDirectText(el);
    if (!txt.editable) return;
    if (inlineEditingEl && inlineEditingEl !== el) finishInlineEdit(true);
    pushUndoSnapshot();
    inlineEditBeforeText = txt.text;
    inlineEditingEl = el;
    el.setAttribute("contenteditable", "true");
    el.setAttribute("data-oh-inline-edit", "1");
    try { el.focus(); } catch (_) {}
    syncSelectOverlay();
  }

  function describeElement(el) {
    var tag = el.tagName.toLowerCase();
    var id = el.id ? "#" + el.id : "";
    var cls = typeof el.className === "string"
      ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map(function(c){ return "." + c; }).join("")
      : "";
    return tag + id + cls;
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + el.id;
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && depth < 6) {
      var tag = cur.tagName.toLowerCase();
      var part = tag;
      if (cur.id) {
        parts.unshift("#" + cur.id);
        break;
      }
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function(child){
          return child.tagName === cur.tagName;
        });
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(cur) + 1) + ")";
        }
      }
      parts.unshift(part);
      cur = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function parseRgba(colorStr) {
    if (!colorStr || colorStr === "transparent" || colorStr === "rgba(0, 0, 0, 0)") {
      return { hex: "#7c4dff", css: "transparent", transparent: true };
    }
    var m = colorStr.match(/rgba?\\(\\s*(\\d+(?:\\.\\d+)?)\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?)\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?)(?:\\s*[,/]\\s*([\\d.]+)(%?))?\\s*\\)/i);
    if (!m) return { hex: "#ffffff", css: colorStr, transparent: false };
    var rawA = m[4] !== undefined ? parseFloat(m[4]) : 1;
    var a = m[5] === "%" ? rawA / 100 : rawA;
    var rN = Math.max(0, Math.min(255, Math.round(parseFloat(m[1]))));
    var gN = Math.max(0, Math.min(255, Math.round(parseFloat(m[2]))));
    var bN = Math.max(0, Math.min(255, Math.round(parseFloat(m[3]))));
    var hex = "#" + [rN, gN, bN].map(function(n){
      var h = n.toString(16);
      return h.length === 1 ? "0" + h : h;
    }).join("");
    if (a < 0.02) return { hex: hex, css: "transparent", transparent: true };
    if (a < 0.99) return { hex: hex, css: "rgba(" + rN + "," + gN + "," + bN + "," + a.toFixed(2) + ")", transparent: false };
    return { hex: hex, css: hex, transparent: false };
  }

  function getDirectText(el) {
    if (!el) return { text: "", editable: false };
    var tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      return { text: el.value || el.placeholder || "", editable: true };
    }
    var directText = "";
    var hasTextNode = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3) {
        var t = node.nodeValue || "";
        if (t.trim()) hasTextNode = true;
        directText += t;
      }
    }
    if (el.children.length === 0) {
      return { text: (el.textContent || "").trim(), editable: tag !== "img" && tag !== "svg" && tag !== "hr" && tag !== "br" && tag !== "canvas" };
    }
    if (hasTextNode) {
      return { text: directText.trim(), editable: true };
    }
    return { text: (el.textContent || "").trim().slice(0, 120), editable: false };
  }

  function setDirectText(el, nextText) {
    var tag = el.tagName.toLowerCase();
    if (tag === "textarea") {
      el.value = nextText;
      el.textContent = nextText;
      return;
    }
    if (tag === "input") {
      el.value = nextText;
      el.setAttribute("value", nextText);
      return;
    }
    if (el.children.length === 0) {
      el.textContent = nextText;
      return;
    }
    var replaced = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3 && (node.nodeValue || "").trim()) {
        if (!replaced) {
          node.nodeValue = nextText;
          replaced = true;
        } else {
          node.nodeValue = "";
        }
      }
    }
    if (!replaced) {
      el.appendChild(document.createTextNode(nextText));
    }
  }

  function detectAlign(el, cs) {
    if (el.dataset.ohAlign === "left" || el.dataset.ohAlign === "center" || el.dataset.ohAlign === "right") {
      return el.dataset.ohAlign;
    }
    var ml = el.style.marginLeft;
    var mr = el.style.marginRight;
    if (ml === "auto" && mr === "auto") return "center";
    if (ml === "auto" && (mr === "0px" || mr === "0")) return "right";
    if (mr === "auto" && (ml === "0px" || ml === "0")) return "left";
    var js = cs.justifySelf;
    if (js === "center") return "center";
    if (js === "end" || js === "flex-end" || js === "right") return "right";
    var as = cs.alignSelf;
    if (as === "center") return "center";
    if (as === "flex-end" || as === "end") return "right";
    if (el.parentElement) {
      var pr = el.parentElement.getBoundingClientRect();
      var er = el.getBoundingClientRect();
      if (pr.width - er.width > 24) {
        var leftGap = er.left - pr.left;
        var rightGap = pr.right - er.right;
        if (Math.abs(leftGap - rightGap) <= 12) return "center";
        if (rightGap + 12 < leftGap) return "right";
        return "left";
      }
    }
    var ta = cs.textAlign;
    if (ta === "center") return "center";
    if (ta === "right" || ta === "end") return "right";
    return "left";
  }

  function readTransformData(el) {
    return {
      offsetX: parseFloat(el.dataset.ohTx || "0") || 0,
      offsetY: parseFloat(el.dataset.ohTy || "0") || 0,
      rotateDeg: parseFloat(el.dataset.ohRot || "0") || 0,
      scalePct: parseFloat(el.dataset.ohScale || "100") || 100,
      skewXDeg: parseFloat(el.dataset.ohSkew || "0") || 0
    };
  }

  function writeTransformData(el, data) {
    el.dataset.ohTx = String(data.offsetX);
    el.dataset.ohTy = String(data.offsetY);
    el.dataset.ohRot = String(data.rotateDeg);
    el.dataset.ohScale = String(data.scalePct);
    el.dataset.ohSkew = String(data.skewXDeg);
    if (data.offsetX === 0 && data.offsetY === 0 && data.rotateDeg === 0 && data.scalePct === 100 && data.skewXDeg === 0) {
      setImp(el, "transform", "");
      return;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "inline") setImp(el, "display", "inline-block");
    setImp(
      el,
      "transform",
      "translate3d(" + data.offsetX + "px," + data.offsetY + "px,0) " +
      "rotate(" + data.rotateDeg + "deg) " +
      "scale(" + (data.scalePct / 100).toFixed(3) + ") " +
      "skewX(" + data.skewXDeg + "deg)"
    );
  }

  function readFilterData(el) {
    return {
      brightnessPct: parseFloat(el.dataset.ohBri || "100") || 100,
      contrastPct: parseFloat(el.dataset.ohCon || "100") || 100,
      saturatePct: parseFloat(el.dataset.ohSat || "100") || 100,
      hueRotateDeg: parseFloat(el.dataset.ohHue || "0") || 0,
      grayscalePct: parseFloat(el.dataset.ohGray || "0") || 0
    };
  }

  function writeFilterData(el, data) {
    el.dataset.ohBri = String(data.brightnessPct);
    el.dataset.ohCon = String(data.contrastPct);
    el.dataset.ohSat = String(data.saturatePct);
    el.dataset.ohHue = String(data.hueRotateDeg);
    el.dataset.ohGray = String(data.grayscalePct);
    if (data.brightnessPct === 100 && data.contrastPct === 100 && data.saturatePct === 100 && data.hueRotateDeg === 0 && data.grayscalePct === 0) {
      setImp(el, "filter", "");
      return;
    }
    setImp(
      el,
      "filter",
      "brightness(" + data.brightnessPct + "%) contrast(" + data.contrastPct + "%) saturate(" + data.saturatePct + "%) hue-rotate(" + data.hueRotateDeg + "deg) grayscale(" + data.grayscalePct + "%)"
    );
  }

  function writeGradient(el) {
    var from = el.dataset.ohGf || "#9b72ff";
    var to = el.dataset.ohGt || "#7c4dff";
    var angle = parseFloat(el.dataset.ohGa || "135");
    if (!isFinite(angle)) angle = 135;
    setImp(el, "background-color", "transparent");
    setImp(el, "background-image", "linear-gradient(" + angle + "deg, " + from + ", " + to + ")");
  }

  function buildElementInfo(el, key) {
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var bg = parseRgba(cs.backgroundColor);
    var fg = parseRgba(cs.color);
    var bc = parseRgba(cs.borderTopColor);
    var txt = getDirectText(el);
    var tf = readTransformData(el);
    var flt = readFilterData(el);
    var rawHtml = "";
    try {
      var clone = el.cloneNode(true);
      if (clone.removeAttribute) clone.removeAttribute("data-oh-sel");
      rawHtml = (clone.outerHTML || "").slice(0, 4000);
    } catch (_) {
      rawHtml = "";
    }
    var classes = typeof el.className === "string"
      ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 6)
      : [];
    var fs = Math.round(parseFloat(cs.fontSize) || 14);
    var lhRaw = parseFloat(cs.lineHeight);
    var lineHeight = isFinite(lhRaw) && fs > 0 ? Math.round((lhRaw / fs) * 10) / 10 : 1.4;
    var lsRaw = parseFloat(cs.letterSpacing);
    var letterSpacingPx = isFinite(lsRaw) ? Math.round(lsRaw * 10) / 10 : 0;
    var bStyle = cs.borderTopStyle === "dashed" || cs.borderTopStyle === "dotted" ? cs.borderTopStyle : "solid";
    var tTrans = cs.textTransform === "uppercase" || cs.textTransform === "lowercase" || cs.textTransform === "capitalize"
      ? cs.textTransform
      : "none";
    var blurMatch = (cs.backdropFilter || cs.webkitBackdropFilter || "").match(/blur\\(([\\d.]+)px\\)/i);
    var backdropBlurPx = blurMatch ? Math.round(parseFloat(blurMatch[1]) || 0) : 0;
    var shadowVal = el.dataset.ohShadow || (cs.boxShadow && cs.boxShadow !== "none" ? "soft" : "none");
    var tShadowVal = el.dataset.ohTshadow || (cs.textShadow && cs.textShadow !== "none" ? "soft" : "none");
    var hasGrad = Boolean(cs.backgroundImage && cs.backgroundImage.indexOf("gradient") !== -1);
    var fillMode = el.dataset.ohFill || (hasGrad ? "gradient" : bg.transparent ? "transparent" : "solid");
    var disp = cs.display;
    var displayMode = disp === "flex" || disp === "inline-flex" ? "flex" : disp === "grid" || disp === "inline-grid" ? "grid" : disp === "inline-block" ? "inline-block" : disp === "block" ? "block" : "auto";
    var dec = cs.textDecorationLine || cs.textDecoration || "";
    var zNum = parseInt(cs.zIndex, 10);
    var ov = cs.overflow === "hidden" || cs.overflow === "clip" ? "hidden" : cs.overflow === "auto" || cs.overflow === "scroll" ? "auto" : "visible";
    var cur = cs.cursor === "pointer" ? "pointer" : cs.cursor === "grab" || cs.cursor === "move" ? "grab" : "auto";
    var dirAttr = el.getAttribute("dir");
    var dirVal = dirAttr === "ltr" || dirAttr === "rtl" ? dirAttr : "auto";
    var jc = cs.justifyContent === "center" || cs.justifyContent === "flex-end" || cs.justifyContent === "space-between" ? cs.justifyContent : "flex-start";
    var ai = cs.alignItems === "center" || cs.alignItems === "flex-start" || cs.alignItems === "flex-end" ? cs.alignItems : "stretch";
    var hasParent = Boolean(el.parentElement && el.parentElement !== document.body && el.parentElement !== document.documentElement);
    var tagLower = el.tagName.toLowerCase();
    var opRaw = parseFloat(cs.opacity);
    var opPct = Math.round((isFinite(opRaw) ? Math.max(0, Math.min(1, opRaw)) : 1) * 100);
    var gaRaw = el.dataset.ohGa !== undefined ? parseFloat(el.dataset.ohGa) : 135;
    var gradAngle = isFinite(gaRaw) ? gaRaw : 135;
    var objFit = cs.objectFit === "contain" || cs.objectFit === "fill" ? cs.objectFit : "cover";

    return {
      selectionKey: key,
      tag: tagLower,
      id: el.id || "",
      classes: classes,
      label: describeElement(el),
      selector: buildSelector(el),
      text: txt.text,
      hasEditableText: txt.editable,
      imgSrc: tagLower === "img" ? (el.getAttribute("src") || "") : undefined,
      imgAlt: tagLower === "img" ? (el.getAttribute("alt") || "") : undefined,
      href: tagLower === "a" ? (el.getAttribute("href") || "") : undefined,
      targetBlank: tagLower === "a" ? el.getAttribute("target") === "_blank" : undefined,
      outerHtml: rawHtml,
      rect: {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      },
      styles: {
        width: el.style.width || "auto",
        height: el.style.height || "auto",
        widthPx: Math.round(r.width),
        heightPx: Math.round(r.height),
        fillMode: fillMode,
        backgroundColor: bg.transparent ? "#7c4dff" : bg.css,
        gradientFrom: el.dataset.ohGf || "#9b72ff",
        gradientTo: el.dataset.ohGt || "#7c4dff",
        gradientAngle: gradAngle,
        color: fg.transparent ? "#ffffff" : fg.css,
        align: detectAlign(el, cs),
        dir: dirVal,
        displayMode: displayMode,
        flexDirection: cs.flexDirection === "column" ? "column" : "row",
        justifyContent: jc,
        alignItems: ai,
        overflow: ov,
        cursor: cur,
        gapPx: Math.round(parseFloat(cs.gap) || 0),
        fontSizePx: fs,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        lineHeight: lineHeight,
        letterSpacingPx: letterSpacingPx,
        italic: cs.fontStyle === "italic",
        underline: dec.indexOf("underline") !== -1,
        strikethrough: dec.indexOf("line-through") !== -1,
        textTransform: tTrans,
        textShadow: tShadowVal,
        borderRadiusPx: Math.round(parseFloat(cs.borderRadius) || 0),
        borderWidthPx: Math.round(parseFloat(cs.borderTopWidth) || 0),
        borderStyle: bStyle,
        borderColor: bc.transparent ? "#64748b" : bc.css,
        paddingX: Math.round(parseFloat(cs.paddingLeft) || 0),
        paddingY: Math.round(parseFloat(cs.paddingTop) || 0),
        marginTop: Math.round(parseFloat(cs.marginTop) || 0),
        marginBottom: Math.round(parseFloat(cs.marginBottom) || 0),
        marginLeft: Math.round(parseFloat(cs.marginLeft) || 0),
        marginRight: Math.round(parseFloat(cs.marginRight) || 0),
        opacityPct: opPct,
        offsetX: tf.offsetX,
        offsetY: tf.offsetY,
        rotateDeg: tf.rotateDeg,
        scalePct: tf.scalePct,
        skewXDeg: tf.skewXDeg,
        zIndex: isFinite(zNum) ? zNum : 0,
        shadowPreset: shadowVal,
        backdropBlurPx: backdropBlurPx,
        brightnessPct: flt.brightnessPct,
        contrastPct: flt.contrastPct,
        saturatePct: flt.saturatePct,
        hueRotateDeg: flt.hueRotateDeg,
        grayscalePct: flt.grayscalePct,
        hidden: cs.visibility === "hidden" || el.dataset.ohHidden === "1",
        hasParent: hasParent,
        objectFit: objFit
      }
    };
  }

  var DATA_KEYS = [
    "ohTx","ohTy","ohRot","ohScale","ohSkew","ohShadow","ohTshadow","ohAlign",
    "ohHidden","ohFill","ohGf","ohGt","ohGa","ohBri","ohCon","ohSat","ohHue","ohGray"
  ];

  function snapshotElement(el) {
    var ds = {};
    for (var i = 0; i < DATA_KEYS.length; i++) {
      ds[DATA_KEYS[i]] = el.dataset[DATA_KEYS[i]];
    }
    return {
      styleAttr: el.getAttribute("style"),
      dirAttr: el.getAttribute("dir"),
      srcAttr: el.getAttribute("src"),
      altAttr: el.getAttribute("alt"),
      hrefAttr: el.getAttribute("href"),
      targetAttr: el.getAttribute("target"),
      innerHTML: el.innerHTML,
      value: "value" in el ? el.value : undefined,
      ds: ds
    };
  }

  function ensureResizableDisplay(el, cs) {
    if (cs.display === "inline") {
      setImp(el, "display", "inline-block");
    }
  }

  function applyPatch(patch, skipUndo) {
    if (!selectedEl || !patch) return;
    if (!skipUndo) markPatchUndoBoundary();
    var cs = window.getComputedStyle(selectedEl);

    if (typeof patch.text === "string") {
      setDirectText(selectedEl, patch.text);
    }

    if (typeof patch.imgSrc === "string" && selectedEl.tagName.toLowerCase() === "img") {
      if (patch.imgSrc.trim()) selectedEl.setAttribute("src", patch.imgSrc.trim());
    }
    if (typeof patch.imgAlt === "string" && selectedEl.tagName.toLowerCase() === "img") {
      selectedEl.setAttribute("alt", patch.imgAlt);
    }
    if (typeof patch.objectFit === "string" && selectedEl.tagName.toLowerCase() === "img") {
      setImp(selectedEl, "object-fit", patch.objectFit);
    }
    if (typeof patch.href === "string" && selectedEl.tagName.toLowerCase() === "a") {
      selectedEl.setAttribute("href", patch.href.trim() || "#");
    }
    if (typeof patch.targetBlank === "boolean" && selectedEl.tagName.toLowerCase() === "a") {
      if (patch.targetBlank) {
        selectedEl.setAttribute("target", "_blank");
        selectedEl.setAttribute("rel", "noopener noreferrer");
      } else {
        selectedEl.removeAttribute("target");
      }
    }

    if (typeof patch.dir === "string") {
      if (patch.dir === "auto") selectedEl.removeAttribute("dir");
      else selectedEl.setAttribute("dir", patch.dir);
    }

    if (typeof patch.displayMode === "string") {
      if (patch.displayMode === "auto") setImp(selectedEl, "display", "");
      else setImp(selectedEl, "display", patch.displayMode);
    }

    if (typeof patch.flexDirection === "string") {
      setImp(selectedEl, "display", "flex");
      setImp(selectedEl, "flex-direction", patch.flexDirection);
    }

    if (typeof patch.justifyContent === "string") {
      if (cs.display.indexOf("flex") === -1 && cs.display.indexOf("grid") === -1) {
        setImp(selectedEl, "display", "flex");
      }
      setImp(selectedEl, "justify-content", patch.justifyContent);
    }

    if (typeof patch.alignItems === "string") {
      if (cs.display.indexOf("flex") === -1 && cs.display.indexOf("grid") === -1) {
        setImp(selectedEl, "display", "flex");
      }
      setImp(selectedEl, "align-items", patch.alignItems);
    }

    if (typeof patch.overflow === "string") {
      setImp(selectedEl, "overflow", patch.overflow);
    }

    if (typeof patch.cursor === "string") {
      setImp(selectedEl, "cursor", patch.cursor);
    }

    if (typeof patch.gapPx === "number" && isFinite(patch.gapPx)) {
      if (cs.display.indexOf("flex") === -1 && cs.display.indexOf("grid") === -1) {
        setImp(selectedEl, "display", "flex");
      }
      setImp(selectedEl, "gap", Math.max(0, Math.min(120, patch.gapPx)) + "px");
    }

    if (typeof patch.width === "string") {
      if (patch.width === "auto") {
        setImp(selectedEl, "width", "");
        setImp(selectedEl, "min-width", "");
        setImp(selectedEl, "max-width", "");
      } else {
        ensureResizableDisplay(selectedEl, cs);
        setImp(selectedEl, "box-sizing", "border-box");
        setImp(selectedEl, "min-width", "0px");
        setImp(selectedEl, "max-width", "none");
        setImp(selectedEl, "flex-shrink", "0");
        setImp(selectedEl, "width", patch.width);
      }
    }

    if (typeof patch.height === "string") {
      if (patch.height === "auto") {
        setImp(selectedEl, "height", "");
        setImp(selectedEl, "min-height", "");
        setImp(selectedEl, "max-height", "");
      } else {
        ensureResizableDisplay(selectedEl, cs);
        setImp(selectedEl, "box-sizing", "border-box");
        setImp(selectedEl, "min-height", "0px");
        setImp(selectedEl, "max-height", "none");
        setImp(selectedEl, "height", patch.height);
      }
    }

    if (typeof patch.fillMode === "string") {
      selectedEl.dataset.ohFill = patch.fillMode;
      if (patch.fillMode === "transparent") {
        setImp(selectedEl, "background-image", "none");
        setImp(selectedEl, "background-color", "transparent");
      } else if (patch.fillMode === "gradient") {
        if (patch.gradientFrom) selectedEl.dataset.ohGf = patch.gradientFrom;
        if (patch.gradientTo) selectedEl.dataset.ohGt = patch.gradientTo;
        if (typeof patch.gradientAngle === "number") selectedEl.dataset.ohGa = String(patch.gradientAngle);
        writeGradient(selectedEl);
      } else if (patch.fillMode === "solid" && patch.backgroundColor) {
        setImp(selectedEl, "background-image", "none");
        setImp(selectedEl, "background-color", patch.backgroundColor);
      }
    } else if (typeof patch.backgroundColor === "string") {
      selectedEl.dataset.ohFill = patch.backgroundColor === "transparent" ? "transparent" : "solid";
      setImp(selectedEl, "background-image", "none");
      setImp(selectedEl, "background-color", patch.backgroundColor);
    }

    if (patch.gradientFrom || patch.gradientTo || typeof patch.gradientAngle === "number") {
      if (patch.gradientFrom) selectedEl.dataset.ohGf = patch.gradientFrom;
      if (patch.gradientTo) selectedEl.dataset.ohGt = patch.gradientTo;
      if (typeof patch.gradientAngle === "number") selectedEl.dataset.ohGa = String(patch.gradientAngle);
      selectedEl.dataset.ohFill = "gradient";
      writeGradient(selectedEl);
    }

    if (typeof patch.color === "string") {
      setImp(selectedEl, "color", patch.color);
    }
    if (typeof patch.fontSizePx === "number" && isFinite(patch.fontSizePx)) {
      setImp(selectedEl, "font-size", Math.max(8, Math.min(140, patch.fontSizePx)) + "px");
    }
    if (typeof patch.fontWeight === "number" && isFinite(patch.fontWeight)) {
      setImp(selectedEl, "font-weight", String(patch.fontWeight));
    }
    if (typeof patch.lineHeight === "number" && isFinite(patch.lineHeight)) {
      setImp(selectedEl, "line-height", String(Math.max(0.8, Math.min(3.2, patch.lineHeight))));
    }
    if (typeof patch.letterSpacingPx === "number" && isFinite(patch.letterSpacingPx)) {
      setImp(selectedEl, "letter-spacing", Math.max(-4, Math.min(24, patch.letterSpacingPx)) + "px");
    }
    if (typeof patch.italic === "boolean") {
      setImp(selectedEl, "font-style", patch.italic ? "italic" : "normal");
    }
    if (typeof patch.underline === "boolean" || typeof patch.strikethrough === "boolean") {
      var curDec = cs.textDecorationLine || cs.textDecoration || "";
      var u = typeof patch.underline === "boolean" ? patch.underline : curDec.indexOf("underline") !== -1;
      var s = typeof patch.strikethrough === "boolean" ? patch.strikethrough : curDec.indexOf("line-through") !== -1;
      var parts = [];
      if (u) parts.push("underline");
      if (s) parts.push("line-through");
      setImp(selectedEl, "text-decoration", parts.length ? parts.join(" ") : "none");
    }
    if (typeof patch.textTransform === "string") {
      setImp(selectedEl, "text-transform", patch.textTransform);
    }
    if (typeof patch.textShadow === "string" && TEXT_SHADOW_MAP[patch.textShadow]) {
      selectedEl.dataset.ohTshadow = patch.textShadow;
      setImp(selectedEl, "text-shadow", TEXT_SHADOW_MAP[patch.textShadow]);
    }
    if (typeof patch.borderRadiusPx === "number" && isFinite(patch.borderRadiusPx)) {
      setImp(selectedEl, "border-radius", Math.max(0, Math.min(999, patch.borderRadiusPx)) + "px");
    }
    if (typeof patch.borderWidthPx === "number" && isFinite(patch.borderWidthPx)) {
      var bw = Math.max(0, Math.min(24, patch.borderWidthPx));
      setImp(selectedEl, "border-width", bw + "px");
      if (bw > 0) {
        setImp(selectedEl, "border-style", patch.borderStyle || (cs.borderTopStyle === "none" ? "solid" : cs.borderTopStyle));
        if (patch.borderColor) setImp(selectedEl, "border-color", patch.borderColor);
      } else {
        setImp(selectedEl, "border-style", "none");
      }
    }
    if (typeof patch.borderStyle === "string") {
      setImp(selectedEl, "border-style", patch.borderStyle);
    }
    if (typeof patch.borderColor === "string") {
      setImp(selectedEl, "border-color", patch.borderColor);
    }
    if (typeof patch.paddingX === "number" && isFinite(patch.paddingX)) {
      var px = Math.max(0, Math.min(180, patch.paddingX)) + "px";
      setImp(selectedEl, "padding-left", px);
      setImp(selectedEl, "padding-right", px);
    }
    if (typeof patch.paddingY === "number" && isFinite(patch.paddingY)) {
      ensureResizableDisplay(selectedEl, cs);
      var py = Math.max(0, Math.min(180, patch.paddingY)) + "px";
      setImp(selectedEl, "padding-top", py);
      setImp(selectedEl, "padding-bottom", py);
    }
    if (typeof patch.marginTop === "number" && isFinite(patch.marginTop)) {
      ensureResizableDisplay(selectedEl, cs);
      setImp(selectedEl, "margin-top", Math.max(-80, Math.min(180, patch.marginTop)) + "px");
    }
    if (typeof patch.marginBottom === "number" && isFinite(patch.marginBottom)) {
      ensureResizableDisplay(selectedEl, cs);
      setImp(selectedEl, "margin-bottom", Math.max(-80, Math.min(180, patch.marginBottom)) + "px");
    }
    if (typeof patch.marginLeft === "number" && isFinite(patch.marginLeft)) {
      delete selectedEl.dataset.ohAlign;
      setImp(selectedEl, "margin-left", Math.max(-80, Math.min(180, patch.marginLeft)) + "px");
    }
    if (typeof patch.marginRight === "number" && isFinite(patch.marginRight)) {
      delete selectedEl.dataset.ohAlign;
      setImp(selectedEl, "margin-right", Math.max(-80, Math.min(180, patch.marginRight)) + "px");
    }
    if (typeof patch.opacityPct === "number" && isFinite(patch.opacityPct)) {
      setImp(selectedEl, "opacity", String(Math.max(0, Math.min(100, patch.opacityPct)) / 100));
    }
    if (typeof patch.zIndex === "number" && isFinite(patch.zIndex)) {
      if (cs.position === "static") setImp(selectedEl, "position", "relative");
      setImp(selectedEl, "z-index", String(Math.round(patch.zIndex)));
    }
    if (
      typeof patch.offsetX === "number" ||
      typeof patch.offsetY === "number" ||
      typeof patch.rotateDeg === "number" ||
      typeof patch.scalePct === "number" ||
      typeof patch.skewXDeg === "number"
    ) {
      var curTf = readTransformData(selectedEl);
      if (typeof patch.offsetX === "number" && isFinite(patch.offsetX)) curTf.offsetX = patch.offsetX;
      if (typeof patch.offsetY === "number" && isFinite(patch.offsetY)) curTf.offsetY = patch.offsetY;
      if (typeof patch.rotateDeg === "number" && isFinite(patch.rotateDeg)) curTf.rotateDeg = patch.rotateDeg;
      if (typeof patch.scalePct === "number" && isFinite(patch.scalePct)) curTf.scalePct = patch.scalePct;
      if (typeof patch.skewXDeg === "number" && isFinite(patch.skewXDeg)) curTf.skewXDeg = patch.skewXDeg;
      writeTransformData(selectedEl, curTf);
    }
    if (
      typeof patch.brightnessPct === "number" ||
      typeof patch.contrastPct === "number" ||
      typeof patch.saturatePct === "number" ||
      typeof patch.hueRotateDeg === "number" ||
      typeof patch.grayscalePct === "number"
    ) {
      var curFlt = readFilterData(selectedEl);
      if (typeof patch.brightnessPct === "number" && isFinite(patch.brightnessPct)) curFlt.brightnessPct = patch.brightnessPct;
      if (typeof patch.contrastPct === "number" && isFinite(patch.contrastPct)) curFlt.contrastPct = patch.contrastPct;
      if (typeof patch.saturatePct === "number" && isFinite(patch.saturatePct)) curFlt.saturatePct = patch.saturatePct;
      if (typeof patch.hueRotateDeg === "number" && isFinite(patch.hueRotateDeg)) curFlt.hueRotateDeg = patch.hueRotateDeg;
      if (typeof patch.grayscalePct === "number" && isFinite(patch.grayscalePct)) curFlt.grayscalePct = patch.grayscalePct;
      writeFilterData(selectedEl, curFlt);
    }
    if (typeof patch.shadowPreset === "string" && SHADOW_MAP[patch.shadowPreset]) {
      selectedEl.dataset.ohShadow = patch.shadowPreset;
      setImp(selectedEl, "box-shadow", SHADOW_MAP[patch.shadowPreset]);
    }
    if (typeof patch.backdropBlurPx === "number" && isFinite(patch.backdropBlurPx)) {
      var bl = Math.max(0, Math.min(40, patch.backdropBlurPx));
      var val = bl > 0 ? "blur(" + bl + "px)" : "none";
      setImp(selectedEl, "backdrop-filter", val);
      setImp(selectedEl, "-webkit-backdrop-filter", val);
    }
    if (typeof patch.hidden === "boolean") {
      selectedEl.dataset.ohHidden = patch.hidden ? "1" : "0";
      setImp(selectedEl, "visibility", patch.hidden ? "hidden" : "visible");
    }
    if (patch.align) {
      // Reset any manual Move X drag offset so Left / Center / Right always snaps to the true aligned spot.
      var alignTf = readTransformData(selectedEl);
      if (alignTf.offsetX !== 0 && !(typeof patch.offsetX === "number" && patch.offsetX !== 0)) {
        alignTf.offsetX = 0;
        writeTransformData(selectedEl, alignTf);
      }

      selectedEl.dataset.ohAlign = patch.align;
      var latestCs = window.getComputedStyle(selectedEl);
      var parentCs = selectedEl.parentElement ? window.getComputedStyle(selectedEl.parentElement) : null;
      setImp(selectedEl, "text-align", patch.align);
      setImp(selectedEl, "float", "none");

      if (latestCs.display.indexOf("flex") !== -1) {
        setImp(
          selectedEl,
          "justify-content",
          patch.align === "left" ? "flex-start" : patch.align === "right" ? "flex-end" : "center"
        );
      }

      if (latestCs.position === "absolute" || latestCs.position === "fixed") {
        if (patch.align === "left") {
          setImp(selectedEl, "left", "0px");
          setImp(selectedEl, "right", "auto");
          setImp(selectedEl, "margin-left", "0px");
          setImp(selectedEl, "margin-right", "auto");
        } else if (patch.align === "right") {
          setImp(selectedEl, "left", "auto");
          setImp(selectedEl, "right", "0px");
          setImp(selectedEl, "margin-left", "auto");
          setImp(selectedEl, "margin-right", "0px");
        } else {
          setImp(selectedEl, "left", "0px");
          setImp(selectedEl, "right", "0px");
          setImp(selectedEl, "margin-left", "auto");
          setImp(selectedEl, "margin-right", "auto");
          if (!selectedEl.style.width) {
            var curW = Math.round(selectedEl.getBoundingClientRect().width || selectedEl.offsetWidth || 0);
            if (curW > 0) setImp(selectedEl, "width", curW + "px");
          }
        }
      } else {
        if (latestCs.position === "relative") {
          setImp(selectedEl, "left", "");
          setImp(selectedEl, "right", "");
        }
        var isInline =
          latestCs.display === "inline" ||
          latestCs.display === "inline-flex" ||
          latestCs.display === "inline-block";
        var parentGrid = parentCs && parentCs.display.indexOf("grid") !== -1;
        var parentFlex = parentCs && parentCs.display.indexOf("flex") !== -1;
        if (parentGrid) {
          setImp(
            selectedEl,
            "justify-self",
            patch.align === "left" ? "start" : patch.align === "right" ? "end" : "center"
          );
          setImp(selectedEl, "margin-left", patch.align === "left" ? "0px" : "auto");
          setImp(selectedEl, "margin-right", patch.align === "right" ? "0px" : "auto");
        } else if (parentFlex) {
          if (parentCs.flexDirection && parentCs.flexDirection.indexOf("column") !== -1) {
            setImp(
              selectedEl,
              "align-self",
              patch.align === "left" ? "flex-start" : patch.align === "right" ? "flex-end" : "center"
            );
          }
          setImp(selectedEl, "margin-left", patch.align === "left" ? "0px" : "auto");
          setImp(selectedEl, "margin-right", patch.align === "right" ? "0px" : "auto");
        } else {
          if (isInline) {
            setImp(selectedEl, "display", latestCs.display === "inline-flex" ? "flex" : "block");
            if (!selectedEl.style.width) setImp(selectedEl, "width", "fit-content");
          }
          setImp(selectedEl, "margin-left", patch.align === "left" ? "0px" : "auto");
          setImp(selectedEl, "margin-right", patch.align === "right" ? "0px" : "auto");
        }
      }
    }
    scheduleRectSync();
  }

  // ---- Custom Code / Component / CSS / JS Injection ----
  function injectCustomCode(injectMode, rawCode) {
    if (!selectedEl || !rawCode || !rawCode.trim()) return;
    var code = rawCode.trim();
    try {
      pushUndoSnapshot();
      if (injectMode === "css") {
        customRuleSeq += 1;
        var cls = "oh-custom-" + customRuleSeq;
        selectedEl.classList.add(cls);
        var styleTag = document.createElement("style");
        styleTag.setAttribute("data-oh-custom-css", "1");
        if (code.indexOf("{") !== -1) {
          styleTag.textContent = code.replace(/&/g, "." + cls);
        } else {
          styleTag.textContent = "." + cls + " { " + code + " }";
        }
        (document.head || document.documentElement).appendChild(styleTag);
        scheduleRectSync();
        window.parent.postMessage({ __ohStudio: true, type: "code-applied", ok: true }, "*");
        return;
      }

      if (injectMode === "js") {
        var fn = new Function("el", "element", "document", "window", code);
        fn(selectedEl, selectedEl, document, window);
        // Embed persisted script tag referencing this element by a stable class so saved HTML retains behavior
        customRuleSeq += 1;
        var jsCls = "oh-js-" + customRuleSeq;
        selectedEl.classList.add(jsCls);
        var persistedScript = document.createElement("script");
        persistedScript.textContent =
          "(function(){var el=document.querySelector('." + jsCls + "');if(!el)return;var element=el;" + code + "})();";
        document.body.appendChild(persistedScript);
        scheduleRectSync();
        window.parent.postMessage({ __ohStudio: true, type: "code-applied", ok: true }, "*");
        return;
      }

      // HTML / full component snippet ("replace" or "inside"):
      // Extract <style> tags to <head>, mount DOM nodes, and execute any <script> tags live.
      var tpl = document.createElement("template");
      tpl.innerHTML = code;
      var frag = tpl.content;

      var styles = Array.prototype.slice.call(frag.querySelectorAll("style"));
      for (var i = 0; i < styles.length; i++) {
        var sEl = document.createElement("style");
        sEl.setAttribute("data-oh-custom-css", "1");
        sEl.textContent = styles[i].textContent || "";
        (document.head || document.documentElement).appendChild(sEl);
        styles[i].parentNode && styles[i].parentNode.removeChild(styles[i]);
      }

      var scripts = Array.prototype.slice.call(frag.querySelectorAll("script"));
      var scriptSources = [];
      for (var j = 0; j < scripts.length; j++) {
        scriptSources.push(scripts[j].textContent || "");
        scripts[j].parentNode && scripts[j].parentNode.removeChild(scripts[j]);
      }

      var firstNewEl = null;
      for (var n = 0; n < frag.childNodes.length; n++) {
        if (frag.childNodes[n].nodeType === 1) {
          firstNewEl = frag.childNodes[n];
          break;
        }
      }

      if (injectMode === "replace" && selectedEl.parentNode) {
        selectedEl.parentNode.insertBefore(frag, selectedEl);
        selectedEl.parentNode.removeChild(selectedEl);
        if (firstNewEl) {
          selectTarget(firstNewEl);
        } else {
          selectedEl = null;
          originalSnapshot = null;
          observeSelectedEl(null);
          if (selectBox) selectBox.style.display = "none";
          window.parent.postMessage({ __ohStudio: true, type: "selection-cleared" }, "*");
        }
      } else {
        selectedEl.appendChild(frag);
        if (firstNewEl) {
          selectTarget(firstNewEl);
        } else {
          scheduleRectSync();
        }
      }

      for (var k = 0; k < scriptSources.length; k++) {
        if (!scriptSources[k].trim()) continue;
        var runScript = document.createElement("script");
        runScript.textContent = scriptSources[k];
        document.body.appendChild(runScript);
      }

      window.parent.postMessage({ __ohStudio: true, type: "code-applied", ok: true }, "*");
    } catch (err) {
      window.parent.postMessage({
        __ohStudio: true,
        type: "code-applied",
        ok: false,
        error: String(err && err.message ? err.message : err)
      }, "*");
    }
  }

  function scheduleRectSync() {
    if (rectRaf) return;
    rectRaf = window.requestAnimationFrame(function() {
      rectRaf = 0;
      syncSelectOverlay();
    });
  }

  function exportCleanHtml() {
    finishInlineEdit(true);
    var clone = document.documentElement.cloneNode(true);
    if (clone.style) {
      clone.style.removeProperty("cursor");
      if (!clone.getAttribute("style") || !clone.getAttribute("style").trim()) {
        clone.removeAttribute("style");
      }
    }
    var removeNodes = clone.querySelectorAll("[data-oh-studio-ui],[data-oh-studio-bridge]");
    for (var i = 0; i < removeNodes.length; i++) {
      removeNodes[i].parentNode && removeNodes[i].parentNode.removeChild(removeNodes[i]);
    }
    var inlineNodes = clone.querySelectorAll("[data-oh-inline-edit]");
    for (var ie = 0; ie < inlineNodes.length; ie++) {
      inlineNodes[ie].removeAttribute("contenteditable");
      inlineNodes[ie].removeAttribute("data-oh-inline-edit");
    }
    var scripts = clone.querySelectorAll("script");
    for (var j = 0; j < scripts.length; j++) {
      var txt = scripts[j].textContent || "";
      if (txt.indexOf("__apiset") !== -1 || txt.indexOf("__ohStudioBridge") !== -1) {
        scripts[j].parentNode && scripts[j].parentNode.removeChild(scripts[j]);
      }
    }
    if (clone.attributes) {
      for (var ra = clone.attributes.length - 1; ra >= 0; ra--) {
        if (clone.attributes[ra].name.indexOf("data-oh-") === 0) {
          clone.removeAttribute(clone.attributes[ra].name);
        }
      }
    }
    var all = clone.querySelectorAll("*");
    for (var k = 0; k < all.length; k++) {
      var node = all[k];
      if (!node.attributes) continue;
      for (var a = node.attributes.length - 1; a >= 0; a--) {
        if (node.attributes[a].name.indexOf("data-oh-") === 0) {
          node.removeAttribute(node.attributes[a].name);
        }
      }
    }
    return "<!doctype html>\\n" + clone.outerHTML;
  }

  // ---- 2-Tier Region Screenshot Capture ----
  function drawRoundRect(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function paintDomToCanvasFallback(crop) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.width * dpr));
    canvas.height = Math.max(1, Math.round(crop.height * dpr));
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.scale(dpr, dpr);

    var bodyBg = window.getComputedStyle(document.body).backgroundColor;
    var htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    ctx.fillStyle = (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent")
      ? bodyBg
      : (htmlBg && htmlBg !== "rgba(0, 0, 0, 0)" && htmlBg !== "transparent" ? htmlBg : "#ffffff");
    ctx.fillRect(0, 0, crop.width, crop.height);

    var cx1 = crop.x, cy1 = crop.y, cx2 = crop.x + crop.width, cy2 = crop.y + crop.height;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) {
        if (isOverlayNode(node)) continue;
        var cs = window.getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) <= 0.01) continue;
        var r = node.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.right < cx1 || r.left > cx2 || r.bottom < cy1 || r.top > cy2) continue;

        var x = r.left - cx1;
        var y = r.top - cy1;
        var radius = parseFloat(cs.borderRadius) || 0;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, parseFloat(cs.opacity) || 1));

        var bg = cs.backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          drawRoundRect(ctx, x, y, r.width, r.height, radius);
          ctx.fillStyle = bg;
          ctx.fill();
        }

        if (node.tagName === "IMG" && node.complete && node.naturalWidth > 0) {
          try {
            drawRoundRect(ctx, x, y, r.width, r.height, radius);
            ctx.clip();
            ctx.drawImage(node, x, y, r.width, r.height);
          } catch (_) {}
        }

        var bw = parseFloat(cs.borderTopWidth) || 0;
        var bc = cs.borderTopColor;
        if (bw > 0 && bc && bc !== "rgba(0, 0, 0, 0)" && bc !== "transparent") {
          drawRoundRect(ctx, x + bw / 2, y + bw / 2, Math.max(0, r.width - bw), Math.max(0, r.height - bw), radius);
          ctx.strokeStyle = bc;
          ctx.lineWidth = bw;
          ctx.stroke();
        }
        ctx.restore();
      } else if (node.nodeType === 3) {
        var text = (node.nodeValue || "").replace(/\\s+/g, " ").trim();
        if (!text || !node.parentElement || isOverlayNode(node.parentElement)) continue;
        var pcs = window.getComputedStyle(node.parentElement);
        if (pcs.display === "none" || pcs.visibility === "hidden" || parseFloat(pcs.opacity) <= 0.01) continue;
        var range = document.createRange();
        range.selectNodeContents(node);
        var rects = range.getClientRects();
        if (!rects || rects.length === 0) continue;
        var tr = rects[0];
        if (tr.right < cx1 || tr.left > cx2 || tr.bottom < cy1 || tr.top > cy2) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, parseFloat(pcs.opacity) || 1));
        ctx.fillStyle = pcs.color || "#111111";
        ctx.font = (pcs.fontStyle || "normal") + " " + (pcs.fontWeight || "400") + " " + (pcs.fontSize || "14px") + " " + (pcs.fontFamily || "sans-serif");
        ctx.textBaseline = "top";
        ctx.fillText(text, tr.left - cx1, tr.top - cy1, Math.max(20, tr.width + 8));
        ctx.restore();
      }
    }
    return canvas.toDataURL("image/png");
  }

  function captureRegion(crop, requestId) {
    var prevHover = hoverBox ? hoverBox.style.display : "none";
    var prevSelect = selectBox ? selectBox.style.display : "none";
    if (hoverBox) hoverBox.style.display = "none";
    if (selectBox) selectBox.style.display = "none";

    var restore = function() {
      if (hoverBox) hoverBox.style.display = prevHover;
      if (selectBox) selectBox.style.display = prevSelect;
    };

    try {
      var vw = Math.max(1, window.innerWidth);
      var vh = Math.max(1, window.innerHeight);
      var scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
      var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
      var clone = document.documentElement.cloneNode(true);
      var bad = clone.querySelectorAll("script,[data-oh-studio-ui]");
      for (var i = 0; i < bad.length; i++) {
        bad[i].parentNode && bad[i].parentNode.removeChild(bad[i]);
      }
      var imgs = clone.querySelectorAll("img");
      for (var j = 0; j < imgs.length; j++) {
        var src = imgs[j].getAttribute("src") || "";
        if (src && !src.startsWith("data:") && !src.startsWith("blob:")) {
          imgs[j].removeAttribute("src");
        }
      }
      var links = clone.querySelectorAll("link[rel='stylesheet']");
      for (var k = 0; k < links.length; k++) {
        links[k].parentNode && links[k].parentNode.removeChild(links[k]);
      }
      if (clone.querySelector("body")) {
        var b = clone.querySelector("body");
        b.style.margin = window.getComputedStyle(document.body).margin;
        b.style.transform = "translate(" + (-scrollX) + "px," + (-scrollY) + "px)";
        b.style.transformOrigin = "top left";
      }
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      var serialized = new XMLSerializer().serializeToString(clone);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + vw + '" height="' + vh + '">' +
        '<foreignObject width="100%" height="100%">' + serialized + '</foreignObject></svg>';
      var svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

      var img = new Image();
      img.onload = function() {
        try {
          var dpr = Math.min(2, window.devicePixelRatio || 1);
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(crop.width * dpr));
          canvas.height = Math.max(1, Math.round(crop.height * dpr));
          var ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          ctx.scale(dpr, dpr);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, crop.width, crop.height);
          ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
          var dataUrl = canvas.toDataURL("image/png");
          restore();
          window.parent.postMessage({ __ohStudio: true, type: "capture-result", requestId: requestId, dataUrl: dataUrl }, "*");
        } catch (_) {
          try {
            var fbUrl = paintDomToCanvasFallback(crop);
            restore();
            window.parent.postMessage({ __ohStudio: true, type: "capture-result", requestId: requestId, dataUrl: fbUrl }, "*");
          } catch (err) {
            restore();
            window.parent.postMessage({ __ohStudio: true, type: "capture-error", requestId: requestId, message: String(err && err.message || err) }, "*");
          }
        }
      };
      img.onerror = function() {
        try {
          var fbUrl = paintDomToCanvasFallback(crop);
          restore();
          window.parent.postMessage({ __ohStudio: true, type: "capture-result", requestId: requestId, dataUrl: fbUrl }, "*");
        } catch (err) {
          restore();
          window.parent.postMessage({ __ohStudio: true, type: "capture-error", requestId: requestId, message: String(err && err.message || err) }, "*");
        }
      };
      img.src = svgUrl;
    } catch (_) {
      try {
        var fbUrl = paintDomToCanvasFallback(crop);
        restore();
        window.parent.postMessage({ __ohStudio: true, type: "capture-result", requestId: requestId, dataUrl: fbUrl }, "*");
      } catch (err) {
        restore();
        window.parent.postMessage({ __ohStudio: true, type: "capture-error", requestId: requestId, message: String(err && err.message || err) }, "*");
      }
    }
  }

  function isPickMode() {
    return mode === "ai-pick" || mode === "manual-edit";
  }

  function pickTarget(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    if (!el || el === document.documentElement || el === document.body || isOverlayNode(el)) return null;
    return el;
  }

  function selectTarget(target) {
    if (inlineEditingEl && inlineEditingEl !== target) {
      finishInlineEdit(true);
    }
    ensureOverlays();
    if (selectedEl && selectedEl.removeAttribute) selectedEl.removeAttribute("data-oh-sel");
    selectedEl = target;
    selectedEl.setAttribute("data-oh-sel", "1");
    originalSnapshot = snapshotElement(selectedEl);
    observeSelectedEl(selectedEl);
    selectionSeq += 1;
    var key = "sel-" + selectionSeq;
    var info = buildElementInfo(selectedEl, key);
    syncSelectOverlay();
    if (hoverBox) hoverBox.style.display = "none";
    window.parent.postMessage({
      __ohStudio: true,
      type: "element-selected",
      mode: mode === "ai-pick" ? "ai-pick" : "manual-edit",
      info: info
    }, "*");
    notifyHistory();
  }

  var lastTouchSelectAt = 0;
  var touchState = null;
  var touchHoldTimer = 0;
  var pickStyleEl = null;

  function setPickCursorStyle(active) {
    if (active) {
      if (!pickStyleEl || !pickStyleEl.parentNode) {
        pickStyleEl = document.createElement("style");
        pickStyleEl.setAttribute("data-oh-studio-ui", "1");
        pickStyleEl.textContent = "*{cursor:pointer!important;-webkit-tap-highlight-color:transparent!important;}";
        (document.head || document.documentElement).appendChild(pickStyleEl);
      }
    } else if (pickStyleEl && pickStyleEl.parentNode) {
      pickStyleEl.parentNode.removeChild(pickStyleEl);
      pickStyleEl = null;
    }
  }

  function clearTouchHoldTimer() {
    if (touchHoldTimer) {
      window.clearTimeout(touchHoldTimer);
      touchHoldTimer = 0;
    }
  }

  function highlightTouchAt(clientX, clientY) {
    ensureOverlays();
    var target = pickTarget(clientX, clientY);
    hoveredEl = target;
    if (!target || target === selectedEl) {
      if (hoverBox) hoverBox.style.display = "none";
      return target;
    }
    positionBox(hoverBox, target.getBoundingClientRect(), hoverTag, describeElement(target));
    return target;
  }

  document.addEventListener("pointermove", function(e) {
    if (!isPickMode() || inlineEditingEl) return;
    if (e.pointerType === "touch") return;
    ensureOverlays();
    var target = pickTarget(e.clientX, e.clientY);
    hoveredEl = target;
    if (!target || target === selectedEl) {
      if (hoverBox) hoverBox.style.display = "none";
      return;
    }
    positionBox(hoverBox, target.getBoundingClientRect(), hoverTag, describeElement(target));
  }, true);

  document.addEventListener("pointerleave", function() {
    if (!isPickMode()) return;
    hoveredEl = null;
    if (hoverBox) hoverBox.style.display = "none";
  }, true);

  document.addEventListener("touchstart", function(e) {
    if (!isPickMode()) return;
    if (e.touches.length !== 1) {
      clearTouchHoldTimer();
      touchState = null;
      return;
    }
    if (inlineEditingEl && inlineEditingEl.contains(e.target)) {
      clearTouchHoldTimer();
      touchState = null;
      return;
    }
    var t = e.touches[0];
    clearTouchHoldTimer();
    touchState = {
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      moved: false,
      scrubbing: false
    };
    touchHoldTimer = window.setTimeout(function() {
      touchHoldTimer = 0;
      if (!touchState || touchState.moved || !isPickMode()) return;
      touchState.scrubbing = true;
      highlightTouchAt(touchState.lastX, touchState.lastY);
    }, 260);
  }, { capture: true, passive: true });

  document.addEventListener("touchmove", function(e) {
    if (!touchState || !isPickMode()) return;
    if (e.touches.length !== 1) {
      clearTouchHoldTimer();
      touchState = null;
      if (hoverBox) hoverBox.style.display = "none";
      return;
    }
    var t = e.touches[0];
    touchState.lastX = t.clientX;
    touchState.lastY = t.clientY;
    if (touchState.scrubbing) {
      if (e.cancelable) e.preventDefault();
      highlightTouchAt(t.clientX, t.clientY);
      return;
    }
    if (Math.hypot(t.clientX - touchState.startX, t.clientY - touchState.startY) > 10) {
      touchState.moved = true;
      clearTouchHoldTimer();
    }
  }, { capture: true, passive: false });

  document.addEventListener("touchend", function(e) {
    clearTouchHoldTimer();
    if (!touchState || !isPickMode()) {
      touchState = null;
      return;
    }
    var st = touchState;
    touchState = null;
    if (hoverBox) hoverBox.style.display = "none";
    hoveredEl = null;
    if (st.moved && !st.scrubbing) return;
    var ct = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    var cx = ct ? ct.clientX : st.lastX;
    var cy = ct ? ct.clientY : st.lastY;
    var target = pickTarget(cx, cy);
    if (!target) return;
    if (inlineEditingEl) finishInlineEdit(true);
    lastTouchSelectAt = Date.now();
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    selectTarget(target);
  }, { capture: true, passive: false });

  document.addEventListener("touchcancel", function() {
    clearTouchHoldTimer();
    touchState = null;
    hoveredEl = null;
    if (hoverBox) hoverBox.style.display = "none";
  }, { capture: true, passive: true });

  document.addEventListener("mousedown", function(e) {
    if (!isPickMode()) return;
    if (Date.now() - lastTouchSelectAt < 500) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (inlineEditingEl && inlineEditingEl.contains(e.target)) return;
    var target = pickTarget(e.clientX, e.clientY);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener("submit", function(e) {
    if (!isPickMode()) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener("click", function(e) {
    if (!isPickMode()) return;
    if (Date.now() - lastTouchSelectAt < 500) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    if (inlineEditingEl && inlineEditingEl.contains(e.target)) return;
    if (inlineEditingEl) finishInlineEdit(true);
    var target = pickTarget(e.clientX, e.clientY);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    selectTarget(target);
  }, true);

  document.addEventListener("dblclick", function(e) {
    if (mode !== "manual-edit") return;
    var target = pickTarget(e.clientX, e.clientY);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (selectedEl !== target) selectTarget(target);
    startInlineEdit(target);
  }, true);

  document.addEventListener("input", function(e) {
    if (!inlineEditingEl || e.target !== inlineEditingEl) return;
    scheduleRectSync();
    window.parent.postMessage({
      __ohStudio: true,
      type: "element-synced",
      info: buildElementInfo(inlineEditingEl, "sel-" + selectionSeq)
    }, "*");
  }, true);

  document.addEventListener("focusout", function(e) {
    if (inlineEditingEl && e.target === inlineEditingEl) {
      finishInlineEdit(true);
    }
  }, true);

  document.addEventListener("keydown", function(e) {
    if (mode !== "manual-edit") return;
    if (inlineEditingEl) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishInlineEdit(false);
      } else if (e.key === "Enter" && !e.shiftKey) {
        var tag = inlineEditingEl.tagName.toLowerCase();
        if (tag !== "p" && tag !== "div" && tag !== "li" && tag !== "blockquote") {
          e.preventDefault();
          e.stopPropagation();
          finishInlineEdit(true);
        }
      }
      return;
    }

    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) performRedo();
      else performUndo();
      return;
    }
    if (mod && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      e.stopPropagation();
      performRedo();
      return;
    }

    if (!selectedEl) return;
    var step = e.shiftKey ? 10 : 1;
    var dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    if (dx !== 0 || dy !== 0) {
      e.preventDefault();
      e.stopPropagation();
      var tf = readTransformData(selectedEl);
      applyPatch({
        offsetX: Math.max(-400, Math.min(400, tf.offsetX + dx)),
        offsetY: Math.max(-400, Math.min(400, tf.offsetY + dy))
      });
      window.parent.postMessage({
        __ohStudio: true,
        type: "element-synced",
        info: buildElementInfo(selectedEl, "sel-" + selectionSeq)
      }, "*");
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedEl.parentNode) {
        e.preventDefault();
        e.stopPropagation();
        pushUndoSnapshot();
        selectedEl.parentNode.removeChild(selectedEl);
        selectedEl = null;
        originalSnapshot = null;
        observeSelectedEl(null);
        if (selectBox) selectBox.style.display = "none";
        window.parent.postMessage({ __ohStudio: true, type: "element-deleted" }, "*");
      }
    }
  }, true);

  document.addEventListener("scroll", function() {
    if (selectedEl) scheduleRectSync();
  }, { passive: true, capture: true });

  window.addEventListener("resize", function() {
    if (selectedEl) scheduleRectSync();
  }, { passive: true });

  window.addEventListener("message", function(e) {
    var data = e.data;
    if (!data || data.__ohStudio !== true) return;
    if (data.type === "set-mode") {
      finishInlineEdit(true);
      clearTouchHoldTimer();
      touchState = null;
      mode = data.mode || "off";
      window.__ohStudioMode = mode;
      document.documentElement.style.cursor = isPickMode() ? "crosshair" : "";
      setPickCursorStyle(isPickMode());
      if (!isPickMode()) {
        hoveredEl = null;
        if (selectedEl && selectedEl.removeAttribute) selectedEl.removeAttribute("data-oh-sel");
        selectedEl = null;
        originalSnapshot = null;
        observeSelectedEl(null);
        hideOverlays();
      } else {
        ensureOverlays();
        if (selectedEl && document.contains(selectedEl)) {
          syncSelectOverlay();
        }
        notifyHistory();
      }
    } else if (data.type === "clear-selection") {
      finishInlineEdit(true);
      if (selectedEl && selectedEl.removeAttribute) selectedEl.removeAttribute("data-oh-sel");
      selectedEl = null;
      originalSnapshot = null;
      observeSelectedEl(null);
      if (selectBox) selectBox.style.display = "none";
    } else if (data.type === "apply-style") {
      applyPatch(data.patch);
    } else if (data.type === "nudge") {
      if (selectedEl) {
        var ntf = readTransformData(selectedEl);
        var ndx = typeof data.dx === "number" ? data.dx : 0;
        var ndy = typeof data.dy === "number" ? data.dy : 0;
        applyPatch({
          offsetX: Math.max(-400, Math.min(400, ntf.offsetX + ndx)),
          offsetY: Math.max(-400, Math.min(400, ntf.offsetY + ndy))
        });
        window.parent.postMessage({
          __ohStudio: true,
          type: "element-synced",
          info: buildElementInfo(selectedEl, "sel-" + selectionSeq)
        }, "*");
      }
    } else if (data.type === "undo") {
      performUndo();
    } else if (data.type === "redo") {
      performRedo();
    } else if (data.type === "mark-saved") {
      savedHistoryVersion = historyVersion;
      notifyHistory();
    } else if (data.type === "select-parent") {
      if (selectedEl && selectedEl.parentElement && selectedEl.parentElement !== document.body && selectedEl.parentElement !== document.documentElement) {
        selectTarget(selectedEl.parentElement);
      }
    } else if (data.type === "reorder-element") {
      if (selectedEl && selectedEl.parentNode) {
        if (data.dir === "up" && selectedEl.previousElementSibling) {
          pushUndoSnapshot();
          selectedEl.parentNode.insertBefore(selectedEl, selectedEl.previousElementSibling);
          scheduleRectSync();
        } else if (data.dir === "down" && selectedEl.nextElementSibling) {
          pushUndoSnapshot();
          selectedEl.parentNode.insertBefore(selectedEl.nextElementSibling, selectedEl);
          scheduleRectSync();
        }
      }
    } else if (data.type === "inject-code") {
      injectCustomCode(data.mode || "replace", data.code || "");
    } else if (data.type === "duplicate-element") {
      if (selectedEl && selectedEl.parentNode) {
        pushUndoSnapshot();
        var copy = selectedEl.cloneNode(true);
        if (copy.removeAttribute) {
          copy.removeAttribute("id");
          copy.removeAttribute("data-oh-sel");
        }
        selectedEl.parentNode.insertBefore(copy, selectedEl.nextSibling);
        selectTarget(copy);
        window.parent.postMessage({ __ohStudio: true, type: "element-duplicated" }, "*");
      }
    } else if (data.type === "delete-element") {
      if (selectedEl && selectedEl.parentNode) {
        finishInlineEdit(false);
        pushUndoSnapshot();
        selectedEl.parentNode.removeChild(selectedEl);
        selectedEl = null;
        originalSnapshot = null;
        observeSelectedEl(null);
        if (selectBox) selectBox.style.display = "none";
        window.parent.postMessage({ __ohStudio: true, type: "element-deleted" }, "*");
      }
    } else if (data.type === "reset-element") {
      if (selectedEl && originalSnapshot) {
        finishInlineEdit(false);
        pushUndoSnapshot();
        if (originalSnapshot.styleAttr === null) selectedEl.removeAttribute("style");
        else selectedEl.setAttribute("style", originalSnapshot.styleAttr);
        if (originalSnapshot.dirAttr === null) selectedEl.removeAttribute("dir");
        else selectedEl.setAttribute("dir", originalSnapshot.dirAttr);
        if (originalSnapshot.srcAttr === null) selectedEl.removeAttribute("src");
        else selectedEl.setAttribute("src", originalSnapshot.srcAttr);
        if (originalSnapshot.altAttr === null) selectedEl.removeAttribute("alt");
        else selectedEl.setAttribute("alt", originalSnapshot.altAttr);
        if (originalSnapshot.hrefAttr === null) selectedEl.removeAttribute("href");
        else selectedEl.setAttribute("href", originalSnapshot.hrefAttr);
        if (originalSnapshot.targetAttr === null) selectedEl.removeAttribute("target");
        else selectedEl.setAttribute("target", originalSnapshot.targetAttr);
        selectedEl.innerHTML = originalSnapshot.innerHTML;
        if (originalSnapshot.value !== undefined && "value" in selectedEl) {
          selectedEl.value = originalSnapshot.value;
        }
        for (var i = 0; i < DATA_KEYS.length; i++) {
          var dk = DATA_KEYS[i];
          if (originalSnapshot.ds[dk] === undefined) delete selectedEl.dataset[dk];
          else selectedEl.dataset[dk] = originalSnapshot.ds[dk];
        }
        selectionSeq += 1;
        var resetKey = "sel-" + selectionSeq;
        syncSelectOverlay();
        window.parent.postMessage({
          __ohStudio: true,
          type: "element-selected",
          mode: mode === "ai-pick" ? "ai-pick" : "manual-edit",
          info: buildElementInfo(selectedEl, resetKey)
        }, "*");
      }
    } else if (data.type === "export-html") {
      window.parent.postMessage({
        __ohStudio: true,
        type: "export-html-result",
        requestId: data.requestId || "",
        html: exportCleanHtml()
      }, "*");
    } else if (data.type === "capture-region" && data.rect) {
      captureRegion(data.rect, data.requestId || "");
    }
  });
})();
</script>`;
