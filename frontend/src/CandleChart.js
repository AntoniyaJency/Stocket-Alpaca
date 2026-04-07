import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function CandleChart({ bars = [] }) {
  console.log('LineChart received bars:', bars.length, bars.slice(0, 3));
  
  if (!bars.length) {
    return (
      <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", color: "#D4AF37", fontFamily: "'Exo 2', sans-serif", fontSize: 14, background: "#3A2F5A", border: "1px solid #4A3F7A" }}>
        NO BAR DATA — Check Alpaca connection
      </div>
    );
  }

  const prices = bars.flatMap(b => [b.h, b.l, b.o, b.c]);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pad = (maxP - minP) * 0.05;

  const data = bars.map((b, i) => ({
    i,
    t: new Date(b.t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
    isUp: b.c >= b.o,
    // Moving averages for better visualization
    sma5: bars.slice(Math.max(0, i - 4), i + 1).reduce((sum, bar) => sum + bar.c, 0) / Math.min(i + 1, 5),
    sma20: bars.slice(Math.max(0, i - 19), i + 1).reduce((sum, bar) => sum + bar.c, 0) / Math.min(i + 1, 20),
  }));

  console.log('LineChart processed data:', data.length, data.slice(0, 2));

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: "#2B234B", border: "1px solid #D4AF37", padding: "12px 16px", fontFamily: "'Exo 2', sans-serif", fontSize: 11, borderRadius: "4px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
        <div style={{ color: "#D4AF37", marginBottom: 8, fontWeight: "bold", fontSize: 12 }}>{d.t}</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 10 }}>
          <div style={{ color: "#A0A0A0" }}>Open:</div><div style={{ color: "#ffffff", fontWeight: "bold" }}>${d.o?.toFixed(2)}</div>
          <div style={{ color: "#A0A0A0" }}>High:</div><div style={{ color: "#D4AF37", fontWeight: "bold" }}>${d.h?.toFixed(2)}</div>
          <div style={{ color: "#A0A0A0" }}>Low:</div><div style={{ color: "#E74C3C", fontWeight: "bold" }}>${d.l?.toFixed(2)}</div>
          <div style={{ color: "#A0A0A0" }}>Close:</div><div style={{ color: d.isUp ? "#D4AF37" : "#E74C3C", fontWeight: "bold" }}>${d.c?.toFixed(2)}</div>
          <div style={{ color: "#A0A0A0" }}>Volume:</div><div style={{ color: "#A0A0A0" }}>{(d.v / 1e3).toFixed(0)}K</div>
          <div style={{ color: "#A0A0A0" }}>SMA5:</div><div style={{ color: "#88AAFF" }}>${d.sma5?.toFixed(2)}</div>
          <div style={{ color: "#A0A0A0" }}>SMA20:</div><div style={{ color: "#FFAA00" }}>${d.sma20?.toFixed(2)}</div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height: 450, background: "#3A2F5A", border: "1px solid #4A3F7A", borderRadius: "4px" }}>
      <div style={{ padding: 12, color: "#ffffff", background: "#2B234B", borderBottom: "1px solid #4A3F7A" }}>
        <div style={{ fontSize: 13, marginBottom: 5, fontFamily: "'Exo 2', sans-serif" }}>
          {bars.length} bars | Min: ${minP.toFixed(2)} | Max: ${maxP.toFixed(2)}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={380}>
        <LineChart 
          data={data} 
          margin={{ top: 12, right: 12, left: 8, bottom: 8 }}
          background={{ fill: 'transparent' }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#4A3F7A" opacity={0.4} />
          <XAxis
            dataKey="t"
            tick={{ fill: "#A0A0A0", fontSize: 10, fontFamily: "'Exo 2', sans-serif" }}
            axisLine={{ stroke: "#4A3F7A", strokeWidth: 1 }}
            tickLine={{ stroke: "#4A3F7A", strokeWidth: 1 }}
            interval={Math.floor(data.length / 8)}
          />
          <YAxis
            domain={[minP - pad, maxP + pad]}
            tick={{ fill: "#A0A0A0", fontSize: 10, fontFamily: "'Exo 2', sans-serif" }}
            axisLine={{ stroke: "#4A3F7A", strokeWidth: 1 }}
            tickLine={{ stroke: "#4A3F7A", strokeWidth: 1 }}
            tickFormatter={v => "$" + v.toFixed(0)}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          
          {/* Main Price Line */}
          <Line 
            type="monotone" 
            dataKey="c" 
            stroke="#D4AF37" 
            strokeWidth={3}
            dot={false}
            name="Price"
            activeDot={{ r: 6, fill: "#D4AF37", stroke: "#fff", strokeWidth: 2 }}
          />
          
          {/* High Line */}
          <Line 
            type="monotone" 
            dataKey="h" 
            stroke="#E74C3C" 
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
            opacity={0.7}
            name="High"
          />
          
          {/* Low Line */}
          <Line 
            type="monotone" 
            dataKey="l" 
            stroke="#88AAFF" 
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
            opacity={0.7}
            name="Low"
          />
          
          {/* SMA 5 */}
          <Line 
            type="monotone" 
            dataKey="sma5" 
            stroke="#FFAA00" 
            strokeWidth={2}
            dot={false}
            opacity={0.8}
            name="SMA5"
          />
          
          {/* SMA 20 */}
          <Line 
            type="monotone" 
            dataKey="sma20" 
            stroke="#AA44FF" 
            strokeWidth={2}
            dot={false}
            opacity={0.8}
            name="SMA20"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
