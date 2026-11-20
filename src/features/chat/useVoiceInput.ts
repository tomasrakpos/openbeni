// chat feature: useVoiceInput; change its UI/flow here and keep related state/API calls in sync.
import * as React from "react";

interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResultLike };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceInput({
  lang,
  onTranscript,
  onError,
}: {
  lang: "en" | "fa";
  onTranscript: (text: string, final: boolean) => void;
  onError?: (message: string) => void;
}) {
  const [supported] = React.useState(() => getRecognition() !== null);
  const [listening, setListening] = React.useState(false);
  const recognitionRef = React.useRef<RecognitionLike | null>(null);
  const onTranscriptRef = React.useRef(onTranscript);
  const onErrorRef = React.useRef(onError);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor) {
      onErrorRef.current?.("unsupported");
      return;
    }
    if (recognitionRef.current) recognitionRef.current.stop();
    const recognition = new Ctor();
    recognition.lang = lang === "fa" ? "fa-IR" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) onTranscriptRef.current(final, true);
      else if (interim) onTranscriptRef.current(interim, false);
    };
    recognition.onerror = (event) => {
      if (event.error && event.error !== "aborted" && event.error !== "no-speech") {
        onErrorRef.current?.(event.error);
      }
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [lang]);

  React.useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, start, stop };
}
