export default function IndicatorPanel({ indicators: ind, signal }) {
  if (!ind) return null;

  const gauge = (val, min, max, reverse = false) => {
    const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
    return reverse ? 100 - pct : pct;
  };

  const rsiColor = ind.rsi14 > 70 ? "#ff4466" : ind.rsi14 < 30 ? "#00ff88" : "#ffaa00";
  const macdColor = ind.macdHist > 0 ? "#00ff88" : "#ff4466";
  const bbColor = ind.bbPosition > 80 ? "#ff4466" : ind.bbPosition < 20 ? "#00ff88" : "#ffaa00";

  const Row = ({ label, value, color = "#c0d8c0", bar, barColor, barPct }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #0a140a" }}>
      <div style={{ width: 100, fontSize: 10, color: "#2a5a2a", flexShrink: 0 }}>{label}</div>
      <div style={{ width: 80, color, fontFamily: "monospace", fontSize: 12, flexShrink: 0 }}>{value}</div>
      {bar && (
        <div style={{ flex: 1, height: 4, background: "#0a160a", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${barPct}%`, height: "100%", background: barColor || color, borderRadius: 2, transition: "width 0.5s" }} />
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Momentum */}
      <div>
        <div style={{ fontSize: 9, color: "#2a5a2a", letterSpacing: 2, marginBottom: 8 }}>MOMENTUM</div>
        <Row label="RSI(14)" value={ind.rsi14?.toFixed(1)} color={rsiColor} bar barColor={rsiColor} barPct={ind.rsi14} />
        <Row label="MACD Hist" value={ind.macdHist?.toFixed(4)} color={macdColor} bar barColor={macdColor} barPct={gauge(ind.macdHist, -0.5, 0.5)} />
        <Row label="Momentum 5" value={(ind.momentum5 >= 0 ? "+" : "") + ind.momentum5?.toFixed(2) + "%"} color={ind.momentum5 >= 0 ? "#00ff88" : "#ff4466"} />
        <Row label="Vol Ratio" value={ind.volumeRatio?.toFixed(0) + "%"} color={ind.volumeRatio > 150 ? "#00ff88" : "#8ab88a"} bar barColor="#4488ff" barPct={Math.min(100, ind.volumeRatio / 2)} />
      </div>
      {/* Trend */}
      <div>
        <div style={{ fontSize: 9, color: "#2a5a2a", letterSpacing: 2, marginBottom: 8 }}>TREND & BANDS</div>
        <Row label="SMA5/20" value={`$${ind.sma5?.toFixed(1)} / $${ind.sma20?.toFixed(1)}`} color={ind.sma5 > ind.sma20 ? "#00ff88" : "#ff4466"} />
        <Row label="EMA9/21" value={`$${ind.ema9?.toFixed(1)} / $${ind.ema21?.toFixed(1)}`} color={ind.ema9 > ind.ema21 ? "#00ff88" : "#ff4466"} />
        <Row label="BB Position" value={ind.bbPosition?.toFixed(0) + "%"} color={bbColor} bar barColor={bbColor} barPct={ind.bbPosition} />
        <Row label="BB Width" value={ind.bbBandwidth?.toFixed(2) + "%"} color={ind.bbBandwidth < 3 ? "#ffaa00" : "#8ab88a"} />
      </div>
      {/* Price levels */}
      <div>
        <div style={{ fontSize: 9, color: "#2a5a2a", letterSpacing: 2, marginBottom: 8 }}>PRICE LEVELS</div>
        <Row label="VWAP" value={`$${ind.vwap?.toFixed(2)}`} color={ind.price > ind.vwap ? "#00ff88" : "#ff4466"} />
        <Row label="BB Upper" value={`$${ind.bbUpper?.toFixed(2)}`} color="#ff446688" />
        <Row label="BB Mid" value={`$${ind.bbMid?.toFixed(2)}`} color="#ffaa0088" />
        <Row label="BB Lower" value={`$${ind.bbLower?.toFixed(2)}`} color="#00ff8888" />
      </div>
      {/* Risk */}
      <div>
        <div style={{ fontSize: 9, color: "#2a5a2a", letterSpacing: 2, marginBottom: 8 }}>RISK METRICS</div>
        <Row label="ATR(14)" value={`$${ind.atr14?.toFixed(3)}`} color="#8ab88a" />
        <Row label="Volatility" value={ind.volatility14?.toFixed(2) + "%"} color={ind.volatility14 > 2 ? "#ff8800" : "#8ab88a"} />
        {signal?.target && <Row label="AI Target" value={`$${parseFloat(signal.target).toFixed(2)}`} color="#00ff88" />}
        {signal?.stopLoss && <Row label="Stop Loss" value={`$${parseFloat(signal.stopLoss).toFixed(2)}`} color="#ff4466" />}
      </div>
    </div>
  );
}
