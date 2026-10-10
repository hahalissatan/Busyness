/**
 * ChatInput — bottom-of-page prompt bar matching the template.
 * Shows + (action menu placeholder), a text field, and a mic icon.
 *
 * On submit, posts a question and renders the response in the chat
 * thread above (handled by the parent via `onSend`).
 */

import { useState } from "react";

export function ChatInput({ onSend, placeholder = "Ask anything…", disabled = false }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);

  const submit = (e) => {
    e?.preventDefault?.();
    const value = text.trim();
    if (!value || disabled) return;
    onSend?.(value);
    setText("");
  };

  const handleMic = () => {
    // Browser Web Speech API support is patchy; we toggle a visual state
    // so users see the mic responding without claiming voice input.
    setListening((v) => !v);
    setTimeout(() => setListening(false), 1500);
  };

  return (
    <form
      onSubmit={submit}
      className="glass-card flex items-center gap-3 px-4 py-3"
    >
      <button
        type="button"
        aria-label="Add attachment"
        className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-white/60 dark:text-gray-400 dark:hover:bg-white/10 transition text-lg"
      >
        +
      </button>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
      />
      <button
        type="button"
        onClick={handleMic}
        aria-label="Voice input"
        className={`w-9 h-9 rounded-xl flex items-center justify-center transition text-lg ${
          listening
            ? "bg-rose-100 text-rose-600 animate-pulse dark:bg-rose-400/20 dark:text-rose-300"
            : "text-gray-500 hover:bg-white/60 dark:text-gray-400 dark:hover:bg-white/10"
        }`}
      >
        🎤
      </button>
      {text.trim() && (
        <button
          type="submit"
          className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition"
        >
          Send
        </button>
      )}
    </form>
  );
}