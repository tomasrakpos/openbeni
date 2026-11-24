import { describe, expect, it } from "vitest";
import {
  appendTranscriptSegment,
  composeVoiceText,
  extractSpeechSegments,
  voiceErrorI18nKey,
} from "@/features/chat/useVoiceInput";

describe("voice input dictation helpers", () => {
  it("deduplicates cumulative and identical mobile Chrome final results in Persian and English", () => {
    // Cumulative Android Chromium utterance pattern
    expect(appendTranscriptSegment("سلام چطوری", "سلام چطوری خوبی")).toBe("سلام چطوری خوبی");
    expect(appendTranscriptSegment("hello world", "hello world today")).toBe("hello world today");
    expect(appendTranscriptSegment("سلام", "سلام")).toBe("سلام");
    expect(appendTranscriptSegment("سلام", "خوبی")).toBe("سلام خوبی");
  });

  it("extracts both live interim and final segments without duplicating consecutive results", () => {
    const results = [
      { isFinal: true, 0: { transcript: "یه سایت فروشگاهی" } },
      { isFinal: true, 0: { transcript: "یه سایت فروشگاهی" } }, // duplicate from mobile Chrome
      { isFinal: true, 0: { transcript: "با طراحی مدرن بساز" } },
      { isFinal: false, 0: { transcript: "برای موبایل" } },
    ];
    const extracted = extractSpeechSegments(results);
    expect(extracted.finalText).toBe("یه سایت فروشگاهی با طراحی مدرن بساز");
    expect(extracted.interimText).toBe("برای موبایل");

    // Respects startIndex after a manual user edit mid-dictation
    const sliced = extractSpeechSegments(results, 3);
    expect(sliced.finalText).toBe("");
    expect(sliced.interimText).toBe("برای موبایل");
  });

  it("composes base text, committed prior sessions, and live interim text cleanly", () => {
    expect(composeVoiceText("", "", "", "سلام")).toBe("سلام");
    expect(composeVoiceText("لطفاً", "یه سایت بساز", "با رنگ تیره", "و سریع")).toBe(
      "لطفاً یه سایت بساز با رنگ تیره و سریع",
    );
    // Preserves trailing newline without injecting an extra space
    expect(composeVoiceText("Line 1\n", "", "Line 2", "")).toBe("Line 1\nLine 2");
    expect(composeVoiceText("Existing text", "", "", "")).toBe("Existing text");
  });

  it("maps each speech error code to its specific i18n message key", () => {
    expect(voiceErrorI18nKey("insecure")).toBe("chat.voiceInsecure");
    expect(voiceErrorI18nKey("unsupported")).toBe("chat.voiceUnsupported");
    expect(voiceErrorI18nKey("not-allowed")).toBe("chat.voicePermissionDenied");
    expect(voiceErrorI18nKey("service-not-allowed")).toBe("chat.voicePermissionDenied");
    expect(voiceErrorI18nKey("audio-capture")).toBe("chat.voiceNoMic");
    expect(voiceErrorI18nKey("network")).toBe("chat.voiceNetworkError");
    expect(voiceErrorI18nKey("unknown")).toBe("chat.voiceError");
  });
});
