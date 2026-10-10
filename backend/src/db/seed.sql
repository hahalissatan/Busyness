-- seed.sql — Demo data for Busyness / BizPilot AI
--
-- Demonstrates: cash-flow risk (overdue invoices), low-stock products,
-- near-expiry items, employee task allocation, marketing content,
-- and a completed agent run with steps.
--
-- Prerequisites: all migrations (001-007) must be applied.
-- Products are created with stock_quantity = 0; the apply_stock_movement()
-- trigger updates them as stock_movements are inserted.

-- ============================================================
-- 1. Business & User
-- ============================================================

INSERT INTO businesses (id, name, currency) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Demo Trading Sdn Bhd', 'MYR');

INSERT INTO users (id, email, password_hash, name, role) VALUES
  ('22222222-2222-2222-2222-222222222222', 'owner@demo.busyness', '$2b$10$aGnrONkuQUY9uwweT3u9iuqHnbc4gjpii4stCHF59yxwMkcNQdITK', 'Ahmad Rahman', 'owner');

INSERT INTO business_memberships (user_id, business_id, role) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'owner');

-- ============================================================
-- 2. Customers
-- ============================================================

INSERT INTO customers (id, business_id, name, email, phone, address) VALUES
  ('33333333-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Cafe Maju Sdn Bhd', 'orders@cafemaju.com', '012-345-6789', '12 Jalan Bukit Bintang, KL'),
  ('33333333-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Restoran Selera Kampung', 'selera@gmail.com', '013-456-7890', '45 Jalan Tunku Abdul Rahman, KL'),
  ('33333333-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Mini Mart Sejahtera', 'sejahtera@gmail.com', '014-567-8901', '78 Jalan Klang Lama, Selangor');

-- ============================================================
-- 3. Suppliers
-- ============================================================

