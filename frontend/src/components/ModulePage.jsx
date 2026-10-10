/**
 * ModulePage — the AI-agent landing layout shared by all four modules.
 *
 * Structure (matches the template):
 *   - Large page title (e.g. "Inventory AI")
 *   - Subtitle: "What can I help you today?"
 *   - Three feature cards (rectangles)
 *   - Chat input at the bottom
 *
 * Props let each module customise the title, accent, and feature list.
 * `messages` (optional) renders a chat thread above the feature cards.
 */

import { useState } from "react";
import { ChatInput } from "./ChatInput.jsx";
import { FeatureCard } from "./FeatureCard.jsx";

export function ModulePage({
  title,
  subtitle = "What can I help you today?",
  features = [],
  chatPlaceholder = "Ask anything…",
  onAsk,
  children,
}) {
  const [thread, setThread] = useState([]);

  const handleAsk = async (question) => {
    if (onAsk) {
      const result = await onAsk(question);
      if (result !== undefined) {
        setThread((t) => [...t, { role: "user", text: question }, { role: "assistant", text: result }]);
        return;
      }
    }
    // Default fallback echo
    setThread((t) => [
      ...t,
      { role: "user", text: question },
      {
        role: "assistant",
        text:
          "I'm a demo agent. Connect a backend handler via the `onAsk` prop to enable real responses.",
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto animate-fade-in">
      {/* Title block */}
      <div className="text-center pt-4">
        <h1 className="text-3xl md:text-5xl font-display font-bold text-gray-900 dark:text-white">
          {title}
        </h1>
        <p className="mt-2 text-base md:text-lg text-gray-600 dark:text-gray-300">
          {subtitle}
        </p>
      </div>

      {/* Chat thread (if any) */}
      {thread.length > 0 && (
        <div className="space-y-3 max-w-2xl mx-auto w-full">
          {thread.map((m, i) => (
            <div
              key={i}
              className={`glass-card px-4 py-3 text-sm ${
                m.role === "user"
                  ? "ml-12 bg-brand-50/70 dark:bg-brand-400/10"
                  : "mr-12"
              }`}
            >
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {m.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="text-gray-900 dark:text-white whitespace-pre-wrap">
                {m.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Three feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {features.map((f, i) => (
          <FeatureCard key={i} {...f} />
        ))}
      </div>

      {/* Optional custom content (e.g. embedded views) */}
      {children}

      {/* Chat input pinned to page bottom area */}
      <div className="sticky bottom-4 mt-4">
        <ChatInput onSend={handleAsk} placeholder={chatPlaceholder} />
      </div>
    </div>
  );
}