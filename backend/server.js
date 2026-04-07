require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const http       = require("http");
const WebSocket  = require("ws");
const rateLimit  = require("express-rate-limit");
const Alpaca     = require("@alpacahq/alpaca-trade-api");
const Groq        = require("groq-sdk");
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
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
  console.log("🔌 New WebSocket connection established");
  wsClients.add(ws);
  // Hydrate new client
  if (Object.keys(priceCache).length) {
    console.log("📊 Sending price snapshot to new client");
    ws.send(JSON.stringify({ type: "PRICE_SNAPSHOT", data: priceCache }));
  }
  if (Object.keys(signalCache).length) {
    console.log("📡 Sending signal snapshot to new client");
    ws.send(JSON.stringify({ type: "SIGNAL_SNAPSHOT", data: signalCache }));
  }
  ws.send(JSON.stringify({ type: "AUTO_TRADE_STATUS", data: { enabled: autoEnabled, stats: autoStats } }));
  ws.on("close", () => {
    console.log("🔌 WebSocket connection closed");
    wsClients.delete(ws);
  });
  ws.on("error", (err) => {
    console.log("❌ WebSocket error:", err.message);
  });
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  const activeClients = Array.from(wsClients).filter(ws => ws.readyState === WebSocket.OPEN);
  console.log(`📡 Broadcasting ${type} to ${activeClients.length} clients:`, data.sym || 'all');
  
  activeClients.forEach(ws => {
    try {
      ws.send(msg);
    } catch (err) {
      console.log(`❌ Failed to send to client:`, err.message);
      // Remove problematic client
      wsClients.delete(ws);
    }
  });
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
    console.log('Fetching quotes for:', WATCHLIST);
    for (const sym of WATCHLIST) {
      try {
        // Get individual snapshot for each symbol
        const snapshot = await alpaca.getSnapshot(sym);
        
        // Use correct field names from the actual data structure
        let price = 0, bid = 0, ask = 0, prevClose = 0;
        
        // Method 1: Use latest trade if available
        if (snapshot.LatestTrade && snapshot.LatestTrade.Price) {
          price = snapshot.LatestTrade.Price;
          console.log(`Using LatestTrade for ${sym}: ${price}`);
        }
        
        // Method 2: Use latest quote bid/ask
        if (snapshot.LatestQuote) {
          bid = snapshot.LatestQuote.BidPrice || 0;
          ask = snapshot.LatestQuote.AskPrice || 0;
          if (price === 0 && bid > 0 && ask > 0) {
            price = (bid + ask) / 2;
            console.log(`Using LatestQuote for ${sym}: ${price} (bid: ${bid}, ask: ${ask})`);
          }
        }
        
        // Method 3: Use daily bar close
        if (snapshot.DailyBar && snapshot.DailyBar.ClosePrice) {
          prevClose = snapshot.DailyBar.ClosePrice;
          if (price === 0) price = prevClose;
          console.log(`Using DailyBar for ${sym}: ${price}`);
        }
        
        // Method 4: Use previous daily bar for comparison
        if (snapshot.PrevDailyBar && snapshot.PrevDailyBar.ClosePrice && prevClose === 0) {
          prevClose = snapshot.PrevDailyBar.ClosePrice;
          console.log(`Using PrevDailyBar for ${sym}: ${prevClose}`);
        }
        
        // Update cache if we got valid data
        if (sym && price > 0) {
          const change = prevClose > 0 ? price - prevClose : 0;
          const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
          
          priceCache[sym] = {
            ...priceCache[sym], sym,
            price: +price.toFixed(2), 
            bid: +bid.toFixed(2), 
            ask: +ask.toFixed(2),
            spread: bid > 0 && ask > 0 ? +(ask - bid).toFixed(4) : 0,
            change: +change.toFixed(2),
            changePct: +changePct.toFixed(3),
            open: prevClose || price, // Use prev close as open for now
            high: price, // Current price as high for now
            low: price,  // Current price as low for now
            close: price,
            prevClose: prevClose || price,
            volume: 0, // Will be updated when we get volume data
            ts: Date.now(),
          };
          
          console.log(`✅ Updated ${sym}: $${price} (${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%)`);
          broadcast("QUOTE", priceCache[sym]);
        } else {
          console.log(`❌ No valid data for ${sym} - price: ${price}, bid: ${bid}, ask: ${ask}`);
        }
        
      } catch (symErr) {
        console.error(`Error fetching ${sym}:`, symErr.message);
      }
    }
    
    // Log current cache status for debugging
    console.log(`📊 Current price cache has ${Object.keys(priceCache).length} symbols`);
    console.log(`🔌 Active WebSocket clients: ${Array.from(wsClients).filter(ws => ws.readyState === WebSocket.OPEN).length}`);
    
  } catch (err) {
    console.error("Fallback quotes error:", err.message);
  }
}

