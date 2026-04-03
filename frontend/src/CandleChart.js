import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

function CustomCandle(props) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { o, h, l, c } = payload;
  const isUp = c >= o;
  const color = isUp ? "#00ff88" : "#ff4466";
  const midX = x + width / 2;

  const minY = Math.min(y, y + height);
  const maxY = Math.max(y, y + height);
  const bodyTop = isUp ? minY : maxY - Math.abs(height);

  return (
    <g>
      {/* wick */}
      <line x1={midX} y1={props.high} x2={midX} y2={props.low} stroke={color} strokeWidth={1} />
      {/* body */}
      <rect
        x={x + 1} y={Math.min(props.openY, props.closeY)}
        width={Math.max(2, width - 2)}
        height={Math.max(1, Math.abs(props.openY - props.closeY))}
        fill={color} fillOpacity={0.85}
      />
    </g>
  );
}

export default function CandleChart({ bars = [] }) {
  if (!bars.length) {
    return (
      <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "#1a4a2a", fontFamily: "monospace", fontSize: 13 }}>
        NO BAR DATA — Check Alpaca connection
      </div>
    );
  }

  const prices = bars.flatMap(b => [b.h, b.l]);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pad = (maxP - minP) * 0.05;

  const data = bars.map((b, i) => ({
    i,
    t: new Date(b.t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
    isUp: b.c >= b.o,
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: "#0a1a0a", border: "1px solid #1a4a1a", padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>
        <div style={{ color: "#4a8a4a", marginBottom: 4 }}>{d.t}</div>
        <div>O: <span style={{ color: "#c0d8c0" }}>${d.o?.toFixed(2)}</span></div>
        <div>H: <span style={{ color: "#00ff88" }}>${d.h?.toFixed(2)}</span></div>
        <div>L: <span style={{ color: "#ff4466" }}>${d.l?.toFixed(2)}</span></div>
        <div>C: <span style={{ color: d.isUp ? "#00ff88" : "#ff4466" }}>${d.c?.toFixed(2)}</span></div>
        <div>V: <span style={{ color: "#6a9a6a" }}>{(d.v / 1e3).toFixed(0)}K</span></div>
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="t"
            tick={{ fill: "#2a5a2a", fontSize: 9, fontFamily: "monospace" }}
            axisLine={{ stroke: "#0f1f0f" }}
            tickLine={false}
            interval={Math.floor(data.length / 8)}
          />
          <YAxis
            domain={[minP - pad, maxP + pad]}
            tick={{ fill: "#2a5a2a", fontSize: 9, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => "$" + v.toFixed(0)}
            width={54}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Render each candle as a custom bar */}
          <Bar dataKey="c" shape={(props) => {
            const { x, y, width, payload, yAxis } = props;
            if (!payload || !yAxis) return null;
            const toY = (v) => yAxis.scale(v);
            const isUp = payload.c >= payload.o;
            const color = isUp ? "#00ff88" : "#ff4466";
            const midX = x + width / 2;
            return (
              <g key={payload.i}>
                <line x1={midX} y1={toY(payload.h)} x2={midX} y2={toY(payload.l)} stroke={color} strokeWidth={1} opacity={0.7} />
                <rect
                  x={x + 1} y={Math.min(toY(payload.o), toY(payload.c))}
                  width={Math.max(2, width - 2)}
                  height={Math.max(1, Math.abs(toY(payload.o) - toY(payload.c)))}
                  fill={color} fillOpacity={0.85}
                />
              </g>
            );
          }}>
            {data.map((d, i) => <Cell key={i} fill={d.isUp ? "#00ff88" : "#ff4466"} />)}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
