/**
 * useVoiceRecognition — Web Speech Recognition API hook.
 *
 * Provides browser-based speech recognition using the Web Speech API
 * (window.SpeechRecognition / window.webkitSpeechRecognition).
 *
 * Browser support:
 *   - Chrome 25+ (prefixed as webkitSpeechRecognition)
 *   - Edge 79+ (Chromium-based, uses webkit prefix)
 *   - Safari 14.1+ (partial, prefixed as webkitSpeechRecognition)
 *   - Firefox: NOT supported (no SpeechRecognition API)
 *
 * This is browser-based recognition only. No audio is recorded or saved.
 * No backend transcription service is used.
 *
 * States:
 *   idle           — not active
 *   listening      — actively capturing speech
 *   error          — recognition failed (check errorType)
 *
 * Error types:
 *   unsupported         — browser lacks SpeechRecognition API
 *   permission-denied   — user denied microphone access
 *   no-speech           — no speech was detected
 *   network             — network error during recognition
 *   aborted             — recognition was aborted
 *   unknown             — unrecognized error
 *
 * Cleanup:
 *   Recognition is stopped and references are nulled on unmount, cancel, or stop.
 *   No microphone tracks remain active after cleanup.
 *
 * @returns {{
 *   state: string,
 *   transcript: string,
 *   interimTranscript: string,
 *   errorType: string|null,
 *   start: () => void,
 *   stop: () => void,
 *   cancel: () => void,
 *   reset: () => void,
 *   isSupported: boolean,
 * }}
 */

import { useState, useRef, useCallback, useEffect } from "react";

export function useVoiceRecognition() {
  const [state, setState] = useState("idle"); // idle | listening | error
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [errorType, setErrorType] = useState(null);

  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const shouldRestartRef = useRef(false);

  // Detect browser support
  const SpeechRecognitionAPI =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  const isSupported = !!SpeechRecognitionAPI;

  // Cleanup function — stop recognition and null out reference
  const cleanup = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Recognition may already be stopped — ignore errors
      }
      recognitionRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const start = useCallback(() => {
    if (!isSupported) {
      setState("error");
      setErrorType("unsupported");
      return;
    }

    // If already listening, do nothing
    if (recognitionRef.current) return;

    // Reset state for a new recognition session
    setErrorType(null);
    setTranscript("");
    setInterimTranscript("");
    finalTranscriptRef.current = "";

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true; // Keep listening until user stops
      recognition.interimResults = true; // Show partial results as user speaks
      recognition.lang = "en-US"; // Default language

      recognition.onstart = () => {
        setState("listening");
      };

      recognition.onresult = (event) => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += chunk;
          } else {
            interim += chunk;
          }
        }

        if (final) {
          finalTranscriptRef.current += final;
          setTranscript(finalTranscriptRef.current);
        }
        setInterimTranscript(interim);
      };

      recognition.onerror = (event) => {
        const errorMap = {
          "not-allowed": "permission-denied",
          "service-not-allowed": "permission-denied",
          "no-speech": "no-speech",
          "network": "network",
          "aborted": "aborted",
          "audio-capture": "audio-capture",
        };
        const mapped = errorMap[event.error] || "unknown";
        setErrorType(mapped);
        setState("error");

        // For no-speech, we don't fully stop — let the user decide
        // For permission-denied and unsupported, recognition is already dead
        shouldRestartRef.current = false;
      };

      recognition.onend = () => {
        // Recognition ended — either naturally (silence timeout) or via stop()
        if (shouldRestartRef.current) {
          // Auto-restart for continuous listening (handles Chrome's timeout)
          try {
            recognition.start();
          } catch {
            // If restart fails, go to idle
            setState("idle");
            recognitionRef.current = null;
          }
        } else {
          // User stopped or error — clean up
          setState("idle");
          setInterimTranscript("");
          recognitionRef.current = null;
        }
      };

      shouldRestartRef.current = true;
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setState("error");
      setErrorType("unknown");
    }
  }, [isSupported, SpeechRecognitionAPI]);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped
      }
      recognitionRef.current = null;
    }
    setState("idle");
    setInterimTranscript("");
  }, []);

  const cancel = useCallback(() => {
    cleanup();
    setState("idle");
    setTranscript("");
    setInterimTranscript("");
    setErrorType(null);
    finalTranscriptRef.current = "";
  }, [cleanup]);

  const reset = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setErrorType(null);
    finalTranscriptRef.current = "";
  }, []);

  return {
    state,
    transcript,
    interimTranscript,
    errorType,
    start,
    stop,
    cancel,
    reset,
    isSupported,
  };
}
