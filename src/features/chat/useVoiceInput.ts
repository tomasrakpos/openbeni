// chat feature: useVoiceInput; robust live Web Speech dictation with
// real-time interim preview, Android duplicate-result protection, safe
// silence auto-restart, and accurate per-error reporting.
import * as React from "react";

export interface SpeechAlternativeLike {
  transcript?: string;
}

export interface SpeechResultLike {
  isFinal: boolean;
  0?: SpeechAlternativeLike;
}

export interface RecognitionResultListLike {
  length: number;
  [index: number]: SpeechResultLike | undefined;
}

export interface RecognitionEventLike {
  resultIndex: number;
  results: RecognitionResultListLike;
}

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart?: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

export type VoiceErrorCode =
  | "unsupported"
  | "insecure"
  | "not-allowed"
  | "service-not-allowed"
  | "audio-capture"
  | "network"
  | "language-not-supported"
  | "unknown";

const MAX_SILENT_RESTARTS = 3;

function getRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isAndroidUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent ?? "");
}

/**
 * Joins two transcript segments without creating double spaces or repeating
 * cumulative prefixes emitted by Chromium/Android SpeechRecognition.
 */
export function appendTranscriptSegment(prev: string, rawSegment: string): string {
  const seg = rawSegment.trim();
  if (!seg) return prev;
  const existing = prev.trim();
  if (!existing) return seg;

  // Android Chromium sometimes re-emits the cumulative utterance as a new final result.
  if (seg === existing) return existing;
  if (seg.startsWith(existing) && seg.length > existing.length) {
    const boundary = seg[existing.length];
    if (boundary === " " || boundary === "\u200c" || boundary === "،" || boundary === ",") {
      return seg;
    }
  }
  return `${existing} ${seg}`;
}

/**
 * Extracts clean final & interim text from a full SpeechRecognitionResultList,
 * skipping any results already folded into manual edits (`startIndex`).
 */
export function extractSpeechSegments(
  results: RecognitionResultListLike,
  startIndex = 0,
): { finalText: string; interimText: string } {
  let finalText = "";
  let interimText = "";
  let prevFinalSeg = "";

  for (let i = Math.max(0, startIndex); i < results.length; i++) {
    const res = results[i];
    if (!res) continue;
    const seg = (res[0]?.transcript ?? "").trim();
    if (!seg) continue;

    if (res.isFinal) {
      // Guard against identical consecutive final chunks on mobile Chrome.
      if (seg === prevFinalSeg) continue;
      prevFinalSeg = seg;
      finalText = appendTranscriptSegment(finalText, seg);
    } else {
      interimText = appendTranscriptSegment(interimText, seg);
    }
  }

  return { finalText, interimText };
}

/**
 * Composes the live textarea string from pre-existing text (`base`), committed
 * text from prior auto-restarted sessions, and the current session's final +
 * interim dictation.
 */
export function composeVoiceText(
  base: string,
  committed: string,
  sessionFinal: string,
  sessionInterim: string,
): string {
  let spoken = committed.trim();
  if (sessionFinal.trim()) {
    spoken = appendTranscriptSegment(spoken, sessionFinal);
  }
  if (sessionInterim.trim()) {
    spoken = appendTranscriptSegment(spoken, sessionInterim);
  }
  if (!spoken) return base;
  if (!base) return spoken;
  const needsSpace = !/[\s\n]$/.test(base);
  return `${base}${needsSpace ? " " : ""}${spoken}`;
}

export function voiceErrorI18nKey(code: VoiceErrorCode): string {
  switch (code) {
    case "insecure":
      return "chat.voiceInsecure";
    case "unsupported":
      return "chat.voiceUnsupported";
    case "not-allowed":
    case "service-not-allowed":
      return "chat.voicePermissionDenied";
    case "audio-capture":
      return "chat.voiceNoMic";
    case "network":
      return "chat.voiceNetworkError";
    default:
      return "chat.voiceError";
  }
}

