import { useState, useEffect, useMemo } from "react";
import { Plus, X, TrendingUp, Users, Swords, Settings as SettingsIcon, Trash2, AlertCircle, ChevronDown, Pencil, Search, Download, Layers, ArrowUpDown, Flame } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "./supabaseClient.js";

const STORAGE_KEY = "bt:bets";
const DEVICE_KEY = "bt:deviceId";
const uid = () => Math.random().toString(36).slice(2, 10);

// A random id generated once per browser, so we can count distinct
// installs without any login. It never leaves the device except as
// this opaque string — no personal info is attached to it.
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : uid() + uid() + uid());
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

// Fire-and-forget analytics helpers. Every call is wrapped so that if
// Supabase isn't configured yet, or the device is offline, the app
// keeps working normally — analytics never blocks or breaks anything.
async function trackDeviceSeen(deviceId) {
  if (!supabase) return;
  try {
    const { data: existing } = await supabase.from("devices").select("device_id").eq("device_id", deviceId).maybeSingle();
    if (existing) {
      await supabase.from("devices").update({ last_seen: new Date().toISOString() }).eq("device_id", deviceId);
    } else {
      await supabase.from("devices").insert({ device_id: deviceId, app_version: "1.0.0" });
    }
  } catch (e) { /* silent */ }
}
async function trackLoadTime(deviceId, ms) {
  if (!supabase) return;
  try { await supabase.from("perf_logs").insert({ device_id: deviceId, load_ms: Math.round(ms) }); } catch { /* silent */ }
}
async function trackError(deviceId, message, stack) {
  if (!supabase) return;
  try { await supabase.from("error_logs").insert({ device_id: deviceId, message: String(message).slice(0, 500), stack: String(stack || "").slice(0, 2000) }); } catch { /* silent */ }
}
async function syncUserStats(deviceId, bets) {
  if (!supabase) return;
  try {
    const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
    const totalStaked = settled.reduce((s, b) => s + (Number(b.stake) || 0), 0);
    const netProfit = settled.reduce((s, b) => s + profitFor(b), 0);
    const wins = settled.filter((b) => b.status === "won").length;
    const winRate = settled.length ? (wins / settled.length) * 100 : 0;
    const roi = totalStaked ? (netProfit / totalStaked) * 100 : 0;
    await supabase.from("user_stats").upsert({
      device_id: deviceId, total_bets: bets.length, settled_bets: settled.length,
      total_staked: totalStaked, net_profit: netProfit, win_rate: winRate, roi,
      updated_at: new Date().toISOString(),
    });
  } catch { /* silent */ }
}

const fmtMoney = (n) => {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? "-" : ""}UGX ${Math.abs(v).toLocaleString()}`;
};

const STATUS_META = {
  pending: { label: "Pending", color: "#E8C766" },
  won: { label: "Won", color: "#6FCF97" },
  lost: { label: "Lost", color: "#E0654F" },
  void: { label: "Void", color: "#8A8F87" },
};

const emptyLeg = () => ({
  id: uid(), league: "", home: "", away: "", homeScore: "", awayScore: "",
  market: "Match result", selection: "", odds: "", homeOdds: "", drawOdds: "", awayOdds: "",
});

function combinedOdds(bet) {
  return (bet.legs || []).reduce((acc, l) => {
    const o = Number(l.odds);
    return acc * (o > 0 ? o : 1);
  }, 1);
}

function profitFor(bet) {
  const stake = Number(bet.stake) || 0;
  const odds = combinedOdds(bet);
  if (bet.status === "won") return stake * odds - stake;
  if (bet.status === "lost") return -stake;
  return 0;
}

function legResult(leg) {
  if (leg.homeScore === "" || leg.awayScore === "" || leg.homeScore == null || leg.awayScore == null) return null;
  const h = Number(leg.homeScore), a = Number(leg.awayScore);
  if (h > a) return "home";
  if (a > h) return "away";
  return "draw";
}

async function loadBets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.map(migrateBet);
  } catch {
    return [];
  }
}
// upgrade any old single-shape bets (pre-accumulator) into the legs format
function migrateBet(b) {
  if (b.legs) return b;
  return {
    id: b.id, date: b.date, stake: b.stake, status: b.status,
    legs: [{
      id: uid(), league: b.league || "", home: b.home || "", away: b.away || "",
      homeScore: b.homeScore ?? "", awayScore: b.awayScore ?? "",
      market: b.market || "", selection: b.selection || "", odds: b.odds || "",
      homeOdds: "", drawOdds: "", awayOdds: "",
    }],
  };
}
async function saveBets(bets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
  } catch (e) {
    console.error("save bets failed", e);
  }
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function betsToCSV(bets) {
  const cols = ["id", "date", "stake", "status", "combinedOdds", "legs"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const legsText = (b) => (b.legs || []).map((l) => `${l.home} vs ${l.away} (${l.market}: ${l.selection} @ ${l.odds})`).join(" | ");
  const rows = [cols.join(",")].concat(bets.map((b) => [
    esc(b.id), esc(b.date), esc(b.stake), esc(b.status), esc(combinedOdds(b).toFixed(2)), esc(legsText(b)),
  ].join(",")));
  return rows.join("\n");
}

function HelpButton({ deviceId }) {
  const adminNumber = (import.meta.env.VITE_ADMIN_WHATSAPP || "256748993044").replace(/[^\d]/g, "");
  const message = `Hi, I need help with Bet Tracker (device: ${(deviceId || "").slice(0, 8)})`;
  const href = `https://wa.me/${adminNumber}?text=${encodeURIComponent(message)}`;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label="Get help on WhatsApp" style={{
      position: "fixed", right: 16, bottom: 78, width: 48, height: 48, borderRadius: 24,
      background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 4px 14px rgba(0,0,0,0.4)", zIndex: 15, textDecoration: "none",
    }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.6.1-.2.3-.7.9-.9 1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.3 0-.5s-.6-1.5-.9-2c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1 0 1.2.9 2.4 1 2.6.1.2 1.8 2.8 4.4 3.9.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3z" fill="#10151B"/>
        <path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z" fill="#10151B"/>
      </svg>
    </a>
  );
}

function TabBar({ active, onChange }) {
  const tabs = [
    { id: "bets", label: "Bets", icon: TrendingUp },
    { id: "teams", label: "Teams", icon: Users },
    { id: "h2h", label: "H2H", icon: Swords },
    { id: "analysis", label: "Analysis", icon: TrendingUp },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <div style={{ position: "sticky", bottom: 0, left: 0, right: 0, background: "#141A21", borderTop: "2px solid #E8C766", display: "flex", zIndex: 20 }}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            flex: 1, background: "none", border: "none", padding: "8px 2px 10px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer",
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 26, borderRadius: 8,
              background: isActive ? "#E8C766" : "transparent", transition: "background 0.15s",
            }}>
              <Icon size={17} strokeWidth={isActive ? 2.6 : 1.8} color={isActive ? "#2A2109" : "#7C8078"} />
            </div>
            <span style={{ fontSize: 10, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: isActive ? 700 : 500, letterSpacing: 0.3, color: isActive ? "#E8C766" : "#7C8078" }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Header({ title, subtitle }) {
  return (
    <div style={{ padding: "20px 16px 12px" }}>
      <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 28, color: "#F1EFE7", margin: 0 }}>{title}</h1>
      {subtitle && <p style={{ color: "#8A8F87", fontSize: 13, margin: "4px 0 0" }}>{subtitle}</p>}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center", color: "#8A8F87" }}>
      <Icon size={28} style={{ marginBottom: 10, opacity: 0.6 }} />
      <p style={{ color: "#F1EFE7", fontSize: 15, margin: "0 0 4px" }}>{title}</p>
      <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

function Pill({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 20, fontSize: 12, whiteSpace: "nowrap", cursor: "pointer",
      border: `1px solid ${active ? "#E8C766" : "#262E36"}`,
      background: active ? "rgba(232,199,102,0.1)" : "transparent",
      color: active ? "#E8C766" : "#8A8F87",
    }}>{children}</button>
  );
}

