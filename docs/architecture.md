PHASE 1 — SYSTEM ARCHITECTURE & TECHNICAL DESIGN CONFIRMATION 

Project: Busyness –   

1. Your Role 

Act as a senior software architect, full-stack engineer, database designer, and AI agent architect. 

Our team is participating in a hackathon with the theme: 

“Can your AI Agent use WorkBuddy to solve a real problem and actually get things done?” 

We are building BizPilot AI, an AI-powered business operations platform for small and medium-sized businesses. 

Before writing any implementation code, analyse our requirements and produce a complete, consistent technical architecture for our team to review and approve. 

Important: This phase is for architecture planning and confirmation only. Do not generate the complete application code yet. 

 

2. Core Concept: One Coordinator Agent + Four Specialist Agents 

The application must not be just a dashboard containing four independent CRUD modules. Its main feature is an AI agent that can understand a business goal, plan a workflow, use tools, coordinate specialist agents, execute permitted actions, verify the results, and deliver a final outcome. 

Design the system around the following five agents. 

Agent 0 — Coordinator Agent (Main Orchestrator) 

This is the main agent that interacts with the user and coordinates the entire workflow. 

Responsibilities: 

Accept a natural-language business goal from the user. 

Understand the goal, constraints, desired outcome, and relevant business context. 

Break the goal into smaller tasks and create a dependency-aware execution plan. 

Decide which specialist agents and tools are required. 

Delegate independent tasks to specialist agents, allowing parallel execution when appropriate. 

Coordinate dependent tasks in the correct order. 

Use WorkBuddy through a supported integration to perform relevant work. 

Collect specialist-agent results and reconcile conflicting or incomplete findings. 

Handle failures, retry recoverable operations, and adapt the plan when necessary. 

Require human approval before consequential actions that should not be performed autonomously. 

Verify that requested actions actually succeeded by checking the relevant API response or persisted database records. 

Produce a final report containing findings, supporting evidence, completed actions, pending approvals, unresolved issues, and recommendations. 

The Coordinator Agent must not invent results or claim that a task is completed merely because a tool was called. 

Agent 1 — Financial Intelligence Agent 

Responsibilities: 

Retrieve and analyse invoices, invoice items, payments, expenses, and financial records. 

Calculate outstanding balances, overdue invoices, revenue, expenses, and cash-flow indicators. 

Identify overdue payments and potential cash-flow risks. 

Produce forecasts for the next 7, 30, and 90 days, with assumptions clearly stated. 

Recommend payment follow-ups and financial actions. 

Generate financial summaries and reports. 

Return structured findings and supporting record IDs to the Coordinator Agent. 

Financial calculations must use reliable backend functions, not unsupported AI-generated arithmetic. 

Agent 2 — Inventory Intelligence Agent 

Responsibilities: 

Retrieve inventory, stock movement, sales, supplier, cost, and expiry records. 

Identify low-stock items, excess stock, expiry risks, and potential stockouts. 

Analyse available demand or sales history where sufficient data exists. 

Recommend replenishment quantities and suppliers while considering budget and stockout risks. 

Coordinate with the Financial Intelligence Agent when a recommendation depends on cash flow or available budget. 

Return structured recommendations, supporting data, estimated costs, and risk explanations. 

The agent must not directly change stock quantities simply because it recommends replenishment. Actual inventory changes must be performed through authorised backend functions and recorded in an audit log. 

Agent 3 — Intelligent Task Allocation Agent 

Responsibilities: 

Retrieve employee profiles, skills, availability, workloads, and existing assignments. 

Retrieve existing tasks, deadlines, priorities, and statuses. 

Recommend task assignments based on skill suitability, workload, availability, and urgency. 

Create a prioritised action plan from approved recommendations. 

Assign or create tasks through backend functions when permitted. 

Explain why each employee or task was selected. 

Return created task IDs and execution status to the Coordinator Agent. 

Avoid duplicate tasks and conflicting assignments. Require approval when configured rules or the impact of an assignment demand it. 

Agent 4 — Marketing & Pitch Deck Agent 

Responsibilities: 

Generate structured 10-slide pitch deck outlines. 

Analyse business information, target customers, pain points, motivations, and value propositions. 

Generate customer personas and marketing recommendations. 

Produce marketing campaign ideas and social media content drafts. 

Save and retrieve pitch deck outlines and marketing drafts through the backend. 

Return structured results to the Coordinator Agent. 

Treat social media publishing, external communications, and other consequential actions as approval-required unless an explicitly authorised integration and policy permit automatic execution. 

