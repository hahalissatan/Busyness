/**
 * App — main router with public and protected routes.
 * Protected routes are wrapped in Layout (sidebar + topbar).
 */

import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
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

function Protected({ children }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Protected routes */}
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/financials/customers" element={<Protected><Customers /></Protected>} />
      <Route path="/financials/invoices" element={<Protected><Invoices /></Protected>} />
      <Route path="/financials/invoices/:id" element={<Protected><InvoiceDetail /></Protected>} />
      <Route path="/inventory/products" element={<Protected><Products /></Protected>} />
      <Route path="/inventory/suppliers" element={<Protected><Suppliers /></Protected>} />
      <Route path="/inventory/stock-movements" element={<Protected><StockMovements /></Protected>} />
      <Route path="/tasks" element={<Protected><TaskList /></Protected>} />
      <Route path="/tasks/team" element={<Protected><TeamMembers /></Protected>} />
      <Route path="/marketing/projects" element={<Protected><Projects /></Protected>} />
      <Route path="/marketing/projects/:id" element={<Protected><ProjectDetail /></Protected>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