INSERT INTO suppliers (id, business_id, name, contact_name, email, phone, address) VALUES
  ('44444444-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Global Foods Supply', 'Tan Lee', 'tan@globalfoods.com', '03-1234-5678', 'Lot 15, Industrial Park, Selangor'),
  ('44444444-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'FreshPack Distributors', 'Lim Wei', 'lim@freshpack.com', '03-2345-6789', 'Lot 22, Business Park, Selangor');

-- ============================================================
-- 4. Products (stock_quantity = 0; updated by stock_movements trigger)
-- ============================================================

INSERT INTO products (id, business_id, name, sku, description, stock_quantity, min_stock_threshold, unit_cost, expiry_date, supplier_id, is_active) VALUES
  ('55555555-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Cooking Oil 5L', 'OIL-5L-001', 'Premium cooking oil 5 liter bottle', 0, 20, 28.50, '2026-12-31', '44444444-0001-1111-1111-111111111111', true),
  ('55555555-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Rice 10kg Jasmine', 'RICE-10K-001', 'Jasmine rice 10kg bag', 0, 15, 45.00, '2026-10-15', '44444444-0001-1111-1111-111111111111', true),
  ('55555555-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Canned Tuna 425g', 'TUNA-425-001', 'Canned tuna chunks in oil 425g', 0, 30, 8.50, '2027-06-30', '44444444-0002-1111-1111-111111111111', true),
  ('55555555-0004-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Flour 2kg All Purpose', 'FLOUR-2K-001', 'All purpose flour 2kg pack', 0, 25, 6.50, '2026-09-30', '44444444-0001-1111-1111-111111111111', true),
  ('55555555-0005-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Sugar 1kg Refined', 'SUGAR-1K-001', 'Refined white sugar 1kg pack', 0, 40, 3.20, '2027-01-31', '44444444-0001-1111-1111-111111111111', true);

-- ============================================================
-- 5. Stock Movements (trigger updates product stock_quantity)
--    Product 1 (Oil):     +100, -30 = 70  (above threshold 20)
--    Product 2 (Rice):     +50, -40 = 10  (below threshold 15 = LOW STOCK)
--    Product 3 (Tuna):     +80, -50 = 30  (at threshold)
--    Product 4 (Flour):    +60, -55 = 5   (below threshold 25 = LOW STOCK, near expiry)
--    Product 5 (Sugar):    +100, -20 = 80 (above threshold 40)
-- ============================================================

INSERT INTO stock_movements (product_id, business_id, movement_type, quantity_change, reason, reference_type) VALUES
  -- Product 1: Cooking Oil
  ('55555555-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'purchase', 100, 'Initial stock purchase', 'manual'),
  ('55555555-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'sale', -30, 'Sale to Cafe Maju', 'invoice'),
  -- Product 2: Rice (LOW STOCK: 10 < 15)
  ('55555555-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'purchase', 50, 'Initial stock purchase', 'manual'),
  ('55555555-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'sale', -40, 'Sale to Mini Mart Sejahtera', 'invoice'),
  -- Product 3: Canned Tuna
  ('55555555-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'purchase', 80, 'Initial stock purchase', 'manual'),
  ('55555555-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'sale', -50, 'Sale to Restoran Selera', 'invoice'),
  -- Product 4: Flour (LOW STOCK: 5 < 25, near expiry 2026-09-30)
  ('55555555-0004-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'purchase', 60, 'Initial stock purchase', 'manual'),
  ('55555555-0004-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'sale', -55, 'Bulk sale to Cafe Maju', 'invoice'),
  -- Product 5: Sugar
  ('55555555-0005-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'purchase', 100, 'Initial stock purchase', 'manual'),
  ('55555555-0005-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'sale', -20, 'Sale to Mini Mart', 'invoice');

-- ============================================================
-- 6. Invoices (5 invoices: draft, unpaid, partially_paid, paid, overdue)
-- ============================================================

INSERT INTO invoices (id, business_id, customer_id, invoice_number, status, issue_date, due_date, subtotal, tax_amount, discount_amount, total, notes) VALUES
  -- Invoice 1: PAID (full payment received)
  ('66666666-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-0001-1111-1111-111111111111', 'INV-2026-001', 'paid', '2026-09-01', '2026-09-15', 1425.00, 85.50, 0, 1510.50, 'Monthly supply order'),
  -- Invoice 2: PARTIALLY_PAID (partial payment, outstanding balance)
  ('66666666-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-0002-1111-1111-111111111111', 'INV-2026-002', 'partially_paid', '2026-09-10', '2026-09-25', 900.00, 54.00, 0, 954.00, 'Restaurant supply order'),
  -- Invoice 3: UNPAID (no payment, not yet overdue)
  ('66666666-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-0003-1111-1111-111111111111', 'INV-2026-003', 'unpaid', '2026-10-01', '2026-10-15', 320.00, 19.20, 0, 339.20, 'Mini mart order'),
  -- Invoice 4: OVERDUE (no payment, past due_date)
  ('66666666-0004-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-0001-1111-1111-111111111111', 'INV-2026-004', 'overdue', '2026-09-05', '2026-09-20', 570.00, 34.20, 0, 604.20, 'Urgent supply order'),
  -- Invoice 5: DRAFT (not yet issued)
  ('66666666-0005-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '33333333-0002-1111-1111-111111111111', 'INV-2026-005', 'draft', '2026-10-10', '2026-10-24', 250.00, 15.00, 0, 265.00, 'Pending confirmation');

-- ============================================================
-- 7. Invoice Items (one item per invoice, totals match exactly)
-- line_total = (qty * unit_price) * (1 + tax_rate/100) - discount
-- ============================================================

-- Invoice 1 (PAID): 50x Oil @ 28.50, tax 6% → 50*28.50*1.06 = 1510.50
INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, discount_amount, line_total, sort_order) VALUES
  ('66666666-0001-1111-1111-111111111111', 'Cooking Oil 5L', 50, 28.50, 6, 0, 1510.50, 1);

-- Invoice 2 (PARTIALLY_PAID): 20x Rice @ 45.00, tax 6% → 20*45*1.06 = 954.00
INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, discount_amount, line_total, sort_order) VALUES
  ('66666666-0002-1111-1111-111111111111', 'Rice 10kg Jasmine', 20, 45.00, 6, 0, 954.00, 1);

-- Invoice 3 (UNPAID): 100x Sugar @ 3.20, tax 6% → 100*3.20*1.06 = 339.20
INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, discount_amount, line_total, sort_order) VALUES
  ('66666666-0003-1111-1111-111111111111', 'Sugar 1kg Refined', 100, 3.20, 6, 0, 339.20, 1);

-- Invoice 4 (OVERDUE): 20x Oil @ 28.50, tax 6% → 20*28.50*1.06 = 604.20
INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, discount_amount, line_total, sort_order) VALUES
  ('66666666-0004-1111-1111-111111111111', 'Cooking Oil 5L', 20, 28.50, 6, 0, 604.20, 1);

-- Invoice 5 (DRAFT): 50x Flour @ 5.00, tax 6% → 50*5.00*1.06 = 265.00
INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, discount_amount, line_total, sort_order) VALUES
  ('66666666-0005-1111-1111-111111111111', 'Flour 2kg', 50, 5.00, 6, 0, 265.00, 1);

-- ============================================================
-- 8. Payments
--    Invoice 1 (PAID): full payment 1510.50
--    Invoice 2 (PARTIALLY_PAID): partial payment 500.00 (outstanding: 454.00)
-- ============================================================

INSERT INTO payments (id, invoice_id, business_id, amount, payment_date, method, reference, idempotency_key) VALUES
  ('77777777-0001-1111-1111-111111111111', '66666666-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 1510.50, '2026-09-12', 'bank_transfer', 'BANK-TRF-001', 'pay-inv1-001'),
  ('77777777-0002-1111-1111-111111111111', '66666666-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 500.00, '2026-09-20', 'cash', 'CASH-001', 'pay-inv2-001');

-- ============================================================
-- 9. Skills
-- ============================================================

INSERT INTO skills (id, name) VALUES
  ('88888888-0001-1111-1111-111111111111', 'Inventory Management'),
  ('88888888-0002-1111-1111-111111111111', 'Sales'),
  ('88888888-0003-1111-1111-111111111111', 'Customer Service'),
  ('88888888-0004-1111-1111-111111111111', 'Bookkeeping'),
  ('88888888-0005-1111-1111-111111111111', 'Logistics'),
  ('88888888-0006-1111-1111-111111111111', 'Marketing');

-- ============================================================
-- 10. Employees + Skills
-- ============================================================

INSERT INTO employees (id, business_id, name, email, phone, role, availability, max_workload_hours) VALUES
  ('99999999-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Siti Aishah', 'siti@demo.busyness', '012-111-2222', 'manager', 'available', 40),
  ('99999999-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Raj Kumar', 'raj@demo.busyness', '012-222-3333', 'staff', 'available', 40),
  ('99999999-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Mei Ling', 'mei@demo.busyness', '012-333-4444', 'staff', 'busy', 30);

INSERT INTO employee_skills (employee_id, skill_id, proficiency) VALUES
  ('99999999-0001-1111-1111-111111111111', '88888888-0001-1111-1111-111111111111', 'expert'),
  ('99999999-0001-1111-1111-111111111111', '88888888-0004-1111-1111-111111111111', 'advanced'),
  ('99999999-0001-1111-1111-111111111111', '88888888-0003-1111-1111-111111111111', 'advanced'),
  ('99999999-0002-1111-1111-111111111111', '88888888-0002-1111-1111-111111111111', 'advanced'),
  ('99999999-0002-1111-1111-111111111111', '88888888-0003-1111-1111-111111111111', 'intermediate'),
  ('99999999-0002-1111-1111-111111111111', '88888888-0005-1111-1111-111111111111', 'intermediate'),
  ('99999999-0003-1111-1111-111111111111', '88888888-0006-1111-1111-111111111111', 'advanced'),
  ('99999999-0003-1111-1111-111111111111', '88888888-0002-1111-1111-111111111111', 'beginner');

-- ============================================================
-- 11. Tasks + Assignments
-- ============================================================

INSERT INTO tasks (id, business_id, title, description, priority, status, deadline, estimated_hours, source) VALUES
  ('aaaaaaaa-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Restock Cooking Oil', 'Order 50 bottles from Global Foods Supply', 'high', 'in_progress', '2026-10-15', 2.0, 'manual'),
  ('aaaaaaaa-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Follow up overdue invoice INV-2026-004', 'Contact Cafe Maju regarding overdue payment of RM 604.20', 'urgent', 'pending', '2026-10-12', 1.0, 'manual'),
  ('aaaaaaaa-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Check near-expiry flour stock', 'Flour expires 2026-09-30, only 5 units left. Check if still sellable.', 'high', 'pending', '2026-10-11', 0.5, 'manual');

INSERT INTO task_assignments (task_id, employee_id, status) VALUES
  ('aaaaaaaa-0001-1111-1111-111111111111', '99999999-0001-1111-1111-111111111111', 'active'),
  ('aaaaaaaa-0002-1111-1111-111111111111', '99999999-0002-1111-1111-111111111111', 'active'),
  ('aaaaaaaa-0003-1111-1111-111111111111', '99999999-0003-1111-1111-111111111111', 'active');

-- ============================================================
-- 12. Marketing
-- ============================================================

INSERT INTO marketing_projects (id, business_id, name, description, status) VALUES
  ('bbbbbbbb-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Q4 Ramadan Promo', 'Marketing campaign for Ramadan season promotions', 'active');

INSERT INTO customer_personas (id, business_id, marketing_project_id, name, description, pain_points, motivations, target_segment) VALUES
  ('bbbbbbbb-0002-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0001-1111-1111-111111111111', 'Budget-Conscious Restaurant Owner', 'Small restaurant owners looking for bulk supply discounts', 'High cost of supplies, inconsistent quality', 'Saving money, reliable supply chain', 'F&B SMBs');

INSERT INTO marketing_drafts (id, business_id, marketing_project_id, draft_type, title, content, platform, status) VALUES
  ('bbbbbbbb-0003-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0001-1111-1111-111111111111', 'social_media', 'Ramadan Bulk Deal Post', 'Get 10% off bulk orders this Ramadan! Stock up on cooking oil, rice, and more. DM us to order.', 'instagram', 'approved');

INSERT INTO pitch_decks (id, business_id, title, slides, status) VALUES
  ('bbbbbbbb-0004-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Demo Trading Sdn Bhd — Pitch Deck', '[
    {"slide_number":1,"heading":"Problem","bullet_points":["F&B businesses struggle with supply chain management","Manual inventory tracking leads to stockouts"],"speaker_notes":"Opening with the pain point"},
    {"slide_number":2,"heading":"Solution","bullet_points":["BizPilot AI automates inventory and invoicing","Real-time stock alerts and supplier ordering"],"speaker_notes":"Our platform solves this"},
    {"slide_number":3,"heading":"Market","bullet_points":["Malaysia F&B market size","Target: 50,000+ SMBs"],"speaker_notes":"Market opportunity"}
  ]', 'draft');

-- ============================================================
-- 13. Agent Run (completed with 4 steps)
-- ============================================================

INSERT INTO agent_runs (id, business_id, user_id, goal, status, plan, final_report, started_at, completed_at) VALUES
  ('cccccccc-0001-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Analyze cash flow risk and inventory health', 'completed',
    '{"steps":["financial_analysis","inventory_check","task_creation","summary_report"]}',
    '{"cash_flow_risk":"HIGH","overdue_amount":604.20,"low_stock_items":2,"near_expiry":1}',
    '2026-10-09T08:00:00Z', '2026-10-09T08:15:00Z');

INSERT INTO agent_run_steps (agent_run_id, agent_type, step_number, status, input, output, evidence, started_at, completed_at) VALUES
  ('cccccccc-0001-1111-1111-111111111111', 'coordinator', 1, 'completed',
    '{"goal":"Analyze cash flow risk and inventory health"}',
    '{"plan":["financial_analysis","inventory_check","task_creation","summary_report"]}',
    NULL,
    '2026-10-09T08:00:00Z', '2026-10-09T08:01:00Z'),
  ('cccccccc-0001-1111-1111-111111111111', 'financial', 2, 'completed',
    NULL,
    '{"overdue_invoices":1,"overdue_amount":604.20,"unpaid_total":339.20,"partially_paid_outstanding":454.00}',
    '{"invoice_ids":["66666666-0004-1111-1111-111111111111"]}',
    '2026-10-09T08:01:00Z', '2026-10-09T08:05:00Z'),
  ('cccccccc-0001-1111-1111-111111111111', 'inventory', 3, 'completed',
    NULL,
    '{"low_stock_products":2,"near_expiry":1,"products_below_threshold":["Rice 10kg Jasmine","Flour 2kg All Purpose"]}',
    '{"product_ids":["55555555-0002-1111-1111-111111111111","55555555-0004-1111-1111-111111111111"]}',
    '2026-10-09T08:05:00Z', '2026-10-09T08:10:00Z'),
  ('cccccccc-0001-1111-1111-111111111111', 'qa', 4, 'completed',
    NULL,
    '{"summary":"Cash flow risk HIGH. 1 overdue invoice (RM 604.20). 2 low-stock products. 1 near-expiry item.","recommendations":["Follow up overdue invoice","Restock rice and flour"]}',
    NULL,
    '2026-10-09T08:10:00Z', '2026-10-09T08:15:00Z');

-- ============================================================
-- 14. Audit Logs
-- ============================================================

INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, changes) VALUES
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'agent_run.started', 'agent_run', 'cccccccc-0001-1111-1111-111111111111', '{"goal":"Analyze cash flow risk and inventory health"}'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'agent_run.completed', 'agent_run', 'cccccccc-0001-1111-1111-111111111111', '{"status":"completed","duration_minutes":15}'),
  ('11111111-1111-1111-1111-111111111111', NULL, 'invoice.created', 'invoice', '66666666-0001-1111-1111-111111111111', NULL),
  ('11111111-1111-1111-1111-111111111111', NULL, 'payment.recorded', 'payment', '77777777-0001-1111-1111-111111111111', '{"amount":1510.50,"method":"bank_transfer"}'),
  ('11111111-1111-1111-1111-111111111111', NULL, 'stock.adjusted', 'product', '55555555-0004-1111-1111-111111111111', '{"note":"Bulk sale to Cafe Maju","change":-55}');
