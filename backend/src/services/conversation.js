/**
 * services/conversation.js — Conversational AI coordinator service.
 *
 * Manages conversation context (in-memory, no DB tables), routes messages
 * through the LLM provider, executes tools server-side, and produces
 * natural-language responses grounded in the authenticated user's business
 * data.
 *
 * Design principles:
 *   - NO new database tables or migrations — context is passed in the
 *     request body and validated server-side.
 *   - Context is isolated per user+business — never trusts client-supplied
 *     tool results as facts.
 *   - Tools are executed server-side only, using businessId from the
 *     authenticated request context.
 *   - Read-only tools perform queries. Write tools (create_invoice)
 *     perform inserts through the existing validated backend services
 *     with transactional integrity and duplicate prevention.
 *   - Tool calls and result sizes are limited.
 *
 * Lifecycle:
 *   1. Validate and sanitize the incoming message + context
 *   2. Call the LLM provider (mock or live)
 *   3. If the provider returns tool_calls, execute them server-side
 *   4. Write audit log
 *   5. Return the response + updated context
 */

import { randomUUID } from "crypto";
import { query } from "../db/pool.js";
import { generateResponse, getProviderInfo, executeTool } from "./llmProvider.js";

// --- Constants -----------------------------------------------------------

const MAX_MESSAGE_LENGTH = 1000;
const MAX_CONTEXT_MESSAGES = 20;       // max messages in context array
const MAX_CONTEXT_TOTAL_LENGTH = 20000; // total chars across all context messages
const VALID_ROLES = new Set(["user", "assistant"]);

// --- Validation ----------------------------------------------------------

/**
 * Validate the user's message.
 *
 * @param {string} message
 * @returns {{ valid: boolean, error?: string, value?: string }}
 */
function validateMessage(message) {
  if (!message || typeof message !== "string") {
    return { valid: false, error: "Message is required and must be a string" };
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: "Message cannot be empty" };
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate and sanitize conversation context from the client.
 *
 * SECURITY:
 *   - Only 'user' and 'assistant' roles are allowed.
 *   - Each message content is length-capped.
 *   - Total context size is capped.
 *   - Context is informational only — never used as facts.
 *   - Client-supplied tool results are NEVER trusted as facts.
 *
 * @param {Array<{role: string, content: string}>} context
 * @returns {{ valid: boolean, error?: string, value?: Array }}
 */
function validateContext(context) {
  if (!context) return { valid: true, value: [] };

  if (!Array.isArray(context)) {
    return { valid: false, error: "Context must be an array of messages" };
  }

  if (context.length > MAX_CONTEXT_MESSAGES) {
    // Truncate to last N messages rather than rejecting
    context = context.slice(-MAX_CONTEXT_MESSAGES);
  }

  const sanitized = [];
  let totalLength = 0;

  for (const msg of context) {
    if (!msg || typeof msg !== "object") continue;

    const role = msg.role;
    const content = msg.content;

    if (!VALID_ROLES.has(role)) {
      // Skip invalid roles rather than rejecting — be lenient
      continue;
    }

    if (typeof content !== "string") continue;

    const trimmedContent = content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (trimmedContent.length === 0) continue;

    totalLength += trimmedContent.length;
    if (totalLength > MAX_CONTEXT_TOTAL_LENGTH) break;

    sanitized.push({ role, content: trimmedContent });
  }

  return { valid: true, value: sanitized };
}

// --- Main conversation handler ------------------------------------------

/**
 * Process a conversational message.
 *
 * @param {object} params
 * @param {string} params.businessId - Verified business UUID from auth middleware
 * @param {string} params.userId - Verified user UUID from auth middleware
 * @param {string} params.message - User's message text
 * @param {Array<{role, content}>} params.context - Prior conversation context
 * @returns {Promise<object>} { reply, context, provider, isLive, tool_calls, conversation_id }
 */
export async function handleConversation({ businessId, userId, message, context = [] }) {
  // 1. Validate message
  const msgValidation = validateMessage(message);
  if (!msgValidation.valid) {
    throw new Error(msgValidation.error);
  }

  // 2. Validate context
  const ctxValidation = validateContext(context);
  if (!ctxValidation.valid) {
    throw new Error(ctxValidation.error);
  }

  const sanitizedContext = ctxValidation.value;
  const conversationId = randomUUID();

  // 3. Generate response via LLM provider
  const result = await generateResponse({
    message: msgValidation.value,
    context: sanitizedContext,
    businessId,
    userId,
  });

  // 4. Write audit log
  try {
    await query(
      `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        businessId,
        userId,
        "conversation_message",
        "conversation",
        conversationId,
        JSON.stringify({
          message_length: msgValidation.value.length,
          context_length: sanitizedContext.length,
          provider: result.provider,
          is_live: result.isLive || false,
          tool_calls: result.tool_calls || [],
          has_error: Boolean(result.error),
        }),
      ]
    );
  } catch {
    // Audit log failure should not block the response
    // (database might be unavailable in some environments)
  }

  // 5. Build updated context (append user message + assistant reply)
  const updatedContext = [
    ...sanitizedContext,
    { role: "user", content: msgValidation.value },
    { role: "assistant", content: result.reply },
  ].slice(-MAX_CONTEXT_MESSAGES);

  return {
    reply: result.reply,
    context: updatedContext,
    provider: result.provider,
    is_live: result.isLive || false,
    tool_calls: result.tool_calls || [],
    conversation_id: conversationId,
  };
}

// --- Export helpers for testing ------------------------------------------

export { validateMessage, validateContext, MAX_MESSAGE_LENGTH, MAX_CONTEXT_MESSAGES, MAX_CONTEXT_TOTAL_LENGTH };
