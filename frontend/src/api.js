const BASE = process.env.REACT_APP_API_URL || "http://localhost:3002";

// ── Token management ────────────────────────────────────────────────────────
let _token = localStorage.getItem("algotrade_token") || "";
export const setToken = t => { _token = t; localStorage.setItem("algotrade_token", t); };
export const clearToken = () => { _token = ""; localStorage.removeItem("algotrade_token"); };
export const getToken = () => _token;

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(_token ? { Authorization: `Bearer ${_token}` } : {}) },
    ...options,
  });
  if (res.status === 401) { clearToken(); window.location.reload(); return; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  // Auth
  login: (email, password) => req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email, password, name) => req("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) }),

  // Market data
  health: () => req("/api/health"),
  account: () => req("/api/account"),
  positions: () => req("/api/positions"),
  orders: () => req("/api/orders"),
  trades: () => req("/api/trades"),
  watchlist: () => req("/api/watchlist"),
  signals: () => req("/api/signals"),
  quotes: syms => req(`/api/quotes?symbols=${syms.join(",")}`),
  bars: (sym, tf = "1Min", limit = 100) => req(`/api/bars/${sym}?timeframe=${tf}&limit=${limit}`),
  barsWithIndicators: sym => req(`/api/bars/${sym}/indicators`),

  // Trading
  scanSignal: sym => req(`/api/signal/${sym}`, { method: "POST" }),
  scanAll: () => req("/api/signal/scan-all", { method: "POST" }),
  placeOrder: (symbol, qty, side, type = "market") => req("/api/order", { method: "POST", body: JSON.stringify({ symbol, qty, side, type }) }),
  cancelOrder: id => req(`/api/order/${id}`, { method: "DELETE" }),
  setAutoTrade: enabled => req("/api/autotrade", { method: "POST", body: JSON.stringify({ enabled }) }),

  // Analytics
  portfolioHistory: () => req("/api/portfolio/history"),
  autoStats: () => req("/api/autostats"),
  strategyConfig: () => req("/api/strategy/config"),
};

export function createWebSocket(onMessage) {
  const wsUrl = BASE.replace(/^http/, "ws");
  let ws, reconnectTimer;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  
  function connect() {
    try {
      console.log(`🔌 Connecting to WebSocket (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log("✅ WS connected");
        reconnectAttempts = 0; // Reset on successful connection
      };
      
      ws.onmessage = e => { 
        try { 
          onMessage(JSON.parse(e.data)); 
        } catch (err) {
          console.log("❌ WS message parse error:", err);
        }
      };
      
      ws.onclose = (event) => {
        console.log(`🔌 WS closed (code: ${event.code}), reconnecting in 5s...`);
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          reconnectTimer = setTimeout(connect, 5000);
        } else {
          console.log("❌ Max reconnect attempts reached");
        }
      };
      
      ws.onerror = (err) => {
        console.log("❌ WS error:", err);
        ws.close();
      };
    } catch (err) {
      console.log("❌ WS connection error:", err);
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, 5000);
      }
    }
  }
  
  connect();
  return { close: () => { clearTimeout(reconnectTimer); ws?.close(); } };
}