Agent 5 — Quality Assurance & Reporting Agent 

Responsibilities: 

Validate the completeness and consistency of specialist-agent outputs. 

Check financial totals and inventory recommendations against authoritative backend results. 

Verify that record IDs exist and that reported actions match actual execution results. 

Detect duplicate actions, missing data, unsupported claims, and conflicting recommendations. 

Check whether the original user goal and acceptance criteria have been satisfied. 

Request correction or re-execution when a result fails validation. 

Generate a clear, evidence-based final report for the Coordinator Agent. 

This agent must independently check results where possible rather than simply accepting another agent's claims. 

Note: There are five specialist/orchestration roles in total after the Coordinator: four specialist agents were originally planned, but Quality Assurance is an additional cross-cutting role. Recommend whether it should be implemented as a separate agent or as a validation stage inside the Coordinator Agent for the first MVP. Explain the trade-offs. 

 

3. Original Application Modules 

The application must support the following business modules. All modules must share one backend, database, authentication model, API conventions, and design system. 

Module A — Financial Hub 

Features: 

Create, view, edit, search, filter, sort, and delete invoices, subject to record and payment integrity rules. 

Manage invoice items and calculate subtotal, tax, discount, and final amount. 

Support Draft, Unpaid, Partially Paid, Paid, and Overdue statuses. 

Record partial and full payments and calculate outstanding balances. 

Track due dates and overdue invoices. 

Generate invoice PDFs and financial reports. 

Export reports to CSV and PDF. 

Support cash-flow analytics and 7-day, 30-day, and 90-day forecasts. 

Provide AI alerts and recommendations grounded in actual financial records. 

Support payment reminders, with approval before sending external messages. 

Use Malaysian Ringgit (RM) as the default currency. 

Module B — Smart Stock & Inventory 

Features: 

Create, view, edit, search, filter, and sort inventory records. 

Track item name, SKU, stock quantity, minimum stock threshold, unit cost, inventory value, and expiry date where applicable. 

Record stock movements and maintain movement history. 

Detect low-stock and near-expiry items. 

Analyse historical sales or demand data when available. 

Maintain supplier information. 

Recommend replenishment quantities and suppliers. 

Consider available budget, inventory levels, demand, and stockout risk. 

Connect inventory purchasing recommendations to the Financial Hub. 

Ensure all stock changes go through backend validation and are recorded. 

Module C — AI Marketing & Pitch Deck Engine 

Features: 

Generate structured 10-slide pitch deck outlines. 

Save, retrieve, edit, and delete saved drafts. 

Generate customer personas and identify pain points, motivations, and target segments. 

Produce marketing strategies and campaign recommendations. 

Generate social media content drafts. 

Design future integration points for campaign scheduling and publishing, without pretending unsupported integrations are operational. 

Module D — Intelligent Task Allocation 

Features: 

Maintain employee profiles, skills, availability, and workloads. 

Create, view, edit, assign, and track tasks. 

Track priority, status, deadline, assignee, and task description. 

Recommend assignments based on skills, availability, workload, and urgency. 

Explain recommendations. 

Allow manager approval, manual override, and reassignment. 

Avoid duplicate tasks and conflicting assignments. 

 

4. Main Agentic Demonstration Scenario 

The architecture must prioritise one complete, demonstrable end-to-end workflow. 

Example user prompt: 

“Help my business reduce cash-flow risk over the next 30 days. Identify overdue payments, recommend inventory adjustments without causing stockouts, and create a prioritised action plan for my team. Show me the evidence behind every recommendation.” 

Expected workflow: 

The Coordinator Agent understands the goal and identifies constraints. 

It creates an execution plan and determines task dependencies. 

It asks the Financial Intelligence Agent to retrieve invoice and payment data. 

It asks the Inventory Intelligence Agent to inspect stock, expiry, demand, and replenishment risks. Independent analyses should run in parallel where appropriate. 

It combines financial and inventory findings, checking whether inventory recommendations fit the available budget. 

It asks the Task Allocation Agent to convert approved recommendations into prioritised team tasks. 

It executes permitted operations through defined backend tools and the supported WorkBuddy integration. 

It requests quality checks on calculations, record IDs, task creation, and action results. 

It corrects failures or reports unresolved issues instead of hiding them. 

It produces a final report showing: 

Main financial risks. 

Overdue invoices and outstanding amounts. 

Inventory risks and recommended adjustments. 

Budget implications and forecast assumptions. 

Recommended actions and task priorities. 

