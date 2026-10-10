/**
 * InvoiceDetail — shows invoice with items, payment summary, and payment recording.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../api/client.js";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { ChevronLeft } from "../../components/icons.jsx";

export default function InvoiceDetail() {
  const { id } = useParams();
  const { business } = useAuth();
  const base = `/api/businesses/${business?.id}/financials`;
  const [invoice, setInvoice] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", payment_method: "bank_transfer", payment_date: new Date().toISOString().slice(0, 10) });
  const [payError, setPayError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [inv, pays] = await Promise.all([
        api.get(`${base}/invoices/${id}`),
        api.list(`${base}/payments`, { limit: 100 }),
      ]);
      setInvoice(inv);
      setPayments(pays.data.filter((p) => p.invoice_id === id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const recordPayment = async () => {
    setPayError(null);
    try {
      await api.post(`${base}/payments`, {
        invoice_id: id,
        amount: parseFloat(payForm.amount),
        payment_method: payForm.payment_method,
        idempotency_key: `pay-${Date.now()}`,
        payment_date: payForm.payment_date,
      });
      setPayModal(false);
      setPayForm({ amount: "", payment_method: "bank_transfer", payment_date: new Date().toISOString().slice(0, 10) });
      load();
    } catch (err) {
      setPayError(err.message);
    }
  };

  const changeStatus = async (newStatus) => {
    try {
      await api.patch(`${base}/invoices/${id}/status`, { status: newStatus });
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <Spinner size="lg" />;
  if (error) return <div className="card text-red-600">{error}</div>;
  if (!invoice) return <div className="card">Invoice not found.</div>;

  const balance = parseFloat(invoice.total) - parseFloat(invoice.paid_amount);
  const canTransition = (status) => {
    if (status === "unpaid" && invoice.status === "draft") return true;
    if (status === "overdue" && invoice.status === "unpaid") return true;
    if (status === "unpaid" && invoice.status === "overdue") return true;
    return false;
  };

  return (
    <div className="space-y-6">
      <Link to="/financials/invoices" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <ChevronLeft className="w-4 h-4" /> Back to invoices
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Invoice details */}
        <div className="lg:col-span-2 card">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold">Invoice</h2>
              <p className="text-sm text-gray-500">{invoice.customer_name}</p>
            </div>
            <Badge status={invoice.status} />
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
            <div><p className="text-gray-400">Issue Date</p><p className="font-medium">{new Date(invoice.issue_date).toLocaleDateString()}</p></div>
            <div><p className="text-gray-400">Due Date</p><p className="font-medium">{new Date(invoice.due_date).toLocaleDateString()}</p></div>
            <div><p className="text-gray-400">Currency</p><p className="font-medium">{invoice.currency || "MYR"}</p></div>
          </div>

          <table className="w-full">
            <thead><tr><th className="table-header">Item</th><th className="table-header text-right">Qty</th><th className="table-header text-right">Price</th><th className="table-header text-right">Tax%</th><th className="table-header text-right">Disc</th><th className="table-header text-right">Total</th></tr></thead>
            <tbody>
              {(invoice.items || []).map((item, i) => (
                <tr key={i} className="table-row">
                  <td className="table-cell">{item.product_name}</td>
                  <td className="table-cell text-right">{item.quantity}</td>
                  <td className="table-cell text-right">RM {parseFloat(item.unit_price).toFixed(2)}</td>
                  <td className="table-cell text-right">{item.tax_rate}%</td>
                  <td className="table-cell text-right">RM {parseFloat(item.discount || 0).toFixed(2)}</td>
                  <td className="table-cell text-right font-medium">RM {parseFloat(item.line_total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end space-y-1">
            <div className="space-y-1 text-right">
              <div className="text-sm text-gray-500">Subtotal: <span className="font-medium text-gray-900">RM {parseFloat(invoice.subtotal).toFixed(2)}</span></div>
              <div className="text-sm text-gray-500">Tax: <span className="font-medium text-gray-900">RM {parseFloat(invoice.tax_total).toFixed(2)}</span></div>
              <div className="text-sm text-gray-500">Discount: <span className="font-medium text-gray-900">RM {parseFloat(invoice.discount_total || 0).toFixed(2)}</span></div>
              <div className="text-lg font-bold">Total: RM {parseFloat(invoice.total).toFixed(2)}</div>
              <div className="text-sm text-blue-600">Paid: RM {parseFloat(invoice.paid_amount).toFixed(2)}</div>
              <div className="text-sm font-bold text-red-600">Balance: RM {balance.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Sidebar: actions + payments */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold mb-3">Actions</h3>
            <div className="space-y-2">
              {balance > 0 && invoice.status !== "paid" && (
                <button onClick={() => setPayModal(true)} className="btn-primary w-full justify-center">Record Payment</button>
              )}
              {canTransition("unpaid") && <button onClick={() => changeStatus("unpaid")} className="btn-secondary w-full justify-center">Mark as Unpaid</button>}
              {canTransition("overdue") && <button onClick={() => changeStatus("overdue")} className="btn-secondary w-full justify-center">Mark as Overdue</button>}
              {invoice.status === "paid" && <p className="text-sm text-green-600">Fully paid ✓</p>}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-3">Payment History</h3>
            {payments.length ? (
              <div className="space-y-2">
                {payments.map((p) => (
                  <div key={p.id} className="text-sm py-2 border-b border-gray-50 last:border-0">
                    <div className="flex justify-between">
                      <span className="font-medium">RM {parseFloat(p.amount).toFixed(2)}</span>
                      <span className="text-gray-400">{new Date(p.payment_date).toLocaleDateString()}</span>
                    </div>
                    <span className="text-xs text-gray-400">{p.payment_method}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">No payments recorded.</p>}
          </div>
        </div>
      </div>

      {payModal && (
        <Modal open onClose={() => setPayModal(false)} title="Record Payment">
          <div className="space-y-4">
            {payError && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{payError}</div>}
            <div className="text-sm text-gray-500">Outstanding balance: <span className="font-bold text-red-600">RM {balance.toFixed(2)}</span></div>
            <div><label className="label">Amount (RM)</label><input type="number" min="0" step="0.01" max={balance} className="input" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></div>
            <div><label className="label">Payment Method</label>
              <select className="input" value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}>
                <option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option><option value="credit_card">Credit Card</option><option value="debit_card">Debit Card</option><option value="cheque">Cheque</option><option value="other">Other</option>
              </select>
            </div>
            <div><label className="label">Payment Date</label><input type="date" className="input" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} /></div>
            <div className="flex gap-2 justify-end"><button onClick={() => setPayModal(false)} className="btn-secondary">Cancel</button><button onClick={recordPayment} className="btn-primary">Record</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
