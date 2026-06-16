import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognitionAlternative = {
  transcript: string;
};

type SpeechRecognitionResult = {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
};

type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type TranscribeResponse = {
  text?: string;
  error?: string;
};

const GROQ_CHUNK_INTERVAL_MS = 5000;
const MIN_AUDIO_CHUNK_BYTES = 2000;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useSpeechRecognition(onText: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunkQueueRef = useRef<Blob[]>([]);
  const processingChunksRef = useRef(false);
  const engineRef = useRef<"groq" | "browser" | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);
  const committedWordsRef = useRef<string[]>([]);
  const finalResultTextByIndexRef = useRef<Map<number, string>>(new Map());
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [groqAvailable, setGroqAvailable] = useState(false);

  const browserSpeechSupported = useMemo(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition), []);
  const mediaRecorderSupported = useMemo(
    () => typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    [],
  );
  const supported = browserSpeechSupported || (groqAvailable && mediaRecorderSupported);

  const clearPendingStop = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    clearPendingStop();
    stopRequestedRef.current = false;
    committedWordsRef.current = [];
    finalResultTextByIndexRef.current = new Map();
    chunkQueueRef.current = [];
    setTranscript("");
    setIsListening(false);
    engineRef.current = null;
  }, [clearPendingStop]);

  const stopBrowser = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const stopGroq = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const stopNow = useCallback(() => {
    stopRequestedRef.current = true;
    clearPendingStop();
    if (engineRef.current === "browser") stopBrowser();
    if (engineRef.current === "groq") stopGroq();
    resetState();
  }, [clearPendingStop, resetState, stopBrowser, stopGroq]);

  const stop = useCallback(() => {
    if (!engineRef.current || stopTimerRef.current !== null) return;
    stopRequestedRef.current = true;
    setTranscript("Stopping...");
    stopTimerRef.current = window.setTimeout(() => {
      stopNow();
    }, 5000);
  }, [stopNow]);

  const startBrowser = useCallback(() => {
    const SpeechApi = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechApi || isListening) return;

    committedWordsRef.current = [];
    finalResultTextByIndexRef.current = new Map();

    const recognition = new SpeechApi();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          const resultText = result[0].transcript;
          if (finalResultTextByIndexRef.current.get(index) === resultText) continue;
          finalResultTextByIndexRef.current.set(index, resultText);
          finalText += resultText;
        } else {
          interim += result[0].transcript;
        }
      }

      const newText = nextFinalText(finalText, committedWordsRef.current);
      if (newText) onText(`${newText} `);
      setTranscript(interim.trim());
    };

    recognition.onerror = () => {
      setTranscript("");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (stopRequestedRef.current) {
        resetState();
        return;
      }

      try {
        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        resetState();
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    engineRef.current = "browser";
    setIsListening(true);
  }, [isListening, onText, resetState, stop]);

  const processChunkQueue = useCallback(async () => {
    if (processingChunksRef.current) return;
    processingChunksRef.current = true;

    try {
      while (chunkQueueRef.current.length > 0) {
        const chunk = chunkQueueRef.current.shift();
        if (!chunk || chunk.size === 0) continue;

        setTranscript("Transcribing...");
        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Audio-Mime-Type": chunk.type || preferredAudioMimeType() || "audio/webm",
            "X-Language": navigator.language || "en-US",
          },
          body: await chunk.arrayBuffer(),
        });

        const result = (await response.json().catch(() => ({}))) as TranscribeResponse;
        if (!response.ok) throw new Error(result.error || "Transcription failed.");

        const nextText = nextFinalText(result.text || "", committedWordsRef.current);
        if (nextText) onText(`${nextText} `);
        setTranscript("");
      }
    } catch {
      setTranscript("");
    } finally {
      processingChunksRef.current = false;
    }
  }, [onText]);

  const start = useCallback(() => {
    clearPendingStop();
    stopRequestedRef.current = false;
    committedWordsRef.current = [];
    finalResultTextByIndexRef.current = new Map();
    chunkQueueRef.current = [];

    if (groqAvailable && mediaRecorderSupported) {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });

          const mimeType = preferredAudioMimeType();
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          mediaStreamRef.current = stream;
          recorderRef.current = recorder;
          recorder.ondataavailable = (event) => {
            if (!event.data || event.data.size < MIN_AUDIO_CHUNK_BYTES) return;
            chunkQueueRef.current.push(event.data);
            void processChunkQueue();
          };
          recorder.onerror = () => {
            setTranscript("");
          };
          recorder.onstop = () => {
            recorderRef.current = null;
            mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          };
          recorder.start(GROQ_CHUNK_INTERVAL_MS);
          engineRef.current = "groq";
          setIsListening(true);
          setTranscript("");
        } catch {
          if (browserSpeechSupported) startBrowser();
        }
      })();
      return;
    }

    if (browserSpeechSupported) startBrowser();
  }, [browserSpeechSupported, clearPendingStop, groqAvailable, mediaRecorderSupported, processChunkQueue, startBrowser]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/transcribe");
        const result = (await response.json().catch(() => ({}))) as { available?: boolean };
        if (active) setGroqAvailable(Boolean(result.available));
      } catch {
        if (active) setGroqAvailable(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => stopNow, [stopNow]);

  return { supported, isListening, transcript, start, stop };
}

function preferredAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function nextFinalText(rawText: string, committedWords: string[]) {
  const nextWords = words(rawText);
  if (!nextWords.length) return "";

  const overlap = longestOverlap(committedWords, nextWords);
  const newWords = nextWords.slice(overlap);
  if (!newWords.length) return "";

  committedWords.push(...newWords);
  return newWords.join(" ");
}

function longestOverlap(left: string[], right: string[]) {
  const max = Math.min(left.length, right.length);
  for (let size = max; size > 0; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (normalizeWord(left[left.length - size + index]) !== normalizeWord(right[index])) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

function words(value: string) {
  return value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
}

function normalizeWord(value: string) {
  return value.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