// ---------- sporty shared bits ----------
const ACCENT2 = "#FF6B4A"; // action orange, secondary accent alongside the gold

function SectionLabel({ children, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
      <div style={{ width: 4, height: 14, borderRadius: 2, background: accent || "#E8C766" }} />
      <p style={{ color: "#B8BDB4", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, margin: 0 }}>{children}</p>
    </div>
  );
}

function StatCard({ label, value, sub, color, minWidth }) {
  return (
    <div style={{
      flex: 1, minWidth: minWidth || 120, background: "#141A21", borderRadius: 10, padding: "12px 12px 11px",
      borderTop: `2.5px solid ${color || "#33403A"}`,
    }}>
      <p style={{ fontSize: 10.5, color: "#8A8F87", margin: "0 0 5px", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</p>
      <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: color || "#F1EFE7", margin: 0, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 10.5, color: "#5F655C", margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

// ---------- Bets tab ----------
function BetTicket({ bet, onDelete, onEdit }) {
  const meta = STATUS_META[bet.status];
  const profit = profitFor(bet);
  const legs = bet.legs || [];
  const isAcca = legs.length > 1;

  return (
    <div style={{ background: "#182019", border: "1px solid #263026", borderLeft: `4px solid ${meta.color}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
      <div style={{ display: "flex" }}>
        <div style={{ flex: 1, padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ color: "#8A8F87", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
              {isAcca && <Layers size={11} />} {bet.date} · {isAcca ? `Accumulator · ${legs.length} legs` : (legs[0]?.league || "League not set")}
            </span>
            <span style={{ color: meta.color, fontSize: 11, fontWeight: 600 }}>{meta.label}</span>
          </div>
          {legs.map((leg, i) => {
            const res = legResult(leg);
            return (
              <div key={leg.id} style={{ marginBottom: i < legs.length - 1 ? 8 : 0, paddingBottom: i < legs.length - 1 ? 8 : 0, borderBottom: i < legs.length - 1 ? "1px solid #1D2A1E" : "none" }}>
                <p style={{ color: "#F1EFE7", fontSize: 14, margin: "0 0 2px", fontWeight: 500 }}>
                  {leg.home} <span style={{ color: "#5F655C" }}>vs</span> {leg.away}
                </p>
                <p style={{ color: "#B8BDB4", fontSize: 12, margin: "0 0 2px" }}>{leg.market}: {leg.selection} <span style={{ color: "#5F655C" }}>@ {Number(leg.odds || 0).toFixed(2)}</span></p>
                <p style={{ color: res ? "#8A8F87" : "#5F655C", fontSize: 11, margin: 0 }}>{res ? `${leg.homeScore}-${leg.awayScore}` : "Score not entered"}</p>
              </div>
            );
          })}
        </div>
        <div style={{ width: 96, borderLeft: "1.5px dashed #33403A", padding: "12px 10px", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => onEdit(bet)} style={{ background: "none", border: "none", color: "#5F655C", cursor: "pointer", padding: 2 }} aria-label="Edit bet"><Pencil size={13} /></button>
            <button onClick={() => onDelete(bet.id)} style={{ background: "none", border: "none", color: "#5F655C", cursor: "pointer", padding: 2 }} aria-label="Delete bet"><Trash2 size={13} /></button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 20, fontWeight: 700, color: "#E8C766" }}>
              {combinedOdds(bet).toFixed(2)}
            </span>
            <span style={{ fontSize: 11, color: "#8A8F87" }}>stake {fmtMoney(bet.stake)}</span>
            {bet.status !== "pending" && (
              <span style={{ fontSize: 12, fontWeight: 600, color: profit >= 0 ? "#6FCF97" : "#E0654F" }}>
                {profit >= 0 ? "+" : ""}{fmtMoney(profit)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegEditor({ leg, index, onChange, onRemove, removable, teamNames }) {
  const set = (k) => (e) => onChange({ ...leg, [k]: e.target.value });
  const inputStyle = { width: "100%", background: "#141A21", border: "1px solid #262E36", borderRadius: 8, padding: "8px 9px", color: "#F1EFE7", fontSize: 13, marginBottom: 8, boxSizing: "border-box" };
  const label = { fontSize: 11, color: "#8A8F87", marginBottom: 3, display: "block" };

  return (
    <div style={{ background: "#141A21", border: "1px solid #262E36", borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#8A8F87" }}>Match {index + 1}</span>
        {removable && (
          <button onClick={onRemove} style={{ background: "none", border: "none", color: "#E0654F", fontSize: 11, cursor: "pointer" }}>Remove</button>
        )}
      </div>

      <label style={label}>League</label>
      <input placeholder="e.g. Premier League" value={leg.league} onChange={set("league")} style={inputStyle} />

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Home team</label>
          <input placeholder="Home" value={leg.home} onChange={set("home")} style={inputStyle} list="team-suggestions" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>Away team</label>
          <input placeholder="Away" value={leg.away} onChange={set("away")} style={inputStyle} list="team-suggestions" />
        </div>
      </div>

      <label style={label}>Initial match odds (home / draw / away)</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input type="number" step="0.01" placeholder="Home" value={leg.homeOdds} onChange={set("homeOdds")} style={inputStyle} />
        <input type="number" step="0.01" placeholder="Draw" value={leg.drawOdds} onChange={set("drawOdds")} style={inputStyle} />
        <input type="number" step="0.01" placeholder="Away" value={leg.awayOdds} onChange={set("awayOdds")} style={inputStyle} />
      </div>

      <label style={label}>Final score</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="number" min="0" placeholder="Home" value={leg.homeScore} onChange={set("homeScore")} style={inputStyle} />
        <span style={{ color: "#5F655C", marginBottom: 8 }}>-</span>
        <input type="number" min="0" placeholder="Away" value={leg.awayScore} onChange={set("awayScore")} style={inputStyle} />
      </div>

      <label style={label}>Market</label>
      <input placeholder="e.g. Match result, Over/Under 2.5" value={leg.market} onChange={set("market")} style={inputStyle} />

      <label style={label}>Selection</label>
      <input placeholder="e.g. Home win" value={leg.selection} onChange={set("selection")} style={inputStyle} />

      <label style={label}>Odds for this selection</label>
      <input type="number" step="0.01" placeholder="1.90" value={leg.odds} onChange={set("odds")} style={inputStyle} />
    </div>
  );
}

function AddBetForm({ onSave, onClose, teamNames, editing }) {
  const [date, setDate] = useState(editing?.date || new Date().toISOString().slice(0, 10));
  const [stake, setStake] = useState(editing?.stake || "");
  const [status, setStatus] = useState(editing?.status || "pending");
  const [legs, setLegs] = useState(editing?.legs?.length ? editing.legs.map((l) => ({ ...l })) : [emptyLeg()]);
  const [error, setError] = useState("");

  const updateLeg = (i, next) => setLegs((ls) => ls.map((l, idx) => (idx === i ? next : l)));
  const removeLeg = (i) => setLegs((ls) => ls.filter((_, idx) => idx !== i));
  const addLeg = () => setLegs((ls) => [...ls, emptyLeg()]);

  const total = legs.reduce((acc, l) => acc * (Number(l.odds) > 0 ? Number(l.odds) : 1), 1);

  const submit = () => {
    for (const l of legs) {
      if (!l.home.trim() || !l.away.trim()) { setError("Every match needs both teams."); return; }
      if (!l.odds || Number(l.odds) <= 1) { setError("Every match needs odds greater than 1.00."); return; }
    }
    if (!stake || Number(stake) <= 0) { setError("Enter a stake."); return; }
    onSave({ id: editing?.id || uid(), date, stake, status, legs });
  };

  const inputStyle = { width: "100%", background: "#141A21", border: "1px solid #262E36", borderRadius: 8, padding: "9px 10px", color: "#F1EFE7", fontSize: 14, marginBottom: 10, boxSizing: "border-box" };
  const label = { fontSize: 11, color: "#8A8F87", marginBottom: 4, display: "block" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 30, display: "flex", alignItems: "flex-end" }}>
      <datalist id="team-suggestions">
        {teamNames.map((n) => <option key={n} value={n} />)}
      </datalist>
      <div style={{ background: "#10151B", width: "100%", maxHeight: "92vh", overflowY: "auto", borderRadius: "16px 16px 0 0", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#F1EFE7", fontSize: 20, margin: 0 }}>{editing ? "Edit bet" : "Log a bet"}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8A8F87", cursor: "pointer" }}><X size={20} /></button>
        </div>

        <label style={label}>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

        {legs.map((leg, i) => (
          <LegEditor key={leg.id} leg={leg} index={i} onChange={(next) => updateLeg(i, next)} onRemove={() => removeLeg(i)} removable={legs.length > 1} teamNames={teamNames} />
        ))}

        <button onClick={addLeg} style={{ width: "100%", background: "transparent", color: "#E8C766", border: "1px dashed #4A4324", borderRadius: 8, padding: "10px 0", fontSize: 13, cursor: "pointer", marginBottom: 14 }}>
          + Add another match {legs.length >= 1 ? "(makes this an accumulator)" : ""}
        </button>

        {legs.length > 1 && (
          <p style={{ fontSize: 12, color: "#8A8F87", margin: "-6px 0 14px" }}>Combined odds: <span style={{ color: "#E8C766", fontWeight: 600 }}>{total.toFixed(2)}</span></p>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Stake</label>
            <input type="number" step="0.01" placeholder="10" value={stake} onChange={(e) => setStake(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, appearance: "none" }}>
              {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {error && (
          <p style={{ color: "#E0654F", fontSize: 12, display: "flex", alignItems: "center", gap: 6, margin: "4px 0 10px" }}>
            <AlertCircle size={13} /> {error}
          </p>
        )}

        <button onClick={submit} style={{ width: "100%", background: "#E8C766", color: "#2A2109", border: "none", borderRadius: 8, padding: "12px 0", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
          {editing ? "Save changes" : "Save bet"}
        </button>
      </div>
    </div>
  );
}

function BetsTab({ bets, setBets, teamNames }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");

  const addOrUpdate = async (bet) => {
    const next = editing ? bets.map((b) => (b.id === bet.id ? bet : b)) : [bet, ...bets];
    setBets(next);
    await saveBets(next);
    setShowForm(false);
    setEditing(null);
  };
  const remove = async (id) => {
    const next = bets.filter((b) => b.id !== id);
    setBets(next);
    await saveBets(next);
  };
  const openEdit = (bet) => { setEditing(bet); setShowForm(true); };

  const filtered = useMemo(() => {
    let list = filter === "all" ? bets : bets.filter((b) => b.status === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((b) => (b.legs || []).some((l) =>
        (l.home || "").toLowerCase().includes(q) ||
        (l.away || "").toLowerCase().includes(q) ||
        (l.league || "").toLowerCase().includes(q) ||
        (l.market || "").toLowerCase().includes(q)
      ));
    }
    const sorted = [...list];
    if (sortBy === "date_desc") sorted.sort((a, b) => (a.date < b.date ? 1 : -1));
    else if (sortBy === "date_asc") sorted.sort((a, b) => (a.date > b.date ? 1 : -1));
    else if (sortBy === "profit_desc") sorted.sort((a, b) => profitFor(b) - profitFor(a));
    else if (sortBy === "stake_desc") sorted.sort((a, b) => (Number(b.stake) || 0) - (Number(a.stake) || 0));
    return sorted;
  }, [bets, filter, query, sortBy]);

  const filters = ["all", "pending", "won", "lost", "void"];
  const selectStyle = { background: "#141A21", border: "1px solid #262E36", borderRadius: 8, padding: "7px 8px", color: "#F1EFE7", fontSize: 12 };

  return (
    <div style={{ paddingBottom: 90 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "20px 16px 10px" }}>
        <div>
          <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 28, color: "#F1EFE7", margin: 0 }}>Bets</h1>
          <p style={{ color: "#8A8F87", fontSize: 13, margin: "4px 0 0" }}>{bets.length} logged</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ background: "#E8C766", border: "none", borderRadius: 8, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Plus size={20} color="#2A2109" />
        </button>
      </div>

      <div style={{ padding: "0 16px 10px", position: "relative" }}>
        <Search size={14} color="#5F655C" style={{ position: "absolute", left: 26, top: 10 }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search team, league, market"
          style={{ width: "100%", background: "#141A21", border: "1px solid #262E36", borderRadius: 8, padding: "8px 10px 8px 30px", color: "#F1EFE7", fontSize: 13, boxSizing: "border-box" }} />
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 16px 8px", overflowX: "auto" }}>
        {filters.map((f) => (
          <Pill key={f} active={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : STATUS_META[f].label}</Pill>
        ))}
      </div>

      <div style={{ padding: "0 16px 12px", display: "flex", justifyContent: "flex-end" }}>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={selectStyle}>
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="profit_desc">Highest profit</option>
          <option value="stake_desc">Largest stake</option>
        </select>
      </div>

      <div style={{ padding: "0 16px" }}>
        {filtered.length === 0 ? (
          <EmptyState icon={TrendingUp} title={bets.length === 0 ? "No bets here yet" : "No matches found"} body={bets.length === 0 ? "Tap the + button to log your first bet." : "Try a different search or filter."} />
        ) : (
          filtered.map((b) => <BetTicket key={b.id} bet={b} onDelete={remove} onEdit={openEdit} />)
        )}
      </div>

      {showForm && (
        <AddBetForm onSave={addOrUpdate} onClose={() => { setShowForm(false); setEditing(null); }} teamNames={teamNames} editing={editing} />
      )}
    </div>
  );
}

// ---------- Teams tab ----------
function buildTeamStats(bets) {
  const map = {};
  const touch = (name) => {
    if (!map[name]) map[name] = {
      name, played: 0, wins: 0, draws: 0, losses: 0,
      homePlayed: 0, homeWins: 0, homeDraws: 0, homeLosses: 0,
      awayPlayed: 0, awayWins: 0, awayDraws: 0, awayLosses: 0,
      staked: 0, profit: 0, bets: 0,
    };
    return map[name];
  };
  bets.forEach((b) => {
    const settled = b.status === "won" || b.status === "lost";
    const teamsInBet = new Set();
    (b.legs || []).forEach((leg) => {
      if (!leg.home || !leg.away) return;
      const res = legResult(leg);
      const home = touch(leg.home);
      const away = touch(leg.away);
      if (res) {
        home.played++; away.played++;
        home.homePlayed++; away.awayPlayed++;
        if (res === "home") { home.wins++; home.homeWins++; away.losses++; away.awayLosses++; }
        else if (res === "away") { away.wins++; away.awayWins++; home.losses++; home.homeLosses++; }
        else { home.draws++; home.homeDraws++; away.draws++; away.awayDraws++; }
      }
      teamsInBet.add(leg.home); teamsInBet.add(leg.away);
    });
    if (settled) {
      teamsInBet.forEach((name) => {
        const t = touch(name);
        t.staked += Number(b.stake) || 0;
        t.profit += profitFor(b);
        t.bets += 1;
      });
    }
  });
  return Object.values(map).sort((a, b) => b.played - a.played);
}

// ---------- pattern-based bet suggestions ----------
// Purely descriptive stats from the user's own logged match history —
// not a live model or external data. Always paired with sample size
// in the UI so small samples don't look more confident than they are.
function suggestedBets(bets, minSample = 3) {
  const teams = buildTeamStats(bets);
  const home = teams.filter((t) => t.homePlayed >= minSample).map((t) => ({
    team: t.name, venue: "home", market: "Home win",
    rate: t.homePlayed ? (t.homeWins / t.homePlayed) * 100 : 0, sample: t.homePlayed,
  }));
  const away = teams.filter((t) => t.awayPlayed >= minSample).map((t) => ({
    team: t.name, venue: "away", market: "Away win",
    rate: t.awayPlayed ? (t.awayWins / t.awayPlayed) * 100 : 0, sample: t.awayPlayed,
  }));
  return [...home, ...away].sort((a, b) => b.rate - a.rate || b.sample - a.sample).slice(0, 6);
}

// ---------- best/worst single bets ----------
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------- today, scoped strictly to the current date, never accumulating ----------
function todayStats(bets) {
  const todays = bets.filter((b) => b.date === todayStr());
  const settled = todays.filter((b) => b.status === "won" || b.status === "lost");
  const won = settled.filter((b) => b.status === "won");
  const lost = settled.filter((b) => b.status === "lost");
  return {
    profit: won.reduce((s, b) => s + profitFor(b), 0),
    loss: lost.reduce((s, b) => s + profitFor(b), 0), // negative number
    stake: todays.reduce((s, b) => s + (Number(b.stake) || 0), 0),
    winRate: settled.length ? (won.length / settled.length) * 100 : 0,
    betCount: todays.length,
  };
}

// ---------- all-time extremes: only move when actually beaten ----------
function allTimeExtremes(bets) {
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  if (!settled.length) return { highestProfit: null, worstDay: null };
  let highestProfit = settled[0];
  settled.forEach((b) => { if (profitFor(b) > profitFor(highestProfit)) highestProfit = b; });
  const dayMap = {};
  settled.forEach((b) => { dayMap[b.date] = (dayMap[b.date] || 0) + profitFor(b); });
  const dayEntries = Object.entries(dayMap);
  const worst = dayEntries.reduce((a, b) => (b[1] < a[1] ? b : a));
  return { highestProfit, worstDay: { date: worst[0], profit: worst[1] } };
}

// ---------- ISO week key, used for "this week" grouping ----------
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo}`;
}

// ---------- running totals: this week adds up its days, this month adds up
// its weeks, this year adds up its months. Not averages — real running sums. ----------
function currentPeriodProfit(bets, unit) {
  const now = new Date();
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  let inPeriod;
  if (unit === "week") {
    const key = isoWeekKey(now);
    inPeriod = settled.filter((b) => isoWeekKey(new Date(b.date)) === key);
  } else if (unit === "month") {
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    inPeriod = settled.filter((b) => { const d = new Date(b.date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === key; });
  } else {
    inPeriod = settled.filter((b) => new Date(b.date).getFullYear() === now.getFullYear());
  }
  return { total: inPeriod.reduce((s, b) => s + profitFor(b), 0), count: inPeriod.length };
}

// ---------- loss-pattern signals ----------
function longestStreak(settled, status) {
  const sorted = [...settled].sort((a, b) => (a.date < b.date ? -1 : 1));
  let max = 0, cur = 0;
  sorted.forEach((b) => { if (b.status === status) { cur++; max = Math.max(max, cur); } else cur = 0; });
  return max;
}
function avgStakeByOutcome(settled) {
  const won = settled.filter((b) => b.status === "won");
  const lost = settled.filter((b) => b.status === "lost");
  const avg = (list) => (list.length ? list.reduce((s, b) => s + (Number(b.stake) || 0), 0) / list.length : 0);
  return { avgWinStake: avg(won), avgLossStake: avg(lost) };
}
const average = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

// ---------- flat-stake tiered projection ----------
// Stake starts flat (e.g. 1,000 UGX) on every bet. Once cumulative profit
// crosses a threshold (e.g. 100,000 UGX), every future stake upgrades to a
// higher flat amount (e.g. 10,000 UGX) and stays there — it does not
// downgrade if a later losing streak brings profit back down. Deterministic
// expected-value math using the user's own win rate and average odds —
// not a guarantee, real results vary bet to bet.
function simulateFlatStaking({ initialStake, thresholdProfit, upgradedStake, winRate, avgOdds, betsPerWeek, weeks }) {
  let cumulativeProfit = 0;
  let upgraded = false;
  const totalBets = Math.max(1, Math.round(betsPerWeek * weeks));
  for (let i = 0; i < totalBets; i++) {
    if (!upgraded && cumulativeProfit >= thresholdProfit) upgraded = true;
    const stake = upgraded ? upgradedStake : initialStake;
    const ev = stake * ((winRate / 100) * avgOdds - 1);
    cumulativeProfit += ev;
  }
  return cumulativeProfit;
}

function TeamsTab({ bets }) {
  const teams = useMemo(() => buildTeamStats(bets), [bets]);
  const [selected, setSelected] = useState(null);
  const selectedTeam = teams.find((t) => t.name === selected);
  const selectedBets = selected ? bets.filter((b) => (b.legs || []).some((l) => l.home === selected || l.away === selected)) : [];

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="Teams" subtitle="Built from the matches you've logged" />
      <div style={{ padding: "0 16px" }}>
        {teams.length === 0 ? (
          <EmptyState icon={Users} title="No teams yet" body="Log a few bets with final scores and team form will build up here." />
        ) : !selected ? (
          teams.map((t) => (
            <div key={t.name} onClick={() => setSelected(t.name)} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: "#141A21", border: "1px solid #262E36", borderRadius: 10, padding: "11px 14px", marginBottom: 8, cursor: "pointer",
            }}>
              <div>
                <p style={{ color: "#F1EFE7", fontSize: 14, margin: 0 }}>{t.name}</p>
                <p style={{ color: "#8A8F87", fontSize: 11, margin: "2px 0 0" }}>{t.played} matches recorded</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 12, color: "#F1EFE7", margin: 0 }}>{t.wins}W {t.draws}D {t.losses}L</p>
                {t.bets > 0 && (
                  <p style={{ fontSize: 11, margin: "2px 0 0", color: t.profit >= 0 ? "#6FCF97" : "#E0654F" }}>
                    {t.profit >= 0 ? "+" : ""}{fmtMoney(t.profit)} betting
                  </p>
                )}
              </div>
            </div>
          ))
        ) : (
          <div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8A8F87", fontSize: 12, marginBottom: 12, cursor: "pointer" }}>← Back to teams</button>
            <p style={{ color: "#F1EFE7", fontSize: 18, fontFamily: "'Barlow Condensed', sans-serif", margin: "0 0 12px" }}>{selectedTeam.name}</p>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[["Played", selectedTeam.played], ["Record", `${selectedTeam.wins}-${selectedTeam.draws}-${selectedTeam.losses}`], ["Bet P/L", (selectedTeam.profit >= 0 ? "+" : "") + fmtMoney(selectedTeam.profit)]].map(([l, v]) => (
                <div key={l} style={{ flex: 1, background: "#141A21", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                  <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 700, color: "#E8C766", margin: 0 }}>{v}</p>
                  <p style={{ fontSize: 10, color: "#8A8F87", margin: "2px 0 0" }}>{l}</p>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <div style={{ flex: 1, background: "#141A21", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 11, color: "#8A8F87", margin: "0 0 4px" }}>At home ({selectedTeam.homePlayed})</p>
                <p style={{ fontSize: 13, color: "#F1EFE7", margin: 0 }}>{selectedTeam.homeWins}W {selectedTeam.homeDraws}D {selectedTeam.homeLosses}L</p>
              </div>
              <div style={{ flex: 1, background: "#141A21", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ fontSize: 11, color: "#8A8F87", margin: "0 0 4px" }}>Away ({selectedTeam.awayPlayed})</p>
                <p style={{ fontSize: 13, color: "#F1EFE7", margin: 0 }}>{selectedTeam.awayWins}W {selectedTeam.awayDraws}D {selectedTeam.awayLosses}L</p>
              </div>
            </div>

            <p style={{ color: "#8A8F87", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, margin: "0 0 8px" }}>Match history</p>
            {selectedBets.map((b) => (b.legs || []).filter((l) => l.home === selected || l.away === selected).map((leg) => {
              const res = legResult(leg);
              return (
                <div key={leg.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1D242B" }}>
                  <span style={{ fontSize: 13, color: "#F1EFE7" }}>{leg.home} vs {leg.away}</span>
                  <span style={{ fontSize: 12, color: "#8A8F87" }}>{res ? `${leg.homeScore}-${leg.awayScore}` : "—"} · {b.date}</span>
                </div>
              );
            }))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- H2H tab ----------
function H2HTab({ bets }) {
  const teamNames = useMemo(() => {
    const set = new Set();
    bets.forEach((b) => (b.legs || []).forEach((l) => { if (l.home) set.add(l.home); if (l.away) set.add(l.away); }));
    return Array.from(set).sort();
  }, [bets]);

  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");

  const legMatches = useMemo(() => {
    if (!teamA || !teamB) return [];
    const out = [];
    bets.forEach((b) => (b.legs || []).forEach((l) => {
      if ((l.home === teamA && l.away === teamB) || (l.home === teamB && l.away === teamA)) out.push({ leg: l, date: b.date });
    }));
    return out;
  }, [bets, teamA, teamB]);

  const summary = useMemo(() => {
    let aWins = 0, bWins = 0, draws = 0;
    legMatches.forEach(({ leg }) => {
      const res = legResult(leg);
      if (!res) return;
      if (res === "draw") { draws++; return; }
      const winner = res === "home" ? leg.home : leg.away;
      if (winner === teamA) aWins++; else bWins++;
    });
    return { aWins, bWins, draws };
  }, [legMatches, teamA]);

  const selectStyle = { flex: 1, background: "#141A21", border: "1px solid #262E36", borderRadius: 8, padding: "9px 10px", color: "#F1EFE7", fontSize: 14, appearance: "none" };

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="Head to head" subtitle="Compare two teams from your own bet history" />
      <div style={{ padding: "0 16px" }}>
        {teamNames.length < 2 ? (
          <EmptyState icon={Swords} title="Not enough teams yet" body="Log matches for at least two different teams to compare them here." />
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <select value={teamA} onChange={(e) => setTeamA(e.target.value)} style={selectStyle}>
                  <option value="">Team A</option>
                  {teamNames.filter((n) => n !== teamB).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <ChevronDown size={14} color="#5F655C" style={{ position: "absolute", right: 10, top: 12, pointerEvents: "none" }} />
              </div>
              <span style={{ color: "#5F655C", fontSize: 12 }}>vs</span>
              <div style={{ position: "relative", flex: 1 }}>
                <select value={teamB} onChange={(e) => setTeamB(e.target.value)} style={selectStyle}>
                  <option value="">Team B</option>
                  {teamNames.filter((n) => n !== teamA).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <ChevronDown size={14} color="#5F655C" style={{ position: "absolute", right: 10, top: 12, pointerEvents: "none" }} />
              </div>
            </div>

            {teamA && teamB && (
              legMatches.length === 0 ? (
                <EmptyState icon={Swords} title="No meetings logged" body={`You haven't recorded a match between ${teamA} and ${teamB} yet.`} />
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {[[`${teamA} wins`, summary.aWins], ["Draws", summary.draws], [`${teamB} wins`, summary.bWins]].map(([l, v]) => (
                      <div key={l} style={{ flex: 1, background: "#141A21", borderRadius: 10, padding: "10px 6px", textAlign: "center" }}>
                        <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700, color: "#E8C766", margin: 0 }}>{v}</p>
                        <p style={{ fontSize: 10, color: "#8A8F87", margin: "2px 0 0" }}>{l}</p>
                      </div>
                    ))}
                  </div>
                  <p style={{ color: "#8A8F87", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, margin: "0 0 8px" }}>Meetings</p>
                  {legMatches.map(({ leg, date }) => {
                    const res = legResult(leg);
                    return (
                      <div key={leg.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1D242B" }}>
                        <span style={{ fontSize: 13, color: "#F1EFE7" }}>{leg.home} vs {leg.away}</span>
                        <span style={{ fontSize: 12, color: "#8A8F87" }}>{res ? `${leg.homeScore}-${leg.awayScore}` : "—"} · {date}</span>
                      </div>
                    );
                  })}
                </>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Analysis tab ----------
function EquityCurve({ settled }) {
  const data = useMemo(() => {
    const sorted = [...settled].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
    let cum = 0;
    return sorted.map((b, i) => {
      cum += profitFor(b);
      return { i: i + 1, date: b.date, cum: Math.round(cum) };
    });
  }, [settled]);

  if (data.length < 2) return null;

  const yFmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : String(v));

  return (
    <div style={{ background: "#141A21", borderRadius: 10, padding: "14px 8px 6px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "0 8px 8px" }}>
        <p style={{ fontSize: 12, color: "#8A8F87", margin: 0 }}>Cumulative profit (UGX)</p>
        <p style={{ fontSize: 11, color: "#5F655C", margin: 0 }}>{data.length} settled bets, exact values</p>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#212B22" vertical={false} />
          <XAxis dataKey="i" hide />
          <YAxis tick={{ fill: "#8A8F87", fontSize: 10 }} width={44} tickFormatter={yFmt} />
          <Tooltip
            contentStyle={{ background: "#10151B", border: "1px solid #262E36", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(_, p) => p?.[0]?.payload?.date || ""}
            formatter={(v) => [fmtMoney(v), "Cumulative"]}
          />
          <Line type="linear" dataKey="cum" stroke="#E8C766" strokeWidth={2} dot={{ r: 2.5, fill: "#E8C766", strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildRecommendations(settled) {
  if (settled.length < 5) return { insufficientData: true };

  const groupBy = (keyFn) => {
    const map = {};
    settled.forEach((b) => {
      (b.legs || []).forEach((leg) => {
        const key = keyFn(leg, b);
        if (!key) return;
        if (!map[key]) map[key] = { staked: 0, profit: 0, count: 0 };
        map[key].staked += Number(b.stake) || 0;
        map[key].profit += profitFor(b);
        map[key].count += 1;
      });
    });
    return Object.entries(map).map(([name, d]) => ({ name, ...d, roi: d.staked ? (d.profit / d.staked) * 100 : 0 }));
  };

  const byMarket = groupBy((leg) => leg.market || null).filter((r) => r.count >= 3);
  const byLeague = groupBy((leg) => leg.league || null).filter((r) => r.count >= 3);
  const byTeam = groupBy((leg) => leg.home || null).concat(groupBy((leg) => leg.away || null)).filter((r) => r.count >= 3);

  const recs = [];

  const best = [...byMarket, ...byLeague].sort((a, b) => b.roi - a.roi)[0];
  if (best && best.roi > 5) recs.push({ tone: "positive", text: `${best.name} has been your strongest area, with ${best.roi.toFixed(0)}% ROI across ${best.count} bets.` });

  const worst = [...byMarket, ...byLeague].sort((a, b) => a.roi - b.roi)[0];
  if (worst && worst.roi < -10) recs.push({ tone: "negative", text: `${worst.name} has cost you, running at ${worst.roi.toFixed(0)}% ROI across ${worst.count} bets — worth reviewing before betting there again.` });

  const teamMap = {};
  byTeam.forEach((t) => { teamMap[t.name] = teamMap[t.name] ? { ...t, staked: t.staked + teamMap[t.name].staked, profit: t.profit + teamMap[t.name].profit, count: t.count + teamMap[t.name].count } : t; });
  const teamsList = Object.values(teamMap).map((t) => ({ ...t, roi: t.staked ? (t.profit / t.staked) * 100 : 0 })).filter((t) => t.count >= 3);
  const bestTeam = [...teamsList].sort((a, b) => b.roi - a.roi)[0];
  if (bestTeam && bestTeam.roi > 10) recs.push({ tone: "positive", text: `Bets involving ${bestTeam.name} return ${bestTeam.roi.toFixed(0)}% ROI over ${bestTeam.count} bets, your best-performing team.` });
  const worstTeam = [...teamsList].sort((a, b) => a.roi - b.roi)[0];
  if (worstTeam && worstTeam.roi < -15) recs.push({ tone: "negative", text: `Bets involving ${worstTeam.name} are down ${Math.abs(worstTeam.roi).toFixed(0)}% ROI over ${worstTeam.count} bets.` });

  const singles = settled.filter((b) => (b.legs || []).length === 1);
  const accas = settled.filter((b) => (b.legs || []).length > 1);
  if (singles.length >= 3 && accas.length >= 3) {
    const roi = (list) => {
      const staked = list.reduce((s, b) => s + (Number(b.stake) || 0), 0);
      const profit = list.reduce((s, b) => s + profitFor(b), 0);
      return staked ? (profit / staked) * 100 : 0;
    };
    const singleRoi = roi(singles), accaRoi = roi(accas);
    if (Math.abs(singleRoi - accaRoi) > 15) {
      const better = singleRoi > accaRoi ? "singles" : "accumulators";
      recs.push({ tone: "neutral", text: `${better === "singles" ? "Singles" : "Accumulators"} have outperformed the other bet type recently (${better === "singles" ? singleRoi.toFixed(0) : accaRoi.toFixed(0)}% vs ${better === "singles" ? accaRoi.toFixed(0) : singleRoi.toFixed(0)}% ROI).` });
    }
  }

  if (recs.length === 0) recs.push({ tone: "neutral", text: "No strong pattern yet — keep logging results and clearer trends will show up here." });

  return { recs };
}

function SuggestedBetsPanel({ bets }) {
  const suggestions = useMemo(() => suggestedBets(bets), [bets]);
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel>Suggested bets</SectionLabel>
      <p style={{ fontSize: 11, color: "#5F655C", margin: "-4px 0 10px", lineHeight: 1.5 }}>
        Based only on matches you've logged yourself — not live odds or outside data. Small samples can look more confident than they are, so check the count next to each one.
      </p>
      {suggestions.length === 0 ? (
        <p style={{ fontSize: 12, color: "#5F655C" }}>Log at least 3 home or away matches for a team to see patterns here.</p>
      ) : (
        suggestions.map((s, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", background: "#141A21",
            border: "1px solid #262E36", borderLeft: i === 0 ? `3px solid ${ACCENT2}` : "1px solid #262E36",
            borderRadius: 10, padding: "10px 12px", marginBottom: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {i === 0 && <Flame size={16} color={ACCENT2} />}
              <div>
                <p style={{ fontSize: 13, color: "#F1EFE7", margin: 0 }}>{s.team}</p>
                <p style={{ fontSize: 11, color: "#8A8F87", margin: "2px 0 0" }}>{s.market} · {s.sample} matches logged</p>
              </div>
            </div>
            <p style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700, color: "#E8C766", margin: 0 }}>{s.rate.toFixed(0)}%</p>
          </div>
        ))
      )}
    </div>
  );
}

function TodayPanel({ bets }) {
  const t = useMemo(() => todayStats(bets), [bets]);
  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel accent={ACCENT2}>Today</SectionLabel>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <StatCard label="Profit today" value={fmtMoney(t.profit)} color="#6FCF97" minWidth={110} />
        <StatCard label="Loss today" value={fmtMoney(t.loss)} color="#E0654F" minWidth={110} />
        <StatCard label="Stake used today" value={fmtMoney(t.stake)} color={ACCENT2} minWidth={110} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatCard label="Win rate today" value={`${t.winRate.toFixed(0)}%`} minWidth={110} />
        <StatCard label="Bets today" value={t.betCount} minWidth={110} />
      </div>
      {t.betCount === 0 && <p style={{ fontSize: 11, color: "#5F655C", margin: "8px 0 0" }}>Nothing logged today yet — these reset fresh every day.</p>}
    </div>
  );
}

function ExtremesPanel({ bets }) {
  const { highestProfit, worstDay } = useMemo(() => allTimeExtremes(bets), [bets]);
  if (!highestProfit) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel>Highs and lows (all-time)</SectionLabel>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatCard label="Highest profit ever" value={fmtMoney(profitFor(highestProfit))} sub={`${highestProfit.date} · single bet`} color="#6FCF97" minWidth={150} />
        <StatCard label="Biggest loss (day combined)" value={fmtMoney(worstDay.profit)} sub={worstDay.date} color="#E0654F" minWidth={150} />
      </div>
      <p style={{ fontSize: 10.5, color: "#5F655C", margin: "8px 0 0", lineHeight: 1.5 }}>
        "Highest profit ever" only moves when a new bet actually beats it. "Biggest loss" adds up every losing (and winning) bet on your single worst day.
      </p>
    </div>
  );
}

function ProfitSoFarPanel({ bets }) {
  const week = useMemo(() => currentPeriodProfit(bets, "week"), [bets]);
  const month = useMemo(() => currentPeriodProfit(bets, "month"), [bets]);
  const year = useMemo(() => currentPeriodProfit(bets, "year"), [bets]);

  if (week.count + month.count + year.count === 0) return null;

  const card = (label, data, sub) => (
    <StatCard label={label} value={fmtMoney(data.total)} color={data.total >= 0 ? "#6FCF97" : "#E0654F"} sub={sub} minWidth={110} />
  );

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel accent={ACCENT2}>Profit so far</SectionLabel>
      <p style={{ fontSize: 10.5, color: "#5F655C", margin: "-4px 0 10px" }}>Running totals — this week adds up its days, this month adds up its weeks, this year adds up its months.</p>
      <div style={{ display: "flex", gap: 8 }}>
        {card("This week", week, `${week.count} bets`)}
        {card("This month", month, `${month.count} bets`)}
        {card("This year", year, `${year.count} bets`)}
      </div>
    </div>
  );
}

function LossMinimizationPanel({ settled }) {
  const lossStreak = useMemo(() => longestStreak(settled, "lost"), [settled]);
  const winStreak = useMemo(() => longestStreak(settled, "won"), [settled]);
  const { avgWinStake, avgLossStake } = useMemo(() => avgStakeByOutcome(settled), [settled]);
  const chasing = avgLossStake > avgWinStake * 1.2 && settled.length >= 6;

  if (settled.length < 4) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel accent="#E0654F">Minimizing losses</SectionLabel>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <StatCard label="Longest losing streak" value={`${lossStreak} bets`} color="#E0654F" minWidth={130} />
        <StatCard label="Longest winning streak" value={`${winStreak} bets`} color="#6FCF97" minWidth={130} />
      </div>

      <div style={{ background: "#141A21", borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${chasing ? "#E0654F" : "#33403A"}` }}>
        <p style={{ fontSize: 12, color: "#F1EFE7", margin: "0 0 6px" }}>Average stake: {fmtMoney(avgWinStake)} on wins vs {fmtMoney(avgLossStake)} on losses</p>
        {chasing ? (
          <p style={{ fontSize: 12, color: "#E0654F", margin: 0, lineHeight: 1.5 }}>
            You've been staking noticeably more on losing bets than winning ones — a common pattern when chasing back a loss. Consider keeping your stake size fixed regardless of a recent loss.
          </p>
        ) : (
          <p style={{ fontSize: 12, color: "#5F655C", margin: 0, lineHeight: 1.5 }}>
            No sign of staking more after losses — your stake sizing looks consistent.
          </p>
        )}
      </div>
    </div>
  );
}

function CompoundingCalculator({ bets }) {
  const settled = useMemo(() => bets.filter((b) => b.status === "won" || b.status === "lost"), [bets]);
  const singles = useMemo(() => settled.filter((b) => (b.legs || []).length === 1), [settled]);
  const hasData = singles.length >= 5;

  const winRate = hasData ? (singles.filter((b) => b.status === "won").length / singles.length) * 100 : 50;
  const avgOdds = hasData ? average(singles.map((b) => combinedOdds(b))) : 1.9;

  const dateSpanWeeks = useMemo(() => {
    if (settled.length < 2) return 1;
    const dates = settled.map((b) => new Date(b.date).getTime()).sort((a, b) => a - b);
    const span = (dates[dates.length - 1] - dates[0]) / (7 * 86400000);
    return Math.max(1, span);
  }, [settled]);
  const betsPerWeek = hasData ? Math.max(0.5, settled.length / dateSpanWeeks) : 3;

  const [initialStake, setInitialStake] = useState("1000");
  const [thresholdProfit, setThresholdProfit] = useState("100000");
  const [upgradedStake, setUpgradedStake] = useState("10000");

  const edge = (winRate / 100) * avgOdds - 1;

  const checkpoints = [
    ["1 week", 1], ["1 month", 4.33], ["3 months", 13], ["1 year", 52],
  ].map(([label, weeks]) => [
    label,
    simulateFlatStaking({
      initialStake: Number(initialStake) || 0, thresholdProfit: Number(thresholdProfit) || 0, upgradedStake: Number(upgradedStake) || 0,
      winRate, avgOdds, betsPerWeek, weeks,
    }),
  ]);

  const inputStyle = { flex: 1, background: "#10151B", border: "1px solid #262E36", borderRadius: 8, padding: "8px 10px", color: "#F1EFE7", fontSize: 13, boxSizing: "border-box" };
  const label = { fontSize: 11, color: "#8A8F87", marginBottom: 4, display: "block" };

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel accent={ACCENT2}>Compounding calculator</SectionLabel>
      <p style={{ fontSize: 11, color: "#5F655C", margin: "-4px 0 10px", lineHeight: 1.5 }}>
        {hasData
          ? `Using your own historical single-bet win rate (${winRate.toFixed(0)}%) and average odds (${avgOdds.toFixed(2)}).`
          : "Not enough single-bet history yet — showing a rough 50% / 1.90 odds example so you can see how it works. Log more single bets for a figure based on your own numbers."}
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 100 }}>
          <label style={label}>Starting stake (UGX)</label>
          <input type="number" value={initialStake} onChange={(e) => setInitialStake(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <label style={label}>Upgrade after profit reaches (UGX)</label>
          <input type="number" value={thresholdProfit} onChange={(e) => setThresholdProfit(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <label style={label}>Upgraded stake (UGX)</label>
          <input type="number" value={upgradedStake} onChange={(e) => setUpgradedStake(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{
        background: edge >= 0 ? "#141A21" : "#1A1216", border: `1px solid ${edge >= 0 ? "#262E36" : "#3A2320"}`,
        borderRadius: 10, padding: "10px 12px", marginBottom: 12,
      }}>
        <p style={{ fontSize: 12, color: edge >= 0 ? "#F1EFE7" : "#E0654F", margin: 0, lineHeight: 1.5 }}>
          {edge >= 0
            ? `At this win rate and odds, each bet has a positive expected value (roughly +${(edge * 100).toFixed(1)}% of stake). The numbers below can grow over time — but individual bets still win or lose, this is only the average.`
            : `At this win rate and odds, each bet has a negative expected value (roughly ${(edge * 100).toFixed(1)}% of stake). This would shrink your profit on average, not grow it — the numbers below reflect that honestly rather than hide it.`}
        </p>
      </div>

      <div>
        {checkpoints.map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #1D242B" }}>
            <span style={{ fontSize: 13, color: "#F1EFE7" }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: value >= 0 ? "#6FCF97" : "#E0654F", fontFamily: "'Barlow Condensed', sans-serif" }}>{value >= 0 ? "+" : ""}{fmtMoney(value)}</span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: "#5F655C", margin: "12px 0 0", lineHeight: 1.5 }}>
        Once your simulated profit crosses the upgrade threshold, the stake stays upgraded — it doesn't drop back down even if a later losing streak eats into profit. This is a projection from your own average numbers, not a promise. Never stake more than you can afford to lose.
      </p>
    </div>
  );
}

function RecommendationsPanel({ settled }) {
  const { recs, insufficientData } = buildRecommendations(settled);
  const toneColor = { positive: "#6FCF97", negative: "#E0654F", neutral: "#E8C766" };

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionLabel>Recommendations</SectionLabel>
      {insufficientData ? (
        <p style={{ fontSize: 12, color: "#5F655C" }}>Settle at least 5 bets and patterns will start showing up here.</p>
      ) : (
        recs.map((r, i) => (
          <div key={i} style={{ background: "#141A21", borderLeft: `3px solid ${toneColor[r.tone]}`, borderRadius: "0 8px 8px 0", padding: "10px 12px", marginBottom: 8 }}>
            <p style={{ fontSize: 13, color: "#F1EFE7", margin: 0, lineHeight: 1.5 }}>{r.text}</p>
          </div>
        ))
      )}
    </div>
  );
}

function AnalysisTab({ bets }) {
  const [range, setRange] = useState("all");
  const [matchSort, setMatchSort] = useState("desc"); // "desc" = highest profit first

  const filtered = useMemo(() => {
    if (range === "all") return bets;
    const days = range === "7" ? 7 : range === "30" ? 30 : 90;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    return bets.filter((b) => new Date(b.date) >= cutoff);
  }, [bets, range]);

  const settled = filtered.filter((b) => b.status === "won" || b.status === "lost");
  const totalStaked = settled.reduce((s, b) => s + (Number(b.stake) || 0), 0);
  const netProfit = settled.reduce((s, b) => s + profitFor(b), 0);
  const wins = settled.filter((b) => b.status === "won").length;
  const winRate = settled.length ? (wins / settled.length) * 100 : 0;
  const roi = totalStaked ? (netProfit / totalStaked) * 100 : 0;

  const legGroupBy = (keyFn) => {
    const map = {};
    settled.forEach((b) => {
      (b.legs || []).forEach((leg) => {
        const key = keyFn(leg) || "Unspecified";
        if (!map[key]) map[key] = { staked: 0, profit: 0, count: 0 };
        map[key].staked += Number(b.stake) || 0;
        map[key].profit += profitFor(b);
        map[key].count += 1;
      });
    });
    return Object.entries(map).sort((a, b) => b[1].profit - a[1].profit);
  };

  const byLeague = useMemo(() => legGroupBy((l) => l.league), [settled]);
  const byMarket = useMemo(() => legGroupBy((l) => l.market), [settled]);

  const sortedMatches = useMemo(() => {
    const dir = matchSort === "desc" ? -1 : 1;
    return [...settled].sort((a, b) => (profitFor(a) - profitFor(b)) * dir);
  }, [settled, matchSort]);

  const ranges = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]];

  const breakdown = (title, rows) => (
    <>
      <SectionLabel>{title}</SectionLabel>
      {rows.length === 0 ? <p style={{ color: "#5F655C", fontSize: 12 }}>Nothing here yet.</p> : rows.map(([name, d]) => (
        <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1D242B" }}>
          <span style={{ fontSize: 13, color: "#F1EFE7" }}>{name} <span style={{ color: "#5F655C" }}>({d.count})</span></span>
          <span style={{ fontSize: 13, fontWeight: 600, color: d.profit >= 0 ? "#6FCF97" : "#E0654F" }}>{d.profit >= 0 ? "+" : ""}{fmtMoney(d.profit)}</span>
        </div>
      ))}
    </>
  );

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="Analysis" subtitle="Performance, patterns, and projections" />
      <div style={{ padding: "0 16px" }}>
        <TodayPanel bets={bets} />
        <ExtremesPanel bets={bets} />
        <ProfitSoFarPanel bets={bets} />

        <SectionLabel accent={ACCENT2}>Selected period</SectionLabel>
        <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
          {ranges.map(([id, label]) => <Pill key={id} active={range === id} onClick={() => setRange(id)}>{label}</Pill>)}
        </div>

        {settled.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Nothing to analyse yet" body="Settle some bets as won or lost to see your stats here." />
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <StatCard label="Net profit" value={(netProfit >= 0 ? "+" : "") + fmtMoney(netProfit)} color={netProfit >= 0 ? "#6FCF97" : "#E0654F"} minWidth={130} />
              <StatCard label="ROI" value={(roi >= 0 ? "+" : "") + roi.toFixed(1) + "%"} color={roi >= 0 ? "#6FCF97" : "#E0654F"} minWidth={130} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Win rate" value={winRate.toFixed(0) + "%"} minWidth={100} />
              <StatCard label="Bets settled" value={settled.length} minWidth={100} />
              <StatCard label="Staked" value={fmtMoney(totalStaked)} color={ACCENT2} minWidth={100} />
            </div>

            <EquityCurve settled={settled} />
            <SuggestedBetsPanel bets={filtered} />
            <RecommendationsPanel settled={settled} />
            <LossMinimizationPanel settled={settled} />
            <CompoundingCalculator bets={bets} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "20px 0 10px" }}>
              <SectionLabel>{`By match (${sortedMatches.length})`}</SectionLabel>
              <button onClick={() => setMatchSort((s) => (s === "desc" ? "asc" : "desc"))} style={{
                display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "1px solid #262E36",
                borderRadius: 8, padding: "4px 9px", color: "#8A8F87", fontSize: 11, cursor: "pointer",
              }}>
                <ArrowUpDown size={11} /> {matchSort === "desc" ? "Highest first" : "Lowest first"}
              </button>
            </div>
            {sortedMatches.map((b) => {
              const legs = b.legs || [];
              const isAcca = legs.length > 1;
              const p = profitFor(b);
              return (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #1D242B" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: "#F1EFE7", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isAcca ? `Accumulator · ${legs.length} legs` : `${legs[0]?.home || "?"} vs ${legs[0]?.away || "?"}`}
                    </p>
                    <p style={{ fontSize: 11, color: "#5F655C", margin: "2px 0 0" }}>{b.date}</p>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: p >= 0 ? "#6FCF97" : "#E0654F", fontFamily: "'Barlow Condensed', sans-serif", flexShrink: 0, marginLeft: 10 }}>
                    {p >= 0 ? "+" : ""}{fmtMoney(p)}
                  </span>
                </div>
              );
            })}

            {breakdown("By league", byLeague)}
            {breakdown("By market", byMarket)}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Settings tab ----------
function SettingsTab({ bets, setBets }) {
  const [confirming, setConfirming] = useState(false);

  const clearAll = async () => {
    setBets([]);
    await saveBets([]);
    setConfirming(false);
  };

  const exportCSV = () => downloadFile(`bets-${new Date().toISOString().slice(0, 10)}.csv`, betsToCSV(bets), "text/csv");
  const exportJSON = () => downloadFile(`bets-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bets, null, 2), "application/json");

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="Settings" />
      <div style={{ padding: "0 16px" }}>
        <p style={{ fontSize: 12, color: "#8A8F87", margin: "0 0 8px" }}>Data</p>
        <p style={{ fontSize: 12, color: "#5F655C", margin: "0 0 14px", lineHeight: 1.6 }}>
          {bets.length} bets stored on this device. Your bets, teams, and scores are never sent anywhere — only anonymous totals (like ROI and win rate) connect to a server. Need help? Use the WhatsApp button on any screen.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={exportCSV} disabled={bets.length === 0} style={{
            flex: 1, background: "transparent", color: bets.length ? "#F1EFE7" : "#4A4E48", border: "1px solid #262E36", borderRadius: 8,
            padding: "9px 0", fontSize: 13, cursor: bets.length ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}><Download size={13} /> Export CSV</button>
          <button onClick={exportJSON} disabled={bets.length === 0} style={{
            flex: 1, background: "transparent", color: bets.length ? "#F1EFE7" : "#4A4E48", border: "1px solid #262E36", borderRadius: 8,
            padding: "9px 0", fontSize: 13, cursor: bets.length ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}><Download size={13} /> Export JSON</button>
        </div>

        {!confirming ? (
          <button onClick={() => setConfirming(true)} style={{ background: "transparent", color: "#E0654F", border: "1px solid #3A2320", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>
            Clear all bets
          </button>
        ) : (
          <div style={{ background: "#1A1216", border: "1px solid #3A2320", borderRadius: 10, padding: 14 }}>
            <p style={{ fontSize: 13, color: "#F1EFE7", margin: "0 0 10px" }}>This deletes all logged bets permanently. Are you sure?</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={clearAll} style={{ flex: 1, background: "#E0654F", color: "#2A0F0A", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Yes, clear it</button>
              <button onClick={() => setConfirming(false)} style={{ flex: 1, background: "transparent", color: "#8A8F87", border: "1px solid #262E36", borderRadius: 8, padding: "9px 0", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- App ----------
export default function App() {
  const [tab, setTab] = useState("bets");
  const [bets, setBets] = useState([]);
  const [ready, setReady] = useState(false);
  const [deviceId] = useState(getDeviceId);

  // Initial load: restore bets, register this device, time how long it took.
  useEffect(() => {
    const start = performance.now();
    (async () => {
      setBets(await loadBets());
      setReady(true);
      trackDeviceSeen(deviceId);
      trackLoadTime(deviceId, performance.now() - start);
    })();
  }, [deviceId]);

  // Catch unhandled errors app-wide and log them for the admin panel.
  useEffect(() => {
    const onError = (e) => trackError(deviceId, e.message, e.error?.stack);
    const onRejection = (e) => trackError(deviceId, String(e.reason), e.reason?.stack);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [deviceId]);

  // Whenever bets change, push a fresh anonymized performance snapshot
  // (totals and ROI only — no team names or match details).
  useEffect(() => {
    if (!ready) return;
    syncUserStats(deviceId, bets);
  }, [bets, ready, deviceId]);

  const teamNames = useMemo(() => {
    const set = new Set();
    bets.forEach((b) => (b.legs || []).forEach((l) => { if (l.home) set.add(l.home); if (l.away) set.add(l.away); }));
    return Array.from(set).sort();
  }, [bets]);

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#10151B", minHeight: "100vh", maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap');
        input:focus, select:focus { outline: 1px solid #E8C766; }
      `}</style>

      {!ready ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8A8F87" }}>Loading...</div>
      ) : (
        <div style={{ flex: 1 }}>
          {tab === "bets" && <BetsTab bets={bets} setBets={setBets} teamNames={teamNames} />}
          {tab === "teams" && <TeamsTab bets={bets} />}
          {tab === "h2h" && <H2HTab bets={bets} />}
          {tab === "analysis" && <AnalysisTab bets={bets} />}
          {tab === "settings" && <SettingsTab bets={bets} setBets={setBets} />}
        </div>
      )}

      <HelpButton deviceId={deviceId} />
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
