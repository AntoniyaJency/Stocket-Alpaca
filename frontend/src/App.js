import { useState, useEffect } from "react";
import Dashboard from "./Dashboard";
import { api, setToken, clearToken, getToken } from "./api";
import "./styles.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Try to restore session from stored token
  useEffect(() => {
    const token = getToken();
    if (token) {
      api.health().then(() => {
        // Token valid — decode name from it (we stored it in JWT)
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          setUser({ name: payload.name, email: payload.email });
        } catch (_) { clearToken(); }
      }).catch(() => clearToken()).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleAuth = async () => {
    if (!form.email || !form.password) { setError("All fields required"); return; }
    if (isSignup && !form.name) { setError("Name required"); return; }
    setSubmitting(true); setError("");
    try {
      const res = isSignup
        ? await api.register(form.email, form.password, form.name)
        : await api.login(form.email, form.password);
      setToken(res.token);
      setUser(res.user);
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#2B234B", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", color: "#D4AF37" }}>
      INITIALIZING...
    </div>
  );

  if (user) return <Dashboard user={user} onLogout={() => { clearToken(); setUser(null); }} />;

  return (
    <div className="login-bg">
      <div className="matrix-overlay" />
      <div className="login-card">
        <div className="login-scanline" />
        <div className="login-logo-container">
          <img src="/logo.svg" alt="Stocket Logo" className="login-logo-img" />
          <div className="login-logo-text">STOCKET</div>
        </div>
        <div className="login-sub">TRADE SMART.INVEST WISE<span className="blink-cursor">_</span></div>
        <div className="login-badges">
          <div className="login-mode-badge"><span className="live-dot-sm" /> ALPACA MARKETS</div>
          <div className="login-mode-badge"><span className="live-dot-sm" style={{background:"#4488ff"}} /> CLAUDE AI</div>
          <div className="login-mode-badge"><span className="live-dot-sm" style={{background:"#ffaa00"}} /> JWT AUTH</div>
        </div>
        <div className="login-fields">
          {isSignup && (
            <input className="auth-input" placeholder="// FULL NAME"
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          )}
          <input className="auth-input" placeholder="// EMAIL ADDRESS" type="email"
            value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
          <input className="auth-input" placeholder="// PASSWORD" type="password"
            value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleAuth()} />
          {error && <div className="auth-error">!! {error}</div>}
          <button className="auth-btn" onClick={handleAuth} disabled={submitting}>
            {submitting ? "AUTHENTICATING..." : isSignup ? "CREATE ACCOUNT" : "ACCESS TERMINAL"}
          </button>
        </div>
        <div className="auth-switch" onClick={() => { setIsSignup(!isSignup); setError(""); }}>
          {isSignup ? "// ALREADY REGISTERED? SIGN IN" : "// NEW USER? CREATE ACCOUNT"}
        </div>
        <div className="login-footer">Backend required · localhost:3001 · Alpaca + Anthropic keys needed</div>
      </div>
    </div>
  );
}
