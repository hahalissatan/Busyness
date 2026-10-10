/**
 * Inventory AI — landing page for the Smart Stock & Inventory module.
 */

import { ModulePage } from "../../components/ModulePage.jsx";

export default function InventoryHub() {
  return (
    <ModulePage
      title="Inventory AI"
      module="inventory"
      chatPlaceholder="Ask about stock, suppliers, or reorder points…"
      features={[
        {
          icon: "📦",
          title: "Stock Movements",
          description:
            "Record purchases, sales, and write-offs. Stock levels update atomically and never go negative.",
          accent: "sky",
          to: "/inventory/movements",
        },
        {
          icon: "🏷️",
          title: "Product Catalog",
          description:
            "Manage SKUs, prices, and reorder thresholds. Soft-delete deactivated products without losing history.",
          accent: "violet",
          to: "/inventory/products",
        },
        {
          icon: "🚚",
          title: "Supplier Network",
          description:
            "Keep supplier contact details organised. Quickly find who supplies what and reorder with confidence.",
          accent: "emerald",
          to: "/inventory/suppliers",
        },
      ]}
    />
  );
}