Records or tasks actually created. 

WorkBuddy operations actually performed, where applicable. 

Actions requiring approval. 

Verification results and remaining limitations. 

Use realistic seeded demo data so the workflow can be tested repeatedly. Clearly distinguish demo data from real connected business data. 

 

5. WorkBuddy Integration — Critical Requirement 

Our hackathon theme explicitly focuses on an AI agent using WorkBuddy to solve a real problem and complete actual work. 

Therefore, investigate how the application can interact with WorkBuddy at runtime. 

Before proposing an implementation: 

Identify the supported WorkBuddy APIs, Open Platform interfaces, SDKs, connectors, tool-calling mechanisms, or other authorised integration methods available in our environment. 

Explain how the application sends or delegates a task to WorkBuddy. 

Explain how it receives results, status updates, errors, and any generated artifacts. 

Explain how the application can verify completed actions. 

Explain authentication, permissions, configuration, and relevant limitations. 

Distinguish between using WorkBuddy to generate source code during development and using WorkBuddy as part of the deployed application's runtime workflow. 

Do not invent API endpoints, SDK methods, environment variables, or platform capabilities. 

If integration documentation or credentials are unavailable, clearly identify what must be confirmed before implementation. 

Recommend a practical architecture that makes WorkBuddy's contribution visible and verifiable during the hackathon demonstration. 

If direct runtime integration is not supported, explain the available alternatives and whether each would satisfy the stated hackathon requirement. Do not claim full compliance without evidence. 

 

6. Technical Architecture to Propose 

Recommend a suitable technology stack based on the tools actually available to us. Do not choose a technology simply because it is popular. 

Provide the following: 

A. System architecture 

Frontend framework and structure. 

Backend framework and structure. 

Database technology and schema strategy. 

Authentication and authorisation. 

Agent orchestration layer. 

WorkBuddy integration layer. 

Tool/function-calling layer. 

Logging, error handling, and audit trail. 

Testing and deployment strategy. 

Include a Mermaid architecture diagram showing the frontend, backend APIs, Coordinator Agent, four specialist agents, QA/validation stage, WorkBuddy integration, and shared database. 

B. Project folder structure 

Propose a complete folder tree, including: 

Frontend pages and reusable components. 

API client and HTTP utility functions. 

Backend routes, controllers, services, and middleware. 

Database schema, migrations, and seed data. 

Agent definitions, prompts, orchestration, and tool registry. 

WorkBuddy adapter or integration service. 

Validation schemas and shared types. 

Tests, configuration, and documentation. 

Explain the responsibility of each important folder and file. 

C. Database design 

List each proposed table with: 

Table name. 

Purpose. 

Columns and data types. 

Primary keys and foreign keys. 

Required fields and constraints. 

Relationships and indexes. 

Important validation rules. 

Include appropriate tables for invoices, invoice items, payments, expenses where applicable, inventory items, stock movements, suppliers, employees, tasks, pitch deck drafts, marketing drafts, agent runs, agent steps, tool executions, approvals, and audit logs. 

Avoid storing the same business fact redundantly across modules. Explain how invoice payments and stock movements remain consistent. 

D. API endpoint contract 

Provide a complete endpoint inventory using consistent REST conventions. 

For every endpoint, specify: 

HTTP method. 

Exact proposed path. 

Purpose. 

Request body or query parameters. 

Response structure. 

Authentication and authorisation requirements. 

Validation rules. 

Possible error responses. 

Whether it changes data or only reads data. 

Include endpoints for: 

Authentication and current user. 

Invoices and invoice items. 

Payments. 

Expenses and financial analytics. 

Cash-flow forecasts and reports. 

Inventory items and stock movements. 

Suppliers and restocking recommendations. 

Employees and task management. 

Pitch deck drafts and marketing drafts. 

Agent runs, plans, step status, tool execution, approvals, and final reports. 

Health checks and readiness checks. 

For agent-related endpoints, consider a consistent interface such as: 

POST /api/agent-runs 

GET /api/agent-runs/ 

GET /api/agent-runs//steps 

POST /api/agent-runs//approve 

POST /api/agent-runs//cancel 

These are proposed paths, not pre-existing APIs. Refine them if a better design is justified. Do not assume these paths are WorkBuddy endpoints. 

E. HTTP functions and API client 

Specify the shared frontend HTTP functions, such as: 

httpGet() 

httpPost() 

httpPut() or httpPatch() 

httpDelete() 

Explain base URL configuration, headers, JSON serialization, timeouts, authentication, error handling, and response parsing. 

