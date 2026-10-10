/**
 * Login — email + password form, redirects to dashboard on success.
 */

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const expired = params.get("expired") === "1";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-gray-100 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-4xl">💼</span>
          <h1 className="text-2xl font-bold mt-2">Busyness</h1>
          <p className="text-sm text-gray-500 mt-1">Business Management Platform</p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Sign in</h2>

          {expired && (
            <div className="mb-4 p-3 rounded-lg bg-yellow-50 text-yellow-800 text-sm">
              Your session has expired. Please sign in again.
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="input"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="input"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="text-sm text-gray-500 text-center mt-4">
            Don't have an account?{" "}
            <Link to="/register" className="text-brand-600 hover:text-brand-700 font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
