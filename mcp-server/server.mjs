/**
 * BUSYNESS MCP Server — Read-only bridge for WorkBuddy → BUSYNESS backend.
 *
 * This is a stdio MCP server that WorkBuddy launches as a child process.
 * It exposes the 8 read-only BUSYNESS tools via the MCP protocol.
 *
 * Architecture:
 *   WorkBuddy AI (MCP client)
 *     ↕ stdio (JSON-RPC over stdin/stdout)
 *   BUSYNESS MCP Server (this file)
 *     ↕ HTTP (authenticated REST API)
 *   BUSYNESS Backend (Express, port 3001)
 *     ↀ PostgreSQL database
 *
 * Security:
 *   - The MCP server authenticates to the BUSYNESS backend using a
 *     pre-configured JWT token (from env var BUSYNESS_AUTH_TOKEN).
 *   - The businessId is validated server-side via requireBusinessAccess
 *     middleware — it is NOT trusted from the MCP client.
 *   - All tools are READ-ONLY — no write, update, or delete operations.
 *   - Requests have a 10-second timeout to prevent resource exhaustion.
 *   - No arbitrary SQL — only predefined parameterized queries.
 *   - The MCP server process runs locally, no network exposure.
 *   - Tool names are validated against a static allowlist — no injection.
 *
 * Usage:
 *   Configured in ~/.workbuddy-ai/mcp.json:
 *   {
 *     "mcpServers": {
 *       "busyness": {
 *         "type": "stdio",
 *         "command": "node",
 *         "args": ["C:/path/to/busyness/mcp-server/server.mjs"],
 *         "env": {
 *           "BUSYNESS_API_URL": "http://localhost:3001",
 *           "BUSYNESS_AUTH_TOKEN": "<JWT token>",
 *           "BUSYNESS_BUSINESS_ID": "<business UUID>"
 *         }
 *       }
 *     }
 *   }
 *
 * The JWT token and businessId are obtained by logging in via
 * POST /api/auth/login and GET /api/auth/me.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// --- Configuration -----------------------------------------------------------

const API_URL = process.env.BUSYNESS_API_URL || "http://localhost:3001";
const AUTH_TOKEN = process.env.BUSYNESS_AUTH_TOKEN || "";
const BUSINESS_ID = process.env.BUSYNESS_BUSINESS_ID || "";
const REQUEST_TIMEOUT_MS = 10000;

if (!AUTH_TOKEN) {
  console.error("[busyness-mcp] FATAL: BUSYNESS_AUTH_TOKEN env var is not set.");
  console.error("[busyness-mcp] Obtain a JWT token via POST /api/auth/login.");
  process.exit(1);
}
if (!BUSINESS_ID) {
  console.error("[busyness-mcp] FATAL: BUSYNESS_BUSINESS_ID env var is not set.");
  console.error("[busyness-mcp] Obtain a businessId via GET /api/auth/me.");
  process.exit(1);
}

// --- Tool Definitions -------------------------------------------------------

/**
 * The 8 read-only tools exposed to WorkBuddy.
 * Each tool maps to the BUSYNESS backend's unified tool execution endpoint:
 *   POST /api/businesses/:businessId/agent/tools/:toolName
 *
 * All tools are READ-ONLY — no write, update, or delete operations.
 * businessId is injected server-side from the authenticated JWT context.
 */
const TOOLS = [
  {
    name: "get_inventory_summary",
    description: "Get a summary of inventory: total products, total value, low stock count, out of stock count. Returns aggregate metrics for the current business.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_low_stock",
    description: "Get products at or below their minimum stock threshold. Returns up to 20 items that need reordering, sorted by urgency.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_task_overview",
    description: "Get a summary of tasks: total, pending, in_progress, completed, and overdue counts.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_team_workload",
    description: "Get per-team-member task assignments, active tasks, and overdue tasks. Shows who is busy and who has overdue items.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_financial_overview",
    description: "Get a financial overview: invoice counts by status (draft, unpaid, partially_paid, paid, overdue), total revenue, collected, and outstanding amounts.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_customer_summary",
    description: "Get a customer summary: total customers and new customers in the last 30 days.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_marketing_overview",
    description: "Get a marketing overview: projects by status, total drafts, and pitch deck counts.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_products",
    description: "Search products by name, SKU, or description. Pass { search_term: string } (minimum 2 characters). Returns up to 20 matching active products.",
    inputSchema: {
      type: "object",
      properties: {
        search_term: {
          type: "string",
          description: "The search term to look for in product name, SKU, or description. Minimum 2 characters.",
          minLength: 2,
        },
      },
      required: ["search_term"],
    },
  },
];

// Static allowlist for tool name validation — prevents injection.
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// --- API Call Helper --------------------------------------------------------

/**
 * Make an authenticated POST request to the BUSYNESS backend's tool endpoint.
 *
 * Security:
 *   - Uses the pre-configured JWT token (never from client input).
 *   - businessId is embedded in the URL from server-side config.
 *   - Tool name is validated against a static allowlist before the request.
 *   - 10-second timeout via AbortController.
 *   - Returns parsed JSON or throws an error.
 */
async function callBusynessTool(toolName, args = {}) {
  // Validate tool name against the static allowlist
  if (!TOOL_NAMES.has(toolName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const url = `${API_URL}/api/businesses/${BUSINESS_ID}/agent/tools/${toolName}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AUTH_TOKEN}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ args }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => "(no body)");
      throw new Error(`BUSYNESS API ${response.status}: ${errText}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(`BUSYNESS API request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

// --- MCP Server Setup -------------------------------------------------------

const server = new Server(
  {
    name: "busyness",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tool Listing -----------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
});

// --- Tool Execution ---------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  // Validate tool name against the static allowlist
  if (!TOOL_NAMES.has(name)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Unknown tool "${name}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await callBusynessTool(name, args);

    // Return the raw JSON result as text content
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error calling ${name}: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
});

// --- Start Server -----------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[busyness-mcp] Server started. Connected via stdio.");
  console.error(`[busyness-mcp] API URL: ${API_URL}`);
  console.error(`[busyness-mcp] Business ID: ${BUSINESS_ID}`);
  console.error(`[busyness-mcp] Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
}

main().catch((err) => {
  console.error("[busyness-mcp] Fatal error:", err);
  process.exit(1);
});
