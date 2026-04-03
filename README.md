# AlgoTrade — AI-Powered Stock Trading Terminal
## Alpaca Paper & Live Trading · Claude AI Signals · Real-Time WebSocket

---

## ⚡ QUICK START (5 minutes)

### 1. Get Your API Keys

**Alpaca (Free)**
1. Go to https://app.alpaca.markets → Sign up free
2. Click **Paper Trading** in the left sidebar
3. Go to **API Keys** → Generate New Key
4. Copy your `Key ID` and `Secret Key`
   - For **live trading**: switch to "Live Trading" and repeat (requires funded account)

**Anthropic (AI Signals)**
1. Go to https://console.anthropic.com
2. Create an API key under **API Keys**

---

### 2. Configure the Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```env
ALPACA_KEY_ID=PKxxxxxxxxxxxxxxxx
ALPACA_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Keep as "paper" for safe testing. Change to "live" for real money.
ALPACA_MODE=paper

ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx

# Auto-trade settings
AUTO_TRADE_ENABLED=false       # Set true to auto-start on launch
AUTO_TRADE_QTY=1               # Shares per auto-trade
AUTO_TRADE_MAX_POSITION=5      # Max shares held per stock
AUTO_TRADE_INTERVAL_SECONDS=60 # How often AI scans & trades
```

---

### 3. Start the Backend

```bash
cd backend
npm install
npm start
```

You should see:
```
🚀 AlgoTrade Backend
   Mode: 📄 PAPER TRADING
   Port: 3001
✅ Server running on http://localhost:3001
✅ Alpaca data stream connected
```

---

### 4. Start the Frontend

```bash
cd frontend
npm install
npm start
```

Open http://localhost:3000 — log in with any email/password.

---

## 🤖 HOW AUTO-TRADING WORKS

1. Toggle **AUTO-TRADE** in the top nav bar (or click the status in the right panel)
2. Every 60 seconds (configurable), the AI:
   - Fetches the latest 30 one-minute candles from Alpaca
   - Computes RSI(14), SMA(5), SMA(20), momentum, volatility
   - Sends this to Claude AI for analysis
   - If signal is **BUY**: places a market buy order via Alpaca
   - If signal is **SELL**: places a market sell order (if you hold shares)
   - If signal is **HOLD**: skips
3. Orders are **real Alpaca orders** — paper money in paper mode, real money in live mode

---

## 📊 FEATURES

| Feature | Description |
|---------|-------------|
| **Real-time prices** | Alpaca WebSocket stream (IEX feed) |
| **Candlestick charts** | 1Min / 5Min / 15Min / 1Hour / 1Day |
| **AI signals** | Claude analyzes RSI, SMA, momentum, volatility |
| **Auto-trading** | Fully automated order execution via Alpaca |
| **Portfolio tracking** | Live P&L, positions, buying power |
| **Order management** | View & cancel open orders |
| **Trade log** | Full history with AUTO/MANUAL/PAPER/LIVE tags |

---

## ⚠️  LIVE TRADING WARNING

To switch to **real money trading**:

1. Open `.env` and set `ALPACA_MODE=live`
2. Replace your API keys with your **Live** Alpaca keys
3. Restart the backend

**REAL MONEY IS AT RISK.** The AI signals are NOT financial advice. Past performance does not guarantee future results. Use at your own risk. Start with paper trading to validate the strategy.

---

## 🔧 API ENDPOINTS

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Server status & config |
| GET | /api/account | Alpaca account info |
| GET | /api/positions | Open positions |
| GET | /api/orders | Order history |
| GET | /api/bars/:sym | OHLCV bars |
| GET | /api/quotes | Latest snapshots |
| POST | /api/signal/:sym | AI scan single stock |
| POST | /api/signal/scan-all | AI scan all stocks |
| POST | /api/order | Place market order |
| DELETE | /api/order/:id | Cancel order |
| POST | /api/autotrade | Enable/disable auto-trader |
| WS | ws://localhost:3001 | Real-time price & signal stream |

---

## 🛠 TECH STACK

**Backend:** Node.js · Express · Alpaca Trade API · Anthropic SDK · WebSocket

**Frontend:** React · Recharts · Alpaca WebSocket stream

**AI:** Claude claude-sonnet-4-20250514 — RSI + SMA + momentum analysis

---

## 📁 PROJECT STRUCTURE

```
algotrade/
├── backend/
│   ├── server.js          # Express + WebSocket + auto-trader
│   ├── .env               # Your API keys (never commit this)
│   ├── .env.example       # Template
│   └── package.json
└── frontend/
    ├── public/index.html
    ├── src/
    │   ├── App.js          # Login screen
    │   ├── Dashboard.js    # Main trading UI
    │   ├── CandleChart.js  # Candlestick chart
    │   ├── Sparkline.js    # Mini sparklines
    │   ├── api.js          # Backend API client + WebSocket
    │   ├── styles.css      # Full UI styles
    │   └── index.js
    └── package.json
```