export function useVoiceInput({
  lang,
  value,
  onChange,
  onError,
}: {
  lang: "en" | "fa";
  value: string;
  onChange: (nextText: string) => void;
  onError?: (code: VoiceErrorCode) => void;
}) {
  const [supported] = React.useState(() => getRecognition() !== null);
  const [listening, setListening] = React.useState(false);

  const recognitionRef = React.useRef<RecognitionLike | null>(null);
  const sessionIdRef = React.useRef(0);
  const wantListeningRef = React.useRef(false);
  const restartTimerRef = React.useRef<number | null>(null);
  const silentRestartsRef = React.useRef(0);
  const gotSpeechInSessionRef = React.useRef(false);
  const fallbackLangUsedRef = React.useRef(false);

  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;

  const baseTextRef = React.useRef("");
  const committedTextRef = React.useRef("");
  const sessionFinalRef = React.useRef("");
  const sessionInterimRef = React.useRef("");
  const lastEmittedRef = React.useRef<string | null>(null);
  const skipResultsBeforeRef = React.useRef(0);
  const lastResultsLenRef = React.useRef(0);

  const clearRestartTimer = React.useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const emitComposed = React.useCallback(() => {
    const next = composeVoiceText(
      baseTextRef.current,
      committedTextRef.current,
      sessionFinalRef.current,
      sessionInterimRef.current,
    );
    lastEmittedRef.current = next;
    onChangeRef.current(next);
  }, []);

  // Preserve manual edits if the user types or deletes while dictation is active.
  React.useEffect(() => {
    if (!wantListeningRef.current) return;
    if (lastEmittedRef.current !== null && value === lastEmittedRef.current) return;
    baseTextRef.current = value;
    committedTextRef.current = "";
    sessionFinalRef.current = "";
    sessionInterimRef.current = "";
    skipResultsBeforeRef.current = lastResultsLenRef.current;
    lastEmittedRef.current = value;
  }, [value]);

  const foldCurrentSession = React.useCallback(() => {
    if (sessionFinalRef.current.trim()) {
      committedTextRef.current = appendTranscriptSegment(
        committedTextRef.current,
        sessionFinalRef.current,
      );
    } else if (sessionInterimRef.current.trim()) {
      // Never drop the last spoken words if the user taps Stop before isFinal arrives.
      committedTextRef.current = appendTranscriptSegment(
        committedTextRef.current,
        sessionInterimRef.current,
      );
    }
    sessionFinalRef.current = "";
    sessionInterimRef.current = "";
    skipResultsBeforeRef.current = 0;
    lastResultsLenRef.current = 0;
  }, []);

  const launchSession = React.useCallback(
    (overrideLang?: string) => {
      const Ctor = getRecognition();
      if (!Ctor) return false;

      clearRestartTimer();
      const myId = ++sessionIdRef.current;

      const prev = recognitionRef.current;
      if (prev) {
        prev.onresult = null;
        prev.onerror = null;
        prev.onend = null;
        try {
          prev.abort ? prev.abort() : prev.stop();
        } catch {
          // ignore stale instance errors
        }
      }

      const recognition = new Ctor();
      recognition.lang = overrideLang ?? (lang === "fa" ? "fa-IR" : "en-US");
      // Android Chromium handles continuous=false + safe auto-restart far more cleanly
      // than continuous=true (which duplicates utterances and drops punctuation).
      recognition.continuous = !isAndroidUA();
      recognition.interimResults = true;
      if ("maxAlternatives" in recognition) {
        recognition.maxAlternatives = 1;
      }

      gotSpeechInSessionRef.current = false;
      skipResultsBeforeRef.current = 0;
      lastResultsLenRef.current = 0;

      recognition.onstart = () => {
        if (myId !== sessionIdRef.current) return;
        setListening(true);
      };

      recognition.onresult = (event) => {
        if (myId !== sessionIdRef.current) return;
        gotSpeechInSessionRef.current = true;
        silentRestartsRef.current = 0;
        lastResultsLenRef.current = event.results.length;

        const { finalText, interimText } = extractSpeechSegments(
          event.results,
          skipResultsBeforeRef.current,
        );
        sessionFinalRef.current = finalText;
        sessionInterimRef.current = interimText;
        emitComposed();
      };

      recognition.onerror = (event) => {
        if (myId !== sessionIdRef.current) return;
        const code = event.error ?? "";

        if (code === "aborted") return;
        if (code === "no-speech") {
          // Let onend handle gentle restart or clean stop after prolonged silence.
          return;
        }
        if (code === "language-not-supported" && !fallbackLangUsedRef.current) {
          fallbackLangUsedRef.current = true;
          const fallback = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
          if (fallback !== recognition.lang) {
            launchSession(fallback);
            return;
          }
        }

        wantListeningRef.current = false;
        clearRestartTimer();
        foldCurrentSession();
        emitComposed();
        setListening(false);

        const mapped: VoiceErrorCode =
          code === "not-allowed" ||
          code === "service-not-allowed" ||
          code === "audio-capture" ||
          code === "network" ||
          code === "language-not-supported"
            ? code
            : "unknown";
        onErrorRef.current?.(mapped);
      };

      recognition.onend = () => {
        if (myId !== sessionIdRef.current) return;
        foldCurrentSession();
        emitComposed();

        if (!wantListeningRef.current) {
          setListening(false);
          return;
        }

        if (!gotSpeechInSessionRef.current) {
          silentRestartsRef.current += 1;
          if (silentRestartsRef.current >= MAX_SILENT_RESTARTS) {
            wantListeningRef.current = false;
            setListening(false);
            return;
          }
        }

        restartTimerRef.current = window.setTimeout(() => {
          if (myId !== sessionIdRef.current || !wantListeningRef.current) return;
          launchSession();
        }, 160);
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setListening(true);
        return true;
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        wantListeningRef.current = false;
        setListening(false);
        if (name === "NotAllowedError" || name === "SecurityError") {
          onErrorRef.current?.("not-allowed");
        } else {
          onErrorRef.current?.("unknown");
        }
        return false;
      }
    },
    [clearRestartTimer, emitComposed, foldCurrentSession, lang],
  );

  const stop = React.useCallback(
    (options?: { commit?: boolean }) => {
      const shouldCommit = options?.commit ?? true;
      wantListeningRef.current = false;
      clearRestartTimer();
      if (shouldCommit) {
        foldCurrentSession();
        emitComposed();
      } else {
        sessionFinalRef.current = "";
        sessionInterimRef.current = "";
        committedTextRef.current = "";
        baseTextRef.current = "";
        lastEmittedRef.current = null;
      }
      const active = recognitionRef.current;
      sessionIdRef.current += 1;
      recognitionRef.current = null;
      if (active) {
        active.onresult = null;
        active.onerror = null;
        active.onend = null;
        try {
          active.stop();
        } catch {
          // ignore if already stopped
        }
      }
      setListening(false);
    },
    [clearRestartTimer, emitComposed, foldCurrentSession],
  );

  const start = React.useCallback(() => {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      onErrorRef.current?.("insecure");
      return;
    }
    if (!getRecognition()) {
      onErrorRef.current?.("unsupported");
      return;
    }

    wantListeningRef.current = true;
    silentRestartsRef.current = 0;
    fallbackLangUsedRef.current = false;
    baseTextRef.current = valueRef.current;
    committedTextRef.current = "";
    sessionFinalRef.current = "";
    sessionInterimRef.current = "";
    lastEmittedRef.current = valueRef.current;

    launchSession();
  }, [launchSession]);

  const toggle = React.useCallback(() => {
    if (wantListeningRef.current || listening) stop();
    else start();
  }, [listening, start, stop]);

  React.useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearRestartTimer();
      sessionIdRef.current += 1;
      const active = recognitionRef.current;
      recognitionRef.current = null;
      if (active) {
        active.onresult = null;
        active.onerror = null;
        active.onend = null;
        try {
          active.abort ? active.abort() : active.stop();
        } catch {
          // ignore
        }
      }
    };
  }, [clearRestartTimer]);

  return { supported, listening, start, stop, toggle };
}
