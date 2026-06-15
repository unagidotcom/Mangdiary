import { useCallback, useMemo, useRef, useState } from "react";

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

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useSpeechRecognition(onText: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const committedWordsRef = useRef<string[]>([]);
  const finalResultTextByIndexRef = useRef<Map<number, string>>(new Map());
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  const supported = useMemo(
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    [],
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    committedWordsRef.current = [];
    finalResultTextByIndexRef.current = new Map();
    setIsListening(false);
    setTranscript("");
  }, []);

  const start = useCallback(() => {
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

    recognition.onerror = () => stop();
    recognition.onend = () => {
      recognitionRef.current = null;
      committedWordsRef.current = [];
      finalResultTextByIndexRef.current = new Map();
      setIsListening(false);
      setTranscript("");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, onText, stop]);

  return { supported, isListening, transcript, start, stop };
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
