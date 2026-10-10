-- 002_create_financials.sql
-- Tables: customers, invoices, invoice_items, payments
-- Key safeguards: NUMERIC(12,2) money, CHECK constraints, payment idempotency_key

-- ===================================================================
-- customers: business customers (recipients of invoices)
-- ===================================================================
CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_customers_business_name ON customers(business_id, name);
CREATE INDEX idx_customers_business      ON customers(business_id);

-- ===================================================================
-- invoices: header with calculated totals
-- Outstanding balance = total - SUM(payments.amount) (computed in service)
-- ===================================================================
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_number  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'unpaid', 'partially_paid', 'paid', 'overdue')),
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date >= issue_date),
  UNIQUE(business_id, invoice_number)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_invoices_business_status  ON invoices(business_id, status);
CREATE INDEX idx_invoices_business_due     ON invoices(business_id, due_date);
CREATE INDEX idx_invoices_customer         ON invoices(customer_id);

-- ===================================================================
-- invoice_items: line items on an invoice
-- line_total = (qty * unit_price) + (qty * unit_price * tax_rate / 100) - discount
-- ===================================================================
CREATE TABLE invoice_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  quantity        NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_invoice_items_sort ON invoice_items(invoice_id, sort_order);

-- ===================================================================
-- payments: recorded against invoices, cannot be deleted
-- Idempotency: UNIQUE(business_id, idempotency_key) prevents duplicates
-- ===================================================================
CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date   DATE NOT NULL,
  method         TEXT NOT NULL
                 CHECK (method IN ('cash', 'bank_transfer', 'credit_card', 'debit_card', 'cheque', 'other')),
  reference      TEXT,
  idempotency_key TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, idempotency_key)
);

CREATE INDEX idx_payments_invoice        ON payments(invoice_id);
CREATE INDEX idx_payments_business_date  ON payments(business_id, payment_date);
