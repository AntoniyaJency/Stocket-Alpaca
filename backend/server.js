require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const http       = require("http");
const WebSocket  = require("ws");
const rateLimit  = require("express-rate-limit");
const Alpaca     = require("@alpacahq/alpaca-trade-api");
const OpenAI     = require("openai");
const { register, login, authMiddleware } = require("./auth");
const { computeAll } = require("./indicators");

// ── Config ──────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3002;
const IS_PAPER     = process.env.ALPACA_MODE !== "live";
const AUTO_QTY     = parseInt(process.env.AUTO_TRADE_QTY || "1");
const MAX_POS      = parseInt(process.env.AUTO_TRADE_MAX_POSITION || "5");
const AUTO_IV      = parseInt(process.env.AUTO_TRADE_INTERVAL_SECONDS || "60") * 1000;
const MIN_CONF     = parseInt(process.env.MIN_CONFIDENCE || "65");
const DAILY_LIMIT  = parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || "5") / 100;
const STRATEGY     = process.env.STRATEGY || "combined";

console.log(`\n🚀 AlgoTrade v2`);
console.log(`   Mode     : ${IS_PAPER ? "📄 PAPER" : "💰 LIVE ⚠️"}`);
console.log(`   Strategy : ${STRATEGY.toUpperCase()}`);
console.log(`   Min Conf : ${MIN_CONF}%`);
console.log(`   Port     : ${PORT}\n`);

