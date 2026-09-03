import { useState, useEffect, useMemo } from "react";
import { LogOut, AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "./supabaseClient.js";

const fmtMoney = (n) => {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? "-" : ""}UGX ${Math.abs(v).toLocaleString()}`;
};
const timeAgo = (iso) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!supabase) { setError("Supabase isn't configured (missing environment variables)."); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) setError(err.message);
    else onLoggedIn();
  };

  const inputStyle = { width: "100%", background: "#141A21", border: "1px solid #262E36", borderRadius: 8, padding: "10px 12px", color: "#F1EFE7", fontSize: 14, marginBottom: 12, boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340, background: "#141A21", border: "1px solid #262E36", borderRadius: 12, padding: 24 }}>
        <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, color: "#F1EFE7", margin: "0 0 4px" }}>Admin login</h1>
        <p style={{ fontSize: 12, color: "#8A8F87", margin: "0 0 20px" }}>Restricted to the admin account only.</p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        {error && <p style={{ color: "#E0654F", fontSize: 12, margin: "0 0 12px" }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: "100%", background: "#E8C766", color: "#2A2109", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 130, background: "#141A21", border: "1px solid #262E36", borderRadius: 10, padding: 14 }}>
      <p style={{ fontSize: 11, color: "#8A8F87", margin: "0 0 6px" }}>{label}</p>
      <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 700, color: color || "#F1EFE7", margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: "#5F655C", margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{ color: "#8A8F87", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, margin: "0 0 12px" }}>{title}</p>
      {children}
    </div>
  );
}

function Dashboard({ onLogout }) {
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState([]);
  const [errors, setErrors] = useState([]);
  const [perf, setPerf] = useState([]);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const [d, s, e, p] = await Promise.all([
        supabase.from("devices").select("*").order("first_seen", { ascending: false }),
        supabase.from("user_stats").select("*"),
        supabase.from("error_logs").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("perf_logs").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (d.error) throw d.error;
      setDevices(d.data || []); setStats(s.data || []);
      setErrors(e.data || []); setPerf(p.data || []);
    } catch (e) {
      setErr(e.message || "Failed to load dashboard data.");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const now = Date.now();
  const dayMs = 86400000;
  const newToday = devices.filter((d) => now - new Date(d.first_seen).getTime() < dayMs).length;
  const newWeek = devices.filter((d) => now - new Date(d.first_seen).getTime() < 7 * dayMs).length;
  const activeWeek = devices.filter((d) => now - new Date(d.last_seen).getTime() < 7 * dayMs).length;

  const avgLoadMs = perf.length ? Math.round(perf.reduce((s, p) => s + (p.load_ms || 0), 0) / perf.length) : 0;
  const errorsWeek = errors.filter((e) => now - new Date(e.created_at).getTime() < 7 * dayMs).length;

  const totalStaked = stats.reduce((s, r) => s + (Number(r.total_staked) || 0), 0);
  const totalProfit = stats.reduce((s, r) => s + (Number(r.net_profit) || 0), 0);
  const settledUsers = stats.filter((r) => r.settled_bets > 0);
  const avgRoi = settledUsers.length ? settledUsers.reduce((s, r) => s + (Number(r.roi) || 0), 0) / settledUsers.length : 0;
  const avgWinRate = settledUsers.length ? settledUsers.reduce((s, r) => s + (Number(r.win_rate) || 0), 0) / settledUsers.length : 0;
  const totalBetsLogged = stats.reduce((s, r) => s + (Number(r.total_bets) || 0), 0);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, color: "#F1EFE7", margin: 0 }}>Admin dashboard</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ background: "transparent", border: "1px solid #262E36", borderRadius: 8, padding: "8px 12px", color: "#8A8F87", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={onLogout} style={{ background: "transparent", border: "1px solid #262E36", borderRadius: 8, padding: "8px 12px", color: "#8A8F87", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <LogOut size={14} /> Log out
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: "#8A8F87" }}>Loading...</p>
      ) : err ? (
        <p style={{ color: "#E0654F" }}>{err}</p>
      ) : (
        <>
          <Section title="Users">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <StatCard label="Total devices" value={devices.length} sub="all-time installs" color="#E8C766" />
              <StatCard label="New today" value={newToday} />
              <StatCard label="New this week" value={newWeek} />
              <StatCard label="Active this week" value={activeWeek} sub="opened the app" />
            </div>
          </Section>

          <Section title="App health">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <StatCard label="Avg load time" value={`${avgLoadMs}ms`} sub={`from ${perf.length} sessions`} />
              <StatCard label="Errors (7d)" value={errorsWeek} color={errorsWeek > 0 ? "#E0654F" : "#6FCF97"} />
            </div>
            {errors.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {errors.slice(0, 8).map((e) => (
                  <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #1D242B" }}>
                    <AlertTriangle size={13} color="#E0654F" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, color: "#F1EFE7", margin: 0, wordBreak: "break-word" }}>{e.message}</p>
                      <p style={{ fontSize: 11, color: "#5F655C", margin: "2px 0 0" }}>{timeAgo(e.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Betting performance (aggregate across all users)">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <StatCard label="Total bets logged" value={totalBetsLogged} />
              <StatCard label="Total staked" value={fmtMoney(totalStaked)} />
              <StatCard label="Total net profit" value={(totalProfit >= 0 ? "+" : "") + fmtMoney(totalProfit)} color={totalProfit >= 0 ? "#6FCF97" : "#E0654F"} />
              <StatCard label="Avg ROI per user" value={`${avgRoi >= 0 ? "+" : ""}${avgRoi.toFixed(1)}%`} color={avgRoi >= 0 ? "#6FCF97" : "#E0654F"} />
              <StatCard label="Avg win rate" value={`${avgWinRate.toFixed(0)}%`} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = logged out

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#10151B", minHeight: "100vh" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap'); input:focus{outline:1px solid #E8C766;}`}</style>
      {session === undefined ? (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8A8F87" }}>Loading...</div>
      ) : session ? (
        <Dashboard onLogout={logout} />
      ) : (
        <LoginScreen onLoggedIn={() => {}} />
      )}
    </div>
  );
}