Show how module-specific API functions should call the shared HTTP client rather than duplicating fetch logic. 

If the selected stack requires different conventions, propose the appropriate equivalents. 

F. Backend service and tool contracts 

Define reusable backend functions for the agents to call, such as: 

getOverdueInvoices() 

getOutstandingBalance() 

calculateCashFlowForecast() 

getLowStockItems() 

getExpiringInventory() 

calculateRestockRecommendation() 

getEmployeeWorkloads() 

recommendTaskAssignments() 

createTask() 

savePitchDeckDraft() 

verifyTaskCreated() 

verifyPaymentRecorded() 

For every tool, specify its input schema, output schema, permissions, side effects, validation, and failure behaviour. 

Keep financial calculations, stock calculations, and record persistence deterministic and backend-controlled. AI agents should reason over validated results rather than inventing business data. 

G. Agent communication and execution contracts 

Define: 

The common input format for each agent. 

The common structured output format. 

How the Coordinator delegates work. 

How agents share record IDs and evidence. 

How parallel tasks and dependent tasks are handled. 

How errors, timeouts, retries, and partial failures are represented. 

How the QA stage verifies results. 

How the final report is assembled. 

How duplicate executions are prevented. 

Include an example JSON schema or structured object for an agent result containing status, summary, evidence, recommendations, tool calls, created record IDs, warnings, and verification results. 

H. Security and business integrity 

Specify: 

Server-side input validation. 

Authentication and role-based permissions. 

Protection against SQL injection and unsafe tool inputs. 

Secrets and environment variable handling. 

Audit logging. 

Approval gates for sending external reminders, making purchases, and other consequential actions. 

Idempotency for actions that could create duplicate records. 

Transaction handling for payment and inventory changes. 

Protection against agents reporting unverified success. 

 

7. Shared Development Rules for Our Team 

We have multiple team members building different parts of the application, potentially with WorkBuddy generating code for each person. 

Design the project so our work can be integrated safely. 

Establish one agreed project structure, technology stack, database schema, API contract, and shared type definitions. 

Define the interfaces between frontend, backend, database, and agents before implementation. 

Do not let each module independently invent endpoint paths, field names, database tables, or HTTP helper functions. 

Keep common authentication, navigation, styling, error handling, and API infrastructure shared. 

Specify which files or folders each team member is allowed to create or modify. 

Avoid duplicate server instances, duplicate database connections, and multiple incompatible API clients. 

Include a clear integration procedure explaining how independently developed modules will be combined, tested, and run. 

Provide a recommended Git branching and code-review workflow if appropriate. 

Identify the minimum end-to-end vertical slice that should be completed first. 

 

8. Recommended MVP Priority 

Do not attempt to implement every feature before the first demonstration. 

Recommend a phased build: 

Phase 1: Shared architecture, database, backend API, seeded demo data, and a basic working frontend. 

Phase 2: Coordinator Agent, agent-run state management, tool registry, and the supported WorkBuddy runtime integration. 

Phase 3: Financial and Inventory specialist agents with real backend tools and validated results. 

Phase 4: Task Allocation Agent and creation of real persisted tasks from the analysis. 

Phase 5: QA/verification, audit logs, approval gates, failure handling, and final report. 

Phase 6: Marketing/Pitch Deck Agent and remaining features. 

Revise this order if dependencies or the WorkBuddy integration require a different sequence. 

The first milestone should be one working end-to-end agentic workflow, not four disconnected CRUD dashboards. 

 

9. Required Output for This Confirmation Phase 

Present your response in this order: 

Your understanding of the project and hackathon objective. 

Recommended technology stack, with reasons and assumptions. 

Proposed system architecture diagram. 

Coordinator and specialist-agent responsibilities. 

Project folder structure. 

Database schema and relationships. 

Complete API endpoint table. 

Shared HTTP client functions and module API contracts. 

Backend tool/function contracts. 

Agent communication and execution flow. 

WorkBuddy runtime integration plan, documented capabilities, and unresolved questions. 

Security, approvals, verification, and audit logging. 

Team development and integration strategy. 

MVP milestones and end-to-end acceptance tests. 

Risks, trade-offs, missing information, and decisions requiring team approval. 

End with a concise Architecture Decision Checklist listing the decisions our team must approve before any member begins implementation. 

For each unresolved item, state: 

The question. 

Your recommended default. 

Why it matters. 

What would change if we chose another option. 

Do not generate the full implementation yet. First produce a technically consistent architecture that all team members can follow. 

 

 

 

 