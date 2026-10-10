-- 007_create_triggers.sql
-- Triggers: append-only enforcement, stock quantity protection, stock movement application
--
-- Created functions:
--   prevent_update_delete()  — blocks UPDATE/DELETE on append-only tables
--   protect_stock_quantity() — blocks direct UPDATE of products.stock_quantity
--   apply_stock_movement()   — AFTER INSERT on stock_movements: updates products.stock_quantity

-- ===================================================================
-- prevent_update_delete(): raises exception on UPDATE or DELETE
-- Applied to append-only tables: stock_movements, audit_logs
-- ===================================================================
CREATE OR REPLACE FUNCTION prevent_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: UPDATE and DELETE are not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Block UPDATE and DELETE on stock_movements
CREATE TRIGGER no_update_stock_movements
  BEFORE UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

CREATE TRIGGER no_delete_stock_movements
  BEFORE DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

-- Block UPDATE and DELETE on audit_logs
CREATE TRIGGER no_update_audit_logs
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

CREATE TRIGGER no_delete_audit_logs
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

-- ===================================================================
-- protect_stock_quantity(): blocks direct UPDATE of products.stock_quantity
-- Only allows the change when a session flag 'app.stock_movement' is set,
-- which is set by the apply_stock_movement() trigger below.
-- This ensures stock can ONLY change via stock_movements INSERT.
-- ===================================================================
CREATE OR REPLACE FUNCTION protect_stock_quantity()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow the update if it's triggered by a stock movement (flag set)
  IF current_setting('app.stock_movement', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block any direct change to stock_quantity
  IF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity THEN
    RAISE EXCEPTION 'Direct update of stock_quantity is not allowed. Use stock_movements instead.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_stock_qty
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION protect_stock_quantity();

-- ===================================================================
-- apply_stock_movement(): AFTER INSERT on stock_movements
-- Updates the product's stock_quantity to reflect the new movement.
-- Uses set_config('app.stock_movement', 'true', true) to bypass
-- the protect_stock_quantity() trigger.
-- ===================================================================
CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS TRIGGER AS $$
BEGIN
  -- Set session-local flag so protect_stock_quantity allows the update
  PERFORM set_config('app.stock_movement', 'true', true);

  UPDATE products
    SET stock_quantity = stock_quantity + NEW.quantity_change
    WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER apply_stock_mvmt
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();
