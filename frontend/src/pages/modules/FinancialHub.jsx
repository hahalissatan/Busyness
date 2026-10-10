/**
 * Financial AI — landing page for the Financial Hub module.
 * Three feature cards describe what the AI agent can do.
 */

import { ModulePage } from "../../components/ModulePage.jsx";

export default function FinancialHub() {
  return (
    <ModulePage
      title="Financial AI"
      module="financial"
      chatPlaceholder="Ask about invoices, payments, customers…"
      features={[
        {
          icon: "📋",
          title: "Invoice Generation",
          description:
            "Auto-generate invoices from line items, calculate tax and discounts, and track payment status across all customers.",
          accent: "amber",
          to: "/financial/invoices",
        },
        {
          icon: "💳",
          title: "Payment Tracking",
          description:
            "Record partial and full payments, view payment history, and reconcile outstanding balances in real time.",
          accent: "emerald",
          to: "/financial/invoices",
        },
        {
          icon: "👥",
          title: "Customer Insights",
          description:
            "Maintain a clean customer database, search by name or email, and surface top accounts at a glance.",
          accent: "sky",
          to: "/financial/customers",
        },
      ]}
    />
  );
}