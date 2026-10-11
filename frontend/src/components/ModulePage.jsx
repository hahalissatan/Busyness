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
 *
 * Chat is wired to the backend conversational AI endpoint:
 *   POST /api/businesses/:businessId/agent/chat { message, context }
 * Returns natural-language responses with conversation context support.
 *
 * The conversational endpoint supports:
 *   - Greetings and small talk
 *   - Follow-up questions (uses conversation context)
 *   - Data-backed questions (real database queries scoped to business)
 *   - Clarification requests for ambiguous input
 *
 * A small badge shows whether the provider is "mock" or "live".
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChatInput } from "./ChatInput.jsx";
import { FeatureCard } from "./FeatureCard.jsx";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";

export function ModulePage({
  title,
  subtitle = "What can I help you today?",
  features = [],
  chatPlaceholder = "Ask anything…",
  onAsk,
  module = "financial",
  children,
}) {
  const { business } = useAuth();
  const navigate = useNavigate();
  const [thread, setThread] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [providerInfo, setProviderInfo] = useState(null);

  const handleAsk = async (question) => {
    // If a module provides a custom onAsk, use it (future specialist routing)
    if (onAsk) {
      const result = await onAsk(question);
      if (result !== undefined) {
        setThread((t) => [...t, { role: "user", text: question }, { role: "assistant", text: result }]);
        return;
      }
    }

    // Call the backend conversational AI endpoint
    // Send conversation context (prior messages) for follow-up support
    setThinking(true);
    try {
      // Build context from current thread for the API
      const context = thread.map((m) => ({
        role: m.role,
        content: m.text,
      }));

      const res = await api.post(`/api/businesses/${business?.id}/agent/chat`, {
        message: question,
        context,
      });

      const reply = res?.reply || "No response from assistant.";

      // Track provider info for display
      if (res?.provider) {
        setProviderInfo({
          provider: res.provider,
          isLive: res.is_live || false,
        });
      }

      setThread((t) => [
        ...t,
        { role: "user", text: question },
        {
          role: "assistant",
          text: reply,
          // Store tool calls and invoice data for rich rendering
          tool_calls: res?.tool_calls || [],
          // Check if this is an invoice creation success
          invoice_created: reply.includes("Invoice created successfully!"),
          // Extract invoice number for linking
          invoice_number: (() => {
            const m = reply.match(/Invoice number:\s*(\S+)/);
            return m ? m[1] : null;
          })(),
        },
      ]);
    } catch (err) {
      setThread((t) => [
        ...t,
        { role: "user", text: question },
        {
          role: "assistant",
          text: `Sorry, I couldn't process that request. ${err.message || "Please try again."}`,
        },
      ]);
    } finally {
      setThinking(false);
    }
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
          {thread.map((m, i) => {
            const isInvoiceCreated = m.invoice_created;
            return (
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
              {/* Invoice action button */}
              {isInvoiceCreated && m.invoice_number && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => navigate("/financial/invoices")}
                    className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 transition"
                  >
                    Open Invoices
                  </button>
                </div>
              )}
            </div>
            );
          })}
          {/* Thinking indicator */}
          {thinking && (
            <div className="glass-card mr-12 px-4 py-3 text-sm">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Assistant
              </div>
              <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" style={{ animationDelay: "300ms" }} />
                <span className="ml-1">Processing your request…</span>
              </div>
            </div>
          )}
          {/* Provider badge */}
          {providerInfo && (
            <div className="text-center">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                providerInfo.isLive
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${providerInfo.isLive ? "bg-emerald-500" : "bg-amber-500"}`} />
                {providerInfo.isLive ? "Live LLM" : "Mock AI"}
              </span>
            </div>
          )}
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
        <ChatInput onSend={handleAsk} placeholder={chatPlaceholder} module={module} disabled={thinking} />
      </div>
    </div>
  );
}