// ── Bar fetching ─────────────────────────────────────────────────────────────
async function fetchBars(symbol, timeframe = "1Min", limit = 100) {
  try {
    console.log(`Fetching real bars for ${symbol}, timeframe: ${timeframe}, limit: ${limit}`);
    
    // Map timeframes to data sources
    const isDaily = timeframe === "1Day";
    const isHourly = timeframe === "1Hour";
    const isIntraday = ["1Min", "5Min", "15Min"].includes(timeframe);
    
    // Try Alpha Vantage for free real data (daily only)
    if (isDaily) {
      try {
        console.log(`Trying Alpha Vantage for ${symbol} - Daily data`);
        const alphaVantageUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=demo`;
        const response = await fetch(alphaVantageUrl);
        const data = await response.json();
        
        if (data['Time Series (Daily)']) {
          const bars = [];
          const timeSeries = data['Time Series (Daily)'];
          const dates = Object.keys(timeSeries).slice(0, limit).reverse();
          
          for (const date of dates) {
            const day = timeSeries[date];
            const o = parseFloat(day['1. open']);
            const h = parseFloat(day['2. high']);
            const l = parseFloat(day['3. low']);
            const c = parseFloat(day['4. close']);
            const v = parseInt(day['5. volume']);
            
            // Validate data
            if (!isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c) && h >= l && h >= o && h >= c && l <= o && l <= c) {
              bars.push({
                t: new Date(date).getTime(),
                o, h, l, c, v
              });
            }
          }
          
          console.log(`✅ Alpha Vantage got ${bars.length} REAL daily bars for ${symbol}`);
          return bars;
        }
      } catch (alphaErr) {
        console.log(`Alpha Vantage failed:`, alphaErr.message);
      }
    }
    
    // Try Yahoo Finance as backup (supports multiple timeframes)
    try {
      console.log(`Trying Yahoo Finance for ${symbol} - ${timeframe}`);
      let yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
      
      // Map timeframes to Yahoo intervals
      const intervalMap = {
        "1Min": "1m",
        "5Min": "5m", 
        "15Min": "15m",
        "1Hour": "1h",
        "1Day": "1d"
      };
      
      const interval = intervalMap[timeframe] || "1d";
      const range = isDaily ? "2y" : "5d"; // Longer range for daily, shorter for intraday
      
      yahooUrl += `?interval=${interval}&range=${range}`;
      
      const response = await fetch(yahooUrl);
      const data = await response.json();
      
      if (data.chart.result && data.chart.result[0]) {
        const result = data.chart.result[0];
        const bars = [];
        
        for (let i = 0; i < Math.min(result.timestamp.length, limit); i++) {
          const o = result.indicators.quote[0].open[i];
          const h = result.indicators.quote[0].high[i];
          const l = result.indicators.quote[0].low[i];
          const c = result.indicators.quote[0].close[i];
          const v = result.indicators.quote[0].volume[i];
          
          // Validate data
          if (!isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c) && h >= l && h >= o && h >= c && l <= o && l <= c) {
            bars.push({
              t: result.timestamp[i] * 1000,
              o, h, l, c, v
            });
          }
        }
        
        console.log(`✅ Yahoo Finance got ${bars.length} REAL ${timeframe} bars for ${symbol}`);
        return bars;
      }
    } catch (yahooErr) {
      console.log(`Yahoo Finance failed:`, yahooErr.message);
    }
    
    // Try Alpaca with different feeds
    let bars = [];
    
    // Method 1: Try with IEX feed
    try {
      const resp = await alpaca.getBarsV2(symbol, { 
        timeframe: "1Day", 
        limit: Math.min(limit, 30),
        feed: "iex"
      });
      
      for await (const b of resp) {
        bars.push({ 
          t: new Date(b.Timestamp).getTime(), 
          o: b.OpenPrice || b.Open, 
          h: b.HighPrice || b.High, 
          l: b.LowPrice || b.Low, 
          c: b.ClosePrice || b.Close, 
          v: b.Volume || b.volume 
        });
      }
      
      console.log(`✅ Alpaca IEX got ${bars.length} REAL bars for ${symbol}`);
    } catch (err) {
      console.log(`Alpaca IEX failed:`, err.message);
    }
    
    if (bars.length > 0) return bars;
    
    // Last resort: mock data
    console.log(`❌ No real data available, using mock data for ${symbol}`);
    const now = Date.now();
    const basePrice = priceCache[symbol]?.price || 100;
    
    for (let i = limit - 1; i >= 0; i--) {
      const time = now - (i * 24 * 60 * 60 * 1000); // Daily
      const variance = basePrice * 0.02;
      const open = basePrice + (Math.random() - 0.5) * variance;
      const close = open + (Math.random() - 0.5) * variance;
      const high = Math.max(open, close) + Math.random() * variance * 0.5;
      const low = Math.min(open, close) - Math.random() * variance * 0.5;
      
      bars.push({
        t: time,
        o: +open.toFixed(2),
        h: +high.toFixed(2),
        l: +low.toFixed(2),
        c: +close.toFixed(2),
        v: Math.floor(Math.random() * 100000) + 10000
      });
    }
    
    console.log(`Created ${bars.length} mock bars for ${symbol}`);
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
    // Use Groq for faster, cheaper trading signals
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
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

// ── Sync existing trades from Alpaca ───────────────────────────────────────────
async function syncExistingTrades() {
  try {
    console.log("🔄 Syncing existing trades from Alpaca...");
    const orders = await alpaca.getOrders({ status: 'all', limit: 100, direction: 'desc' });
    
    for (const order of orders) {
      // Check if trade already exists in log
      const exists = tradeLog.find(t => t.id === order.id);
      if (exists) continue;
      
      // Only add filled orders
      if (order.status === 'filled' && order.filled_qty > 0) {
        // Try to detect if this was an AI trade by checking order patterns
        // AI trades typically have specific characteristics:
        // - Quantity of 1 (AUTO_TRADE_QTY)
        // - Market orders
        // - Recent trades during auto-trading hours
        
        const isLikelyAITrade = 
          parseInt(order.filled_qty) === AUTO_QTY && 
          order.order_type === 'market' &&
          order.submitted_at && 
          (Date.now() - new Date(order.submitted_at).getTime()) < 24 * 60 * 60 * 1000; // Last 24h
        
        const trade = {
          id: order.id,
          sym: order.symbol,
          side: order.side.toUpperCase(),
          qty: parseInt(order.filled_qty),
          price: parseFloat(order.filled_avg_price || 0),
          status: order.status,
          auto: isLikelyAITrade, // Smart detection of AI trades
          ts: new Date(order.filled_at || order.created_at).getTime(),
          time: new Date(order.filled_at || order.created_at).toLocaleTimeString(),
          mode: IS_PAPER ? "PAPER" : "LIVE",
        };
        tradeLog.unshift(trade);
        console.log(`📥 Synced existing trade: ${trade.side} ${trade.sym} x${trade.qty} @ $${trade.price} ${trade.auto ? '(🤖 AI)' : '(MANUAL)'}`);
      }
    }
    
    if (tradeLog.length > 500) tradeLog = tradeLog.slice(0, 500);
    console.log(`✅ Synced ${tradeLog.length} total trades`);
  } catch (err) {
    console.log("❌ Trade sync failed:", err.message);
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
  console.log(`\n🤖 Auto-trade cycle started at ${new Date().toLocaleTimeString()}`);
  
  if (!autoEnabled) { 
    console.log("⏸ Auto-trading disabled — skipping cycle"); 
    return; 
  }
  
  if (!isMarketHours()) { 
    console.log("⏸ Market closed — skipping auto-trade cycle"); 
    return; 
  }
  
  const ok = await checkRiskLimits();
  if (!ok) {
    console.log("⛔ Risk limits breached — skipping auto-trade cycle");
    return;
  }

  console.log(`🤖 Auto-trade [${STRATEGY.toUpperCase()}] — ${new Date().toLocaleTimeString()}`);
  broadcast("AUTO_CYCLE_START", { ts: Date.now(), strategy: STRATEGY });

  for (const sym of WATCHLIST) {
    try {
      console.log(`  📊 Processing ${sym}...`);
      const bars = await fetchBars(sym, "1Min", 50);
      if (!bars.length) {
        console.log(`  ❌ ${sym}: No bar data available`);
        continue;
      }
      
      console.log(`  ✅ ${sym}: Got ${bars.length} bars`);
      const signal = await getAISignal(sym, bars);
      if (!signal) {
        console.log(`  ❌ ${sym}: AI signal failed`);
        continue;
      }
      
      console.log(`  📡 ${sym}: ${signal.signal} (${signal.confidence}% confidence)`);
      
      if (signal.signal === "HOLD") { 
        console.log(`  ⏸ ${sym}: HOLD signal`); 
        continue; 
      }
      
      if (signal.confidence < MIN_CONF) { 
        console.log(`  ❌ ${sym}: ${signal.signal} but conf ${signal.confidence}% < ${MIN_CONF}% min`); 
        continue;
      }

      let position = null;
      try { 
        position = await alpaca.getPosition(sym); 
        console.log(`  📈 ${sym}: Current position: ${position.qty} shares`);
      } catch (_) { 
        console.log(`  📈 ${sym}: No current position`);
      }
      const qty = position ? parseInt(position.qty) : 0;

      if (signal.signal === "BUY" && qty < MAX_POS) {
        console.log(`  💰 ${sym}: Placing BUY order for ${AUTO_QTY} shares`);
        await placeOrder(sym, AUTO_QTY, "buy", signal);
      } else if (signal.signal === "SELL" && qty > 0) {
        console.log(`  💰 ${sym}: Placing SELL order for ${Math.min(AUTO_QTY, qty)} shares`);
        await placeOrder(sym, Math.min(AUTO_QTY, qty), "sell", signal);
      } else {
        console.log(`  ⏸ ${sym}: No action needed (signal: ${signal.signal}, position: ${qty})`);
      }
      
      await new Promise(r => setTimeout(r, 800));
    } catch (err) { 
      console.error(`  ❌ ${sym}:`, err.message); 
    }
  }

  // Sample portfolio value
  try {
    const acct = await alpaca.getAccount();
    portfolioHistory.push({ ts: Date.now(), value: parseFloat(acct.portfolio_value), equity: parseFloat(acct.equity), cash: parseFloat(acct.cash) });
    if (portfolioHistory.length > 1440) portfolioHistory = portfolioHistory.slice(-1440); // 24h at 1/min
    broadcast("PORTFOLIO_TICK", portfolioHistory[portfolioHistory.length - 1]);
    console.log(`  💰 Portfolio updated: $${parseFloat(acct.portfolio_value).toFixed(2)}`);
  } catch (err) {
    console.error(`  ❌ Portfolio update failed:`, err.message);
  }
  
  console.log(`✅ Auto-trade cycle completed at ${new Date().toLocaleTimeString()}\n`);
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
app.get("/api/health", (req, res) => {
  const now = new Date();
  const istTime = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const estTime = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const marketOpen = isMarketHours();
  
  res.json({
    status: "ok", 
    mode: IS_PAPER ? "paper" : "live",
    autoTrading: autoEnabled, 
    strategy: STRATEGY,
    minConfidence: MIN_CONF,
    alpacaKeySet: !!(process.env.ALPACA_KEY_ID && process.env.ALPACA_KEY_ID !== "YOUR_ALPACA_KEY_ID"),
    groqKeySet: !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "YOUR_GROQ_API_KEY"),
    watchlist: WATCHLIST, 
    marketOpen: marketOpen,
    currentTime: {
      ist: istTime,
      est: estTime,
      timestamp: now.getTime()
    },
    nextSession: marketOpen ? null : {
      opensAt: "9:30 AM EST (7:00 PM IST)",
      closesAt: "4:00 PM EST (1:30 AM IST)"
    },
    ts: Date.now(),
  });
});

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
    const result = {};
    
    // Use cached data instead of fetching fresh snapshots
    for (let i = 0; i < syms.length; i++) {
      const sym = syms[i];
      const cached = priceCache[sym];
      
      if (cached) {
        result[sym] = {  // Use symbol as key, not index
          sym: cached.sym,
          price: cached.price,
          open: cached.open || 0,
          high: cached.high || 0,
          low: cached.low || 0,
          close: cached.price,
          prevClose: cached.prevClose || 0,
          volume: cached.volume || 0,
          change: cached.change || 0,
          changePct: cached.changePct || 0,
        };
      } else {
        result[sym] = {  // Use symbol as key, not index
          sym: sym,
          price: 0,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          prevClose: 0,
          volume: 0,
          change: 0,
          changePct: 0,
        };
      }
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
    // Sync existing trades
    setTimeout(syncExistingTrades, 2000);
  } else {
    console.log("⚠️  Alpaca keys not set — configure .env");
  }
  
  // Start auto-trading if enabled
  if (autoEnabled) {
    console.log("🤖 Auto-trading enabled at startup — starting interval");
    runAutoTrade();
    autoInterval = setInterval(runAutoTrade, AUTO_IV);
    console.log(`🤖 Auto-trading ENABLED — ${AUTO_IV / 1000}s interval`);
  } else {
    console.log("⏸ Auto-trading disabled — enable via UI or set AUTO_TRADE_ENABLED=true");
  }
});