// ── Clients ──────────────────────────────────────────────────────────────────
const alpaca = new Alpaca({
  keyId: process.env.ALPACA_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: IS_PAPER,
  feed: "iex",
  baseUrl: IS_PAPER ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── State ────────────────────────────────────────────────────────────────────
let autoEnabled       = process.env.AUTO_TRADE_ENABLED === "true";
let autoInterval      = null;
let priceCache        = {};
let signalCache       = {};
let tradeLog          = [];
let portfolioHistory  = [];   // [{ts, value}] sampled every minute
let dailyStartEquity  = null;
let autoStats         = { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0 };

const WATCHLIST = ["AAPL","TSLA","NVDA","MSFT","GOOGL","AMZN","META","NFLX"];

// ── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
app.use("/api/", rateLimit({ windowMs: 60000, max: 200 }));
const server = http.createServer(app);

// ── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });
const wsClients = new Set();

wss.on("connection", (ws) => {
  wsClients.add(ws);
  // Hydrate new client
  if (Object.keys(priceCache).length) ws.send(JSON.stringify({ type: "PRICE_SNAPSHOT", data: priceCache }));
  if (Object.keys(signalCache).length) ws.send(JSON.stringify({ type: "SIGNAL_SNAPSHOT", data: signalCache }));
  ws.send(JSON.stringify({ type: "AUTO_TRADE_STATUS", data: { enabled: autoEnabled, stats: autoStats } }));
  ws.on("close", () => wsClients.delete(ws));
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wsClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

// ── Alpaca real-time stream ──────────────────────────────────────────────────
function startAlpacaStream() {
  try {
    const stream = alpaca.data_stream_v2;
    
    stream.on('connect', () => {
      console.log("✅ Alpaca stream connected");
      stream.subscribeForQuotes(WATCHLIST);
      stream.subscribeForTrades(WATCHLIST);
    });
    
    stream.on('quote', (q) => {
      const sym = q.Symbol || q.S;
      const bid = q.BidPrice || q.bp || 0;
      const ask = q.AskPrice || q.ap || 0;
      const mid = (bid + ask) / 2;
      if (sym && mid > 0) {
        const prev = priceCache[sym]?.price || mid;
        const prevClose = priceCache[sym]?.prevClose || mid;
        priceCache[sym] = {
          ...priceCache[sym], sym,
          price: +mid.toFixed(2), bid: +bid.toFixed(2), ask: +ask.toFixed(2),
          spread: +(ask - bid).toFixed(4),
          change: +(mid - prevClose).toFixed(2),
          changePct: +(((mid - prevClose) / prevClose) * 100).toFixed(3),
          ts: Date.now(),
        };
        broadcast("QUOTE", { sym, ...priceCache[sym] });
      }
    });
    
    stream.on('error', (err) => {
      console.error("Stream error:", err);
      // Fallback to polling when stream fails
      console.log("🔄 Switching to polling fallback");
      setInterval(fetchQuotesFallback, 5000);
    });
    
    stream.on('disconnect', () => { 
      console.log("⚠️  Stream disconnected, retrying 5s..."); 
      setTimeout(startAlpacaStream, 5000); 
    });
    
    stream.connect();
  } catch (err) { 
    console.error("Stream start failed:", err.message);
    // Start polling fallback immediately
    console.log("🔄 Starting polling fallback");
    setInterval(fetchQuotesFallback, 5000);
  }
}

// ── Fallback quote fetching ───────────────────────────────────────────────────
async function fetchQuotesFallback() {
  try {
    const snaps = await alpaca.getSnapshots(WATCHLIST);
    for (const [sym, s] of Object.entries(snaps)) {
      const price = s.latestTrade?.p || s.minuteBar?.c || 0;
      if (price > 0) {
        const prevClose = s.prevDailyBar?.c || price;
        priceCache[sym] = {
          sym, price,
          bid: price * 0.999, ask: price * 1.001, // Approximate bid/ask
          spread: +(price * 0.002).toFixed(4),
          change: +(price - prevClose).toFixed(2),
          changePct: prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(3) : 0,
          volume: s.dailyBar?.v || 0,
          prevClose,
          ts: Date.now(),
        };
        broadcast("QUOTE", { sym, ...priceCache[sym] });
      }
    }
  } catch (err) {
    console.error("Fallback quotes error:", err.message);
  }
}

// ── Bar fetching ─────────────────────────────────────────────────────────────
async function fetchBars(symbol, timeframe = "1Min", limit = 100) {
  try {
    const resp = await alpaca.getBarsV2(symbol, { timeframe, limit, feed: "iex" });
    const bars = [];
    for await (const b of resp) bars.push({ t: b.Timestamp, o: b.OpenPrice, h: b.HighPrice, l: b.LowPrice, c: b.ClosePrice, v: b.Volume });
    return bars;
  } catch (err) {
    console.error(`fetchBars(${symbol}):`, err.message);
    return [];
  }
}

// ── AI Signal ────────────────────────────────────────────────────────────────
async function getAISignal(symbol, bars) {
  if (bars.length < 10) return null;
  const ind = computeAll(bars);
  const latest = ind.price;

  const prompt = `You are a professional quantitative trader managing an automated trading system.

Symbol: ${symbol} | Price: $${latest.toFixed(2)} | Strategy: ${STRATEGY}
Market session: ${isMarketHours() ? "OPEN" : "CLOSED/PRE"}

Technical Indicators:
- RSI(14): ${ind.rsi14.toFixed(1)} ${ind.rsi14 > 70 ? "[OVERBOUGHT]" : ind.rsi14 < 30 ? "[OVERSOLD]" : ""}
- MACD: ${ind.macd.toFixed(4)} | Signal: ${ind.macdSignal.toFixed(4)} | Hist: ${ind.macdHist.toFixed(4)} ${ind.macdHist > 0 ? "[BULLISH]" : "[BEARISH]"}
- SMA(5/20): $${ind.sma5?.toFixed(2)}/$${ind.sma20?.toFixed(2)} ${ind.sma5 > ind.sma20 ? "[GOLDEN]" : "[DEATH]"} cross
- EMA(9/21): $${ind.ema9?.toFixed(2)}/$${ind.ema21?.toFixed(2)}
- Bollinger: Upper $${ind.bbUpper?.toFixed(2)} | Mid $${ind.bbMid?.toFixed(2)} | Lower $${ind.bbLower?.toFixed(2)}
- BB Position: ${ind.bbPosition?.toFixed(0)}% (0=lower band, 100=upper band)
- BB Bandwidth: ${ind.bbBandwidth?.toFixed(2)}% (squeeze < 5%)
- ATR(14): $${ind.atr14?.toFixed(2)}
- Volatility: ${ind.volatility14?.toFixed(2)}%
- VWAP: $${ind.vwap?.toFixed(2)} | Price vs VWAP: ${(((latest - ind.vwap) / ind.vwap) * 100).toFixed(2)}%
- Volume ratio vs avg: ${ind.volumeRatio?.toFixed(0)}%
- Momentum (5-bar): ${ind.momentum5?.toFixed(2)}%

Strategy rules for ${STRATEGY}:
- rsi_sma: RSI + SMA crossover focus
- macd: MACD histogram direction + signal line crossover
- bollinger: BB squeeze breakouts + mean reversion
- combined: All indicators weighted together for highest accuracy

Required output — strict JSON only, no markdown:
{"signal":"BUY"|"SELL"|"HOLD","confidence":0-100,"reason":"max 12 words","target":number,"stopLoss":number,"strategy":"${STRATEGY}","indicators":{"rsi":${ind.rsi14.toFixed(1)},"macdHist":${ind.macdHist.toFixed(4)},"bbPosition":${ind.bbPosition?.toFixed(0)}}}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 250,
    });
    const text = response.choices[0].message.content.trim().replace(/```json|```/g, "");
    const result = JSON.parse(text);
    result.sym = symbol;
    result.ts = Date.now();
    signalCache[symbol] = result;
    broadcast("SIGNAL", result);
    return result;
  } catch (err) {
    console.error(`AI signal(${symbol}):`, err.message);
    return null;
  }
}

// ── Risk Management ──────────────────────────────────────────────────────────
async function checkRiskLimits() {
  try {
    const account = await alpaca.getAccount();
    const equity = parseFloat(account.equity);
    if (!dailyStartEquity) dailyStartEquity = equity;
    const dailyLoss = (dailyStartEquity - equity) / dailyStartEquity;
    if (dailyLoss >= DAILY_LIMIT) {
      console.log(`⛔ Daily loss limit hit: ${(dailyLoss * 100).toFixed(2)}% >= ${(DAILY_LIMIT * 100).toFixed(2)}%`);
      if (autoEnabled) {
        autoEnabled = false;
        clearInterval(autoInterval);
        autoInterval = null;
        broadcast("AUTO_TRADE_STATUS", { enabled: false, reason: "Daily loss limit reached", stats: autoStats });
      }
      return false;
    }
    return true;
  } catch { return true; }
}

function isMarketHours() {
  const now = new Date();
  const eastern = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).format(now);
  const [h, m] = eastern.split(":").map(Number);
  const mins = h * 60 + m;
  const day = now.getDay();
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 9:30-16:00 ET
}

// ── Auto-trade engine ────────────────────────────────────────────────────────
async function runAutoTrade() {
  if (!autoEnabled) return;
  if (!isMarketHours()) { console.log("⏸ Market closed — skipping auto-trade cycle"); return; }
  const ok = await checkRiskLimits();
  if (!ok) return;

  console.log(`\n🤖 Auto-trade [${STRATEGY.toUpperCase()}] — ${new Date().toLocaleTimeString()}`);
  broadcast("AUTO_CYCLE_START", { ts: Date.now(), strategy: STRATEGY });

  for (const sym of WATCHLIST) {
    try {
      const bars = await fetchBars(sym, "1Min", 50);
      if (!bars.length) continue;
      const signal = await getAISignal(sym, bars);
      if (!signal || signal.signal === "HOLD") { console.log(`  ${sym}: HOLD`); continue; }
      if (signal.confidence < MIN_CONF) { console.log(`  ${sym}: ${signal.signal} but conf ${signal.confidence}% < ${MIN_CONF}% min`); continue; }

      let position = null;
      try { position = await alpaca.getPosition(sym); } catch (_) {}
      const qty = position ? parseInt(position.qty) : 0;

      if (signal.signal === "BUY" && qty < MAX_POS) {
        await placeOrder(sym, AUTO_QTY, "buy", signal);
      } else if (signal.signal === "SELL" && qty > 0) {
        await placeOrder(sym, Math.min(AUTO_QTY, qty), "sell", signal);
      }
      await new Promise(r => setTimeout(r, 800));
    } catch (err) { console.error(`  ❌ ${sym}:`, err.message); }
  }

  // Sample portfolio value
  try {
    const acct = await alpaca.getAccount();
    portfolioHistory.push({ ts: Date.now(), value: parseFloat(acct.portfolio_value), equity: parseFloat(acct.equity), cash: parseFloat(acct.cash) });
    if (portfolioHistory.length > 1440) portfolioHistory = portfolioHistory.slice(-1440); // 24h at 1/min
    broadcast("PORTFOLIO_TICK", portfolioHistory[portfolioHistory.length - 1]);
  } catch (_) {}
}

async function placeOrder(sym, qty, side, signal) {
  try {
    const order = await alpaca.createOrder({ symbol: sym, qty, side, type: "market", time_in_force: "day" });
    const price = priceCache[sym]?.price || 0;
    const trade = {
      id: order.id, sym, side: side.toUpperCase(), qty, price,
      signal: signal?.signal, confidence: signal?.confidence,
      reason: signal?.reason, strategy: signal?.strategy || STRATEGY,
      status: order.status, auto: true,
      ts: Date.now(), time: new Date().toLocaleTimeString(),
      mode: IS_PAPER ? "PAPER" : "LIVE",
      target: signal?.target, stopLoss: signal?.stopLoss,
    };
    tradeLog.unshift(trade);
    if (tradeLog.length > 500) tradeLog = tradeLog.slice(0, 500);
    autoStats.totalTrades++;
    broadcast("TRADE_EXECUTED", trade);
    console.log(`  ✅ ${side.toUpperCase()} ${sym} x${qty} @ $${price} (${signal?.confidence}% conf)`);
    return order;
  } catch (err) {
    console.error(`placeOrder(${sym} ${side}):`, err.message);
    broadcast("TRADE_ERROR", { sym, side, error: err.message });
    return null;
  }
}

// ── Portfolio history sampling (independent of auto-trade) ───────────────────
setInterval(async () => {
  if (!isMarketHours()) return;
  try {
    const acct = await alpaca.getAccount();
    const tick = { ts: Date.now(), value: parseFloat(acct.portfolio_value), equity: parseFloat(acct.equity), cash: parseFloat(acct.cash) };
    portfolioHistory.push(tick);
    if (portfolioHistory.length > 1440) portfolioHistory = portfolioHistory.slice(-1440);
    broadcast("PORTFOLIO_TICK", tick);
  } catch (_) {}
}, 60000);

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post("/api/auth/register", (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: "email, password, name required" });
  try { res.json(register(email, password, name)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  try { res.json(login(email, password)); }
  catch (err) { res.status(401).json({ error: err.message }); }
});

// ── Protected API routes ──────────────────────────────────────────────────────
// Health (public)
app.get("/api/health", (req, res) => res.json({
  status: "ok", mode: IS_PAPER ? "paper" : "live",
  autoTrading: autoEnabled, strategy: STRATEGY,
  minConfidence: MIN_CONF,
  alpacaKeySet: !!(process.env.ALPACA_KEY_ID && process.env.ALPACA_KEY_ID !== "YOUR_ALPACA_KEY_ID"),
  openaiKeySet: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "YOUR_OPENAI_API_KEY"),
  watchlist: WATCHLIST, marketOpen: isMarketHours(), ts: Date.now(),
}));

app.get("/api/account", authMiddleware, async (req, res) => {
  try {
    const a = await alpaca.getAccount();
    const equity = parseFloat(a.equity);
    if (!dailyStartEquity) dailyStartEquity = equity;
    res.json({
      id: a.id, equity, cash: parseFloat(a.cash),
      buyingPower: parseFloat(a.buying_power),
      portfolioValue: parseFloat(a.portfolio_value),
      dayPnl: parseFloat(a.unrealized_pl || 0),
      dayPnlPct: parseFloat(a.unrealized_plpc || 0) * 100,
      totalPnl: equity - dailyStartEquity,
      totalPnlPct: ((equity - dailyStartEquity) / dailyStartEquity) * 100,
      status: a.status, mode: IS_PAPER ? "paper" : "live",
      dailyLossUsed: dailyStartEquity ? ((dailyStartEquity - equity) / dailyStartEquity * 100).toFixed(2) : "0",
      dailyLossLimit: DAILY_LIMIT * 100,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/positions", authMiddleware, async (req, res) => {
  try {
    const positions = await alpaca.getPositions();
    res.json(positions.map(p => ({
      sym: p.symbol, qty: parseInt(p.qty),
      avgEntry: parseFloat(p.avg_entry_price),
      currentPrice: parseFloat(p.current_price),
      marketValue: parseFloat(p.market_value),
      unrealizedPnl: parseFloat(p.unrealized_pl),
      unrealizedPnlPct: parseFloat(p.unrealized_plpc) * 100,
      side: p.side, costBasis: parseFloat(p.cost_basis),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/orders", authMiddleware, async (req, res) => {
  try {
    const orders = await alpaca.getOrders({ status: "all", limit: 100, direction: "desc" });
    res.json(orders.map(o => ({
      id: o.id, sym: o.symbol,
      side: o.side.toUpperCase(), qty: parseInt(o.qty),
      filledQty: parseInt(o.filled_qty || 0),
      filledPrice: parseFloat(o.filled_avg_price || 0),
      status: o.status, type: o.order_type,
      createdAt: o.created_at, filledAt: o.filled_at,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/bars/:symbol", authMiddleware, async (req, res) => {
  const bars = await fetchBars(req.params.symbol, req.query.timeframe || "1Min", parseInt(req.query.limit || "100"));
  res.json(bars);
});

app.get("/api/bars/:symbol/indicators", authMiddleware, async (req, res) => {
  const bars = await fetchBars(req.params.symbol, "1Min", 60);
  if (!bars.length) return res.status(404).json({ error: "No data" });
  res.json({ symbol: req.params.symbol, indicators: computeAll(bars), bars: bars.slice(-30) });
});

app.get("/api/quotes", authMiddleware, async (req, res) => {
  try {
    const syms = (req.query.symbols || WATCHLIST.join(",")).split(",");
    const snaps = await alpaca.getSnapshots(syms);
    const result = {};
    for (const [sym, s] of Object.entries(snaps)) {
      result[sym] = {
        sym, price: s.latestTrade?.p || s.minuteBar?.c || 0,
        open: s.dailyBar?.o || 0, high: s.dailyBar?.h || 0,
        low: s.dailyBar?.l || 0, close: s.dailyBar?.c || 0,
        prevClose: s.prevDailyBar?.c || 0, volume: s.dailyBar?.v || 0,
        change: (s.dailyBar?.c || 0) - (s.prevDailyBar?.c || 0),
        changePct: s.prevDailyBar?.c ? (((s.dailyBar?.c - s.prevDailyBar?.c) / s.prevDailyBar?.c) * 100) : 0,
      };
      priceCache[sym] = { ...priceCache[sym], ...result[sym] };
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/signal/:symbol", authMiddleware, async (req, res) => {
  const { symbol } = req.params;
  const bars = await fetchBars(symbol, "1Min", 50);
  if (!bars.length) return res.status(404).json({ error: "No bar data" });
  const signal = await getAISignal(symbol, bars);
  if (!signal) return res.status(500).json({ error: "AI signal failed" });
  res.json(signal);
});

app.post("/api/signal/scan-all", authMiddleware, async (req, res) => {
  const results = {};
  for (const sym of WATCHLIST) {
    try {
      const bars = await fetchBars(sym, "1Min", 50);
      if (bars.length) results[sym] = await getAISignal(sym, bars);
      await new Promise(r => setTimeout(r, 600));
    } catch (_) {}
  }
  res.json(results);
});

app.post("/api/order", authMiddleware, async (req, res) => {
  const { symbol, qty, side, type = "market", limitPrice } = req.body;
  if (!symbol || !qty || !side) return res.status(400).json({ error: "symbol, qty, side required" });
  try {
    const orderParams = { symbol, qty: parseInt(qty), side, type, time_in_force: "day" };
    if (type === "limit" && limitPrice) orderParams.limit_price = limitPrice;
    const order = await alpaca.createOrder(orderParams);
    const trade = {
      id: order.id, sym: symbol, side: side.toUpperCase(),
      qty: parseInt(qty), price: priceCache[symbol]?.price || 0,
      status: order.status, auto: false,
      ts: Date.now(), time: new Date().toLocaleTimeString(),
      mode: IS_PAPER ? "PAPER" : "LIVE",
    };
    tradeLog.unshift(trade);
    broadcast("TRADE_EXECUTED", trade);
    res.json({ success: true, order: trade });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/order/:id", authMiddleware, async (req, res) => {
  try { await alpaca.cancelOrder(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/autotrade", authMiddleware, (req, res) => {
  const { enabled } = req.body;
  autoEnabled = !!enabled;
  if (autoEnabled) {
    if (autoInterval) clearInterval(autoInterval);
    runAutoTrade();
    autoInterval = setInterval(runAutoTrade, AUTO_IV);
    console.log(`🤖 Auto-trading ENABLED — ${AUTO_IV / 1000}s interval`);
  } else {
    if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
    console.log("⏸  Auto-trading DISABLED");
  }
  broadcast("AUTO_TRADE_STATUS", { enabled: autoEnabled, stats: autoStats });
  res.json({ enabled: autoEnabled });
});

app.get("/api/trades", authMiddleware, (req, res) => res.json(tradeLog));
app.get("/api/watchlist", authMiddleware, (req, res) => res.json(WATCHLIST));
app.get("/api/signals", authMiddleware, (req, res) => res.json(signalCache));
app.get("/api/portfolio/history", authMiddleware, (req, res) => res.json(portfolioHistory));
app.get("/api/autostats", authMiddleware, (req, res) => res.json(autoStats));

app.get("/api/strategy/config", authMiddleware, (req, res) => {
  res.json({ strategy: STRATEGY, minConfidence: MIN_CONF, autoQty: AUTO_QTY, maxPosition: MAX_POS, dailyLossLimit: DAILY_LIMIT * 100 });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ Server: http://localhost:${PORT}`);
  console.log(`📡 WS:     ws://localhost:${PORT}`);
  if (process.env.ALPACA_KEY_ID && process.env.ALPACA_KEY_ID !== "YOUR_ALPACA_KEY_ID") {
    startAlpacaStream();
    // Also start fallback polling immediately for initial data
    console.log("🔄 Starting initial quote fetch");
    fetchQuotesFallback();
  } else {
    console.log("⚠️  Alpaca keys not set — configure .env");
  }
});
