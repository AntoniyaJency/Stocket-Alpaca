// ── Technical Indicators Library ─────────────────────────────────────────────

function sma(arr, period) {
  if (arr.length < period) return null;
  return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function ema(arr, period) {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let e = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const ag = gains / period, al = losses / period;
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function macd(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 - ema26;
  // Build macd series for signal EMA
  const macdSeries = [];
  for (let i = 25; i < closes.length; i++) {
    const e12 = ema(closes.slice(0, i + 1), 12);
    const e26 = ema(closes.slice(0, i + 1), 26);
    macdSeries.push(e12 - e26);
  }
  const signalLine = ema(macdSeries, 9) || 0;
  return { macd: macdLine, signal: signalLine, hist: macdLine - signalLine };
}

function bollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mid + stdDev * std, mid, lower: mid - stdDev * std, std, bandwidth: (stdDev * 2 * std) / mid * 100 };
}

function volatility(closes) {
  if (closes.length < 2) return 0;
  const returns = closes.slice(1).map((c, i) => ((c - closes[i]) / closes[i]) * 100);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  return Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
}

function atr(bars, period = 14) {
  if (bars.length < 2) return 0;
  const trs = bars.slice(1).map((b, i) => {
    const prev = bars[i];
    return Math.max(b.h - b.l, Math.abs(b.h - prev.c), Math.abs(b.l - prev.c));
  });
  return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
}

function vwap(bars) {
  let cumPV = 0, cumV = 0;
  for (const b of bars) {
    const tp = (b.h + b.l + b.c) / 3;
    cumPV += tp * b.v;
    cumV += b.v;
  }
  return cumV > 0 ? cumPV / cumV : 0;
}

function computeAll(bars) {
  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const volumes = bars.map(b => b.v);
  const latest = closes[closes.length - 1];
  const avgVol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;

  const bb = bollingerBands(closes);
  const m = macd(closes);

  return {
    price: latest,
    sma5: sma(closes, 5),
    sma10: sma(closes, 10),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    rsi14: rsi(closes, 14),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    bbUpper: bb?.upper,
    bbMid: bb?.mid,
    bbLower: bb?.lower,
    bbBandwidth: bb?.bandwidth,
    bbPosition: bb ? ((latest - bb.lower) / (bb.upper - bb.lower)) * 100 : 50,
    atr14: atr(bars, 14),
    volatility14: volatility(closes),
    vwap: vwap(bars),
    volumeRatio: avgVol10 > 0 ? (volumes[volumes.length - 1] / avgVol10) * 100 : 100,
    momentum: closes.length > 1 ? ((latest - closes[0]) / closes[0]) * 100 : 0,
    momentum5: closes.length >= 5 ? ((latest - closes[closes.length - 5]) / closes[closes.length - 5]) * 100 : 0,
  };
}

module.exports = { sma, ema, rsi, macd, bollingerBands, volatility, atr, vwap, computeAll };
