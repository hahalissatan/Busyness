/**
 * App — router with no auth gate.
 *
 * Landing is the entry point. Pressing "Get Started" (or Enter) drops
 * the user into the workspace (defaults to /inventory). The four
 * module landing pages live under /:module, with sub-pages at
 * /:module/... for the existing CRUD views.
 */

import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import AppLayout from "./components/AppLayout.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { Spinner } from "./components/ui/Spinner.jsx";
import FinancialHub from "./pages/modules/FinancialHub.jsx";
import InventoryHub from "./pages/modules/InventoryHub.jsx";
import TasksHub from "./pages/modules/TasksHub.jsx";
import MarketingHub from "./pages/modules/MarketingHub.jsx";

import Customers from "./pages/financials/Customers.jsx";
import Invoices from "./pages/financials/Invoices.jsx";
import InvoiceDetail from "./pages/financials/InvoiceDetail.jsx";
import Products from "./pages/inventory/Products.jsx";
import Suppliers from "./pages/inventory/Suppliers.jsx";
import StockMovements from "./pages/inventory/StockMovements.jsx";
import TaskList from "./pages/tasks/TaskList.jsx";
import TeamMembers from "./pages/tasks/TeamMembers.jsx";
import Projects from "./pages/marketing/Projects.jsx";
import ProjectDetail from "./pages/marketing/ProjectDetail.jsx";

function Workspace({ children }) {
  const { ready } = useAuth();
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  return (
    <Routes>
      {/* Landing */}
      <Route path="/" element={<Landing />} />

      {/* Workspace */}
      <Route path="/financial" element={<Workspace><FinancialHub /></Workspace>} />
      <Route path="/financial/customers" element={<Workspace><Customers /></Workspace>} />
      <Route path="/financial/invoices" element={<Workspace><Invoices /></Workspace>} />
      <Route path="/financial/invoices/:id" element={<Workspace><InvoiceDetail /></Workspace>} />

      <Route path="/inventory" element={<Workspace><InventoryHub /></Workspace>} />
      <Route path="/inventory/products" element={<Workspace><Products /></Workspace>} />
      <Route path="/inventory/suppliers" element={<Workspace><Suppliers /></Workspace>} />
      <Route path="/inventory/movements" element={<Workspace><StockMovements /></Workspace>} />

      <Route path="/tasks" element={<Workspace><TasksHub /></Workspace>} />
      <Route path="/tasks/list" element={<Workspace><TaskList /></Workspace>} />
      <Route path="/tasks/team" element={<Workspace><TeamMembers /></Workspace>} />

      <Route path="/marketing" element={<Workspace><MarketingHub /></Workspace>} />
      <Route path="/marketing/projects" element={<Workspace><Projects /></Workspace>} />
      <Route path="/marketing/projects/:id" element={<Workspace><ProjectDetail /></Workspace>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}