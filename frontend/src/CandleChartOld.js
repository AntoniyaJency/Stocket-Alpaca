import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

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
  console.log('CandleChart received bars:', bars.length, bars.slice(0, 3));
  console.log('Sample bar data:', bars[0]);
  
  if (!bars.length) {
    return (
      <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", color: "#D4AF37", fontFamily: "'Exo 2', sans-serif", fontSize: 14, background: "#3A2F5A", border: "1px solid #4A3F7A" }}>
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

  console.log('CandleChart processed data:', data.length, data.slice(0, 2));
  console.log('Price range:', { minP, maxP, pad });

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: "#2B234B", border: "1px solid #D4AF37", padding: "10px 14px", fontFamily: "'Exo 2', sans-serif", fontSize: 11, borderRadius: "4px" }}>
        <div style={{ color: "#D4AF37", marginBottom: 6, fontWeight: "bold" }}>{d.t}</div>
        <div>O: <span style={{ color: "#ffffff" }}>${d.o?.toFixed(2)}</span></div>
        <div>H: <span style={{ color: "#D4AF37" }}>${d.h?.toFixed(2)}</span></div>
        <div>L: <span style={{ color: "#E74C3C" }}>${d.l?.toFixed(2)}</span></div>
        <div>C: <span style={{ color: d.isUp ? "#D4AF37" : "#E74C3C" }}>${d.c?.toFixed(2)}</span></div>
        <div>V: <span style={{ color: "#A0A0A0" }}>{(d.v / 1e3).toFixed(0)}K</span></div>
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
        <ComposedChart 
          data={data} 
          margin={{ top: 12, right: 12, left: 8, bottom: 8 }}
          background={{ fill: 'transparent' }}
        >
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
          {/* Grid lines for better visibility */}
          <CartesianGrid strokeDasharray="3 3" stroke="#4A3F7A" opacity={0.3} />
          {/* Render each candle as a custom bar */}
          <Bar dataKey="c" shape={(props) => {
            const { x, y, width, payload, yAxis } = props;
            if (!payload || !yAxis) return null;
            const toY = (v) => yAxis.scale(v);
            const isUp = payload.c >= payload.o;
            const color = isUp ? "#D4AF37" : "#E74C3C";
            const midX = x + width / 2;
            
            // Calculate candle positions
            const openY = toY(payload.o);
            const closeY = toY(payload.c);
            const highY = toY(payload.h);
            const lowY = toY(payload.l);
            
            // Ensure minimum visibility
            const candleWidth = Math.max(4, width - 2);
            const bodyHeight = Math.max(2, Math.abs(openY - closeY));
            const bodyY = Math.min(openY, closeY);
            
            return (
              <g key={payload.i}>
                {/* Wick - high to low */}
                <line 
                  x1={midX} 
                  y1={highY} 
                  x2={midX} 
                  y2={lowY} 
                  stroke={color} 
                  strokeWidth={3} 
                  opacity={1}
                />
                {/* Body */}
                <rect
                  x={x + (width - candleWidth) / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color} 
                  fillOpacity={1}
                  stroke={color}
                  strokeWidth={1}
                />
              </g>
            );
          }}>
            {data.map((d, i) => <Cell key={i} fill={d.isUp ? "#D4AF37" : "#E74C3C"} />)}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
