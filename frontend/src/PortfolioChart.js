import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export default function PortfolioChart({ data = [], startValue = 0 }) {
  if (data.length < 2) return (
    <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#1a4a2a", fontFamily: "monospace", fontSize: 12 }}>
      Portfolio history will appear here once market opens and data accumulates
    </div>
  );

  const formatted = data.map(d => ({
    t: new Date(d.ts).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }),
    value: d.value,
    pnl: startValue ? d.value - startValue : 0,
  }));

  const values = formatted.map(d => d.value);
  const minV = Math.min(...values), maxV = Math.max(...values);
  const isUp = values[values.length - 1] >= values[0];
  const color = isUp ? "#00ff88" : "#ff4466";

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: "#0a1a0a", border: "1px solid #1a4a1a", padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>
        <div style={{ color: "#3a7a3a" }}>{d.t}</div>
        <div>Value: <span style={{ color: "#c0d8c0" }}>${d.value.toLocaleString("en", { maximumFractionDigits: 2 })}</span></div>
        <div>P&L: <span style={{ color: d.pnl >= 0 ? "#00ff88" : "#ff4466" }}>{d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(2)}</span></div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="pgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" tick={{ fill: "#2a5a2a", fontSize: 9, fontFamily: "monospace" }} axisLine={{ stroke: "#0f1f0f" }} tickLine={false} interval={Math.floor(formatted.length / 6)} />
        <YAxis domain={[minV * 0.999, maxV * 1.001]} tick={{ fill: "#2a5a2a", fontSize: 9, fontFamily: "monospace" }} axisLine={false} tickLine={false} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={42} />
        <Tooltip content={<Tip />} />
        {startValue > 0 && <ReferenceLine y={startValue} stroke="#2a5a2a" strokeDasharray="4 4" />}
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#pgGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
