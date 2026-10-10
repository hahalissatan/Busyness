-- 003_create_inventory.sql
-- Tables: suppliers, products, stock_movements
-- Key safeguards: stock_quantity CHECK >= 0, append-only stock_movements (trigger in 007)

-- ===================================================================
-- suppliers: supplier information for inventory replenishment
-- ===================================================================
CREATE TABLE suppliers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name         TEXT NOT NULL,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_suppliers_business_name ON suppliers(business_id, name);

-- ===================================================================
-- products: inventory items with stock level tracking
-- stock_quantity is protected by trigger (007) — only stock_movements
-- can change it. Direct UPDATE of stock_quantity is blocked.
-- ===================================================================
CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name                TEXT NOT NULL,
  sku                 TEXT NOT NULL,
  description         TEXT,
  stock_quantity      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  min_stock_threshold NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_stock_threshold >= 0),
  unit_cost           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  expiry_date         DATE,
  supplier_id         UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, sku)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_products_business_active ON products(business_id, is_active);
CREATE INDEX idx_products_business_stock  ON products(business_id, stock_quantity);
CREATE INDEX idx_products_business_expiry ON products(business_id, expiry_date);

-- ===================================================================
-- stock_movements: append-only history of all stock changes
-- Never UPDATE or DELETE — enforced by trigger in migration 007
-- quantity_change: positive = stock in, negative = stock out
-- ===================================================================
CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  movement_type   TEXT NOT NULL
                  CHECK (movement_type IN ('purchase', 'sale', 'adjustment', 'return', 'transfer', 'writeoff')),
  quantity_change NUMERIC(10,2) NOT NULL,
  reason          TEXT,
  reference_type  TEXT,
  reference_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sm_product_created   ON stock_movements(product_id, created_at);
CREATE INDEX idx_sm_business_created  ON stock_movements(business_id, created_at);
CREATE INDEX idx_sm_reference          ON stock_movements(reference_type, reference_id);
