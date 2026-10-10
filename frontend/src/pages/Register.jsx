/**
 * Register — creates user + business + owner membership.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", businessName: "" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(form.email, form.password, form.name, form.businessName);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-gray-100 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-4xl">💼</span>
          <h1 className="text-2xl font-bold mt-2">Busyness</h1>
          <p className="text-sm text-gray-500 mt-1">Business Management Platform</p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Create your account</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Your name</label>
              <input type="text" value={form.name} onChange={update("name")} required placeholder="John Doe" className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" value={form.email} onChange={update("email")} required placeholder="you@example.com" className="input" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" value={form.password} onChange={update("password")} required minLength={8} placeholder="At least 8 characters" className="input" />
            </div>
            <div>
              <label className="label">Business name</label>
              <input type="text" value={form.businessName} onChange={update("businessName")} required placeholder="Acme Inc." className="input" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-sm text-gray-500 text-center mt-4">
            Already have an account?{" "}
            <Link to="/login" className="text-brand-600 hover:text-brand-700 font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
