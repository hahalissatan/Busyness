/**
 * ChatInput — shared bottom-of-page prompt bar for all four BUSYNESS modules.
 *
 * Features:
 *   - Text input with keyboard (Enter) and button submission
 *   - Voice recognition via Web Speech API (browser-based, no audio saved)
 *   - File attachment via hidden file picker (client-side selection only —
 *     no backend upload endpoint exists; files are listed by name on submit)
 *
 * Voice states:
 *   idle → listening → recognized text populates input (editable before submit)
 *   Handles: unsupported browser, permission denied, no speech, network error
 *   Microphone resources are cleaned up on stop, cancel, or unmount.
 *
 * File states:
 *   Files are selected locally, shown as chips with name/type/size.
 *   Validated by type (per-module config) and size (max 10MB).
 *   Removed before submission. NOT uploaded — no backend endpoint exists.
 *   On submit, filenames are appended to the message text.
 *
 * Props:
 *   onSend(text)       — Called when user submits (text + attachment filenames)
 *   placeholder        — Input placeholder text
 *   disabled           — Disable input (e.g. while processing)
 *   module             — Module key for file type restrictions:
 *                        "financial" | "inventory" | "tasks" | "marketing"
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useVoiceRecognition } from "../hooks/useVoiceRecognition.js";
import { Mic, Paperclip, Send, Square, X, FileIcon } from "./icons.jsx";

// ─── Module-specific file type configuration ┆────────────────────────
const MODULE_FILE_CONFIG = {
  financial: {
    label: "PDF, images, CSV, Excel, Word",
    accept: ".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.doc,.docx",
    extensions: ["pdf", "png", "jpg", "jpeg", "csv", "xlsx", "doc", "docx"],
  },
  inventory: {
    label: "Images, PDF, CSV",
    accept: ".png,.jpg,.jpeg,.webp,.pdf,.csv",
    extensions: ["png", "jpg", "jpeg", "webp", "pdf", "csv"],
  },
  tasks: {
    label: "PDF, Word, images",
    accept: ".pdf,.doc,.docx,.png,.jpg,.jpeg",
    extensions: ["pdf", "doc", "docx", "png", "jpg", "jpeg"],
  },
  marketing: {
    label: "Images, PDF, PowerPoint, Word",
    accept: ".png,.jpg,.jpeg,.webp,.svg,.pdf,.ppt,.pptx,.doc,.docx",
    extensions: ["png", "jpg", "jpeg", "webp", "svg", "pdf", "ppt", "pptx", "doc", "docx"],
  },
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(filename) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

export function ChatInput({
  onSend,
  placeholder = "Ask anything…",
  disabled = false,
  module = "financial",
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const fileInputRef = useRef(null);

  const voice = useVoiceRecognition();

  // Sync recognized transcript into the text field
  // User can edit the text before submitting
  useEffect(() => {
    if (voice.transcript) {
      setText(voice.transcript);
    }
  }, [voice.transcript]);

  // Stop voice recognition on unmount (cleanup microphone)
  useEffect(() => {
    return () => voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileConfig = MODULE_FILE_CONFIG[module] || MODULE_FILE_CONFIG.financial;

  // ─── Text submission ┆─────────────────────────────────────────────
  const submit = (e) => {
    e?.preventDefault?.();
    const value = text.trim();
    if (!value || disabled) return;

    // Append attachment filenames to the message (no upload — just listing)
    let message = value;
    if (files.length > 0) {
      const fileList = files
        .map((f) => `${f.name} (${formatFileSize(f.size)})`)
        .join(", ");
      message += `\n\n[Attached: ${fileList}]`;
    }

    onSend?.(message);
    setText("");
    setFiles([]);
    setFileError(null);
    voice.reset();
  };

  // ─── Voice control ┆───────────────────────────────────────────────
  const handleMic = () => {
    if (voice.state === "listening") {
      voice.stop();
    } else if (voice.errorType === "unsupported") {
      // Already showed error — clicking again resets
      voice.reset();
    } else {
      voice.start();
    }
  };

  // ─── File attachment ┆─────────────────────────────────────────────
  const openFilePicker = () => {
    setFileError(null);
    fileInputRef.current?.click();
  };

  const handleFileSelect = useCallback(
    (e) => {
      setFileError(null);
      const selected = Array.from(e.target.files || []);
      if (selected.length === 0) return;

      const errors = [];
      const valid = [];

      for (const file of selected) {
        // Check file count limit
        if (files.length + valid.length >= MAX_FILES) {
          errors.push(`Maximum ${MAX_FILES} files allowed.`);
          break;
        }

        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          errors.push(
            `${file.name} is too large (${formatFileSize(file.size)}). Max ${formatFileSize(MAX_FILE_SIZE)}.`
          );
          continue;
        }

        // Check file type
        const ext = getFileExtension(file.name);
        if (!fileConfig.extensions.includes(ext)) {
          errors.push(
            `${file.name} has unsupported type .${ext}. Allowed: ${fileConfig.label}.`
          );
          continue;
        }

        valid.push(file);
      }

      if (valid.length > 0) {
        setFiles((prev) => [...prev, ...valid]);
      }
      if (errors.length > 0) {
        setFileError(errors.join(" "));
      }

      // Reset the hidden input so the same file can be re-selected later
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [files.length, fileConfig]
  );

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // ─── Derived display state ┆───────────────────────────────────────
  const fullText = text + (voice.interimTranscript ? " " + voice.interimTranscript : "");
  const voiceErrorMessages = {
    "unsupported": "Voice input not supported in this browser (use Chrome or Edge).",
    "permission-denied": "Microphone permission denied. Please allow access in browser settings.",
    "no-speech": "No speech detected. Please try again.",
    "network": "Network error during voice recognition. Check your connection.",
    "aborted": "Voice input was cancelled.",
    "audio-capture": "No microphone found. Please connect a microphone.",
    "unknown": "Voice recognition error. Please try again.",
  };

  return (
    <div className="space-y-2">
      {/* Voice error banner */}
      {voice.state === "error" && voice.errorType && (
        <div className="glass-card flex items-center gap-2 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span className="flex-1">{voiceErrorMessages[voice.errorType] || voiceErrorMessages.unknown}</span>
          <button
            type="button"
            onClick={() => voice.reset()}
            className="text-amber-600 hover:text-amber-800 dark:text-amber-400"
            aria-label="Dismiss voice error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* File error banner */}
      {fileError && (
        <div className="glass-card flex items-center gap-2 px-4 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="flex-1">{fileError}</span>
          <button
            type="button"
            onClick={() => setFileError(null)}
            className="text-red-600 hover:text-red-800 dark:text-red-400"
            aria-label="Dismiss file error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Listening indicator */}
      {voice.state === "listening" && (
        <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 px-4">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          Listening… {voice.interimTranscript && (
            <span className="text-gray-500 dark:text-gray-400 truncate">
              "{voice.interimTranscript}"
            </span>
          )}
        </div>
      )}

      {/* Selected files chips */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {files.map((f, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 glass-card px-3 py-1.5 text-xs"
            >
              <FileIcon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="font-medium text-gray-900 dark:text-white truncate max-w-[160px]">
                  {f.name}
                </span>
                <span className="text-gray-400 dark:text-gray-500">
                  {formatFileSize(f.size)} · .{getFileExtension(f.name)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 shrink-0"
                aria-label={`Remove ${f.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main input bar */}
      <form
        onSubmit={submit}
        className="glass-card flex items-center gap-3 px-4 py-3"
      >
        {/* File attachment button */}
        <button
          type="button"
          onClick={openFilePicker}
          aria-label={`Attach file (${fileConfig.label})`}
          title={`Attach file — ${fileConfig.label}, max ${formatFileSize(MAX_FILE_SIZE)}`}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-white/60 dark:text-gray-400 dark:hover:bg-white/10 transition shrink-0"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={fileConfig.accept}
          onChange={handleFileSelect}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Text input */}
        <input
          type="text"
          value={fullText}
          onChange={(e) => {
            setText(e.target.value);
            // If user edits while voice is active, update the transcript base
            if (voice.state === "idle") voice.reset();
          }}
          placeholder={voice.state === "listening" ? "Speaking…" : placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
        />

        {/* Voice / Mic button */}
        <button
          type="button"
          onClick={handleMic}
          aria-label={voice.state === "listening" ? "Stop voice input" : "Start voice input"}
          title={voice.state === "listening" ? "Stop recording" : "Voice input (Chrome/Edge)"}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition shrink-0 ${
            voice.state === "listening"
              ? "bg-rose-100 text-rose-600 dark:bg-rose-400/20 dark:text-rose-300"
              : voice.state === "error"
                ? "text-amber-600 dark:text-amber-400"
                : "text-gray-500 hover:bg-white/60 dark:text-gray-400 dark:hover:bg-white/10"
          }`}
        >
          {voice.state === "listening" ? (
            <Square className="w-4 h-4" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>

        {/* Submit button */}
        {text.trim() && (
          <button
            type="submit"
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition flex items-center gap-1.5 shrink-0"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        )}
      </form>
    </div>
  );
}
