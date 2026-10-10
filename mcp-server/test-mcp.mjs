/**
 * Test script for the BUSYNESS MCP Server.
 * Uses the MCP SDK's client + StdioClientTransport to connect to our server.
 *
 * Usage:
 *   node test-mcp.mjs
 *
 * Expects env vars: BUSYNESS_AUTH_TOKEN, BUSYNESS_BUSINESS_ID
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUTH_TOKEN = process.env.BUSYNESS_AUTH_TOKEN || "";
const BUSINESS_ID = process.env.BUSYNESS_BUSINESS_ID || "";

if (!AUTH_TOKEN || !BUSINESS_ID) {
  console.error("FATAL: BUSYNESS_AUTH_TOKEN and BUSYNESS_BUSINESS_ID env vars must be set.");
  process.exit(1);
}

async function main() {
  console.log("=== Starting MCP Server Test ===\n");

  // Create a stdio client transport that launches our server
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(__dirname, "server.mjs")],
    env: {
      ...process.env,
      BUSYNESS_API_URL: "http://localhost:3001",
      BUSYNESS_AUTH_TOKEN: AUTH_TOKEN,
      BUSYNESS_BUSINESS_ID: BUSINESS_ID,
    },
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  await client.connect(transport);
  console.log("[test] Connected to MCP server.\n");

  // --- Test 1: List tools ---
  console.log("--- Test 1: List Tools ---");
  const toolsResponse = await client.listTools();
  console.log(`Found ${toolsResponse.tools.length} tools:`);
  for (const tool of toolsResponse.tools) {
    console.log(`  - ${tool.name}: ${tool.description.substring(0, 80)}...`);
  }
  console.log();

  // --- Test 2: Call get_inventory_summary ---
  console.log("--- Test 2: get_inventory_summary ---");
  const invResult = await client.callTool({
    name: "get_inventory_summary",
    arguments: {},
  });
  console.log("Result:", invResult.content[0].text);
  console.log();

  // --- Test 3: Call get_low_stock ---
  console.log("--- Test 3: get_low_stock ---");
  const lowStockResult = await client.callTool({
    name: "get_low_stock",
    arguments: {},
  });
  console.log("Result:", lowStockResult.content[0].text);
  console.log();

  // --- Test 4: Call get_task_overview ---
  console.log("--- Test 4: get_task_overview ---");
  const taskResult = await client.callTool({
    name: "get_task_overview",
    arguments: {},
  });
  console.log("Result:", taskResult.content[0].text);
  console.log();

  // --- Test 5: Call get_financial_overview ---
  console.log("--- Test 5: get_financial_overview ---");
  const finResult = await client.callTool({
    name: "get_financial_overview",
    arguments: {},
  });
  console.log("Result:", finResult.content[0].text);
  console.log();

  // --- Test 6: Call search_products ---
  console.log("--- Test 6: search_products (rice) ---");
  const searchResult = await client.callTool({
    name: "search_products",
    arguments: { search_term: "rice" },
  });
  console.log("Result:", searchResult.content[0].text);
  console.log();

  // --- Test 7: Call get_team_workload ---
  console.log("--- Test 7: get_team_workload ---");
  const workloadResult = await client.callTool({
    name: "get_team_workload",
    arguments: {},
  });
  console.log("Result:", workloadResult.content[0].text);
  console.log();

  // --- Test 8: Call get_customer_summary ---
  console.log("--- Test 8: get_customer_summary ---");
  const customerResult = await client.callTool({
    name: "get_customer_summary",
    arguments: {},
  });
  console.log("Result:", customerResult.content[0].text);
  console.log();

  // --- Test 9: Call get_marketing_overview ---
  console.log("--- Test 9: get_marketing_overview ---");
  const marketingResult = await client.callTool({
    name: "get_marketing_overview",
    arguments: {},
  });
  console.log("Result:", marketingResult.content[0].text);
  console.log();

  // --- Test 10: Call unknown tool (should error) ---
  console.log("--- Test 10: Unknown tool (should error) ---");
  const errorResult = await client.callTool({
    name: "delete_everything",
    arguments: {},
  });
  console.log("Result:", errorResult.content[0].text);
  console.log("isError:", errorResult.isError);
  console.log();

  console.log("=== All 10 tests completed successfully ===");
  await transport.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
