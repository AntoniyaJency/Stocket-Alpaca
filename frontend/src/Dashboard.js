import { useState, useEffect, useRef, useCallback } from "react";
import { api, createWebSocket } from "./api";
import CandleChart from "./CandleChart";
import Sparkline from "./Sparkline";
import PortfolioChart from "./PortfolioChart";
import IndicatorPanel from "./IndicatorPanel";

const TABS = ["CHART", "INDICATORS", "PORTFOLIO", "ORDERS", "TRADES", "ANALYTICS"];

export default function Dashboard({ user, onLogout }) {
  const [health, setHealth]               = useState(null);
  const [account, setAccount]             = useState(null);
  const [positions, setPositions]         = useState([]);
  const [orders, setOrders]               = useState([]);
  const [trades, setTrades]               = useState([]);
  const [quotes, setQuotes]               = useState({});
  const [bars, setBars]                   = useState([]);
  const [indicators, setIndicators]       = useState(null);
  const [signals, setSignals]             = useState({});
  const [watchlist, setWatchlist]         = useState(["AAPL","TSLA","NVDA","MSFT","GOOGL","AMZN","META","NFLX"]);
  const [portfolioHistory, setPortfolioHistory] = useState([]);
  const [strategyConfig, setStrategyConfig]     = useState(null);
  const [autoStats, setAutoStats]         = useState({ totalTrades: 0, wins: 0, losses: 0 });
  const [selected, setSelected]           = useState("AAPL");
  const [tab, setTab]                     = useState("CHART");
  const [autoTrading, setAutoTrading]     = useState(false);
  const [notification, setNotification]   = useState(null);
  const [scanLoading, setScanLoading]     = useState(false);
  const [scanning, setScanning]           = useState({});
  const [orderQty, setOrderQty]           = useState(1);
  const [tf, setTf]                       = useState("1Min");
  const [backendOk, setBackendOk]         = useState(null);
  const [marketOpen, setMarketOpen]       = useState(false);
  const [cycleFlash, setCycleFlash]       = useState(false);
  const priceHistory = useRef({});
  const startEquity  = useRef(null);

  const notify = useCallback((msg, type = "info") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4500);
  }, []);

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const h = await api.health();
        setHealth(h);
        setBackendOk(true);
        setMarketOpen(h.marketOpen);
        if (h.autoTrading) setAutoTrading(true);

        const results = await Promise.allSettled([
          api.account(), api.positions(), api.orders(), api.trades(),
          api.watchlist(), api.signals(), api.portfolioHistory(), api.strategyConfig(), api.autoStats(),
        ]);
        const [acct, pos, ord, tr, wl, sigs, ph, sc, as] = results;
        if (acct.status === "fulfilled") { setAccount(acct.value); startEquity.current = acct.value.portfolioValue; }
        if (pos.status === "fulfilled")  setPositions(pos.value);
        if (ord.status === "fulfilled")  setOrders(ord.value);
        if (tr.status === "fulfilled")   setTrades(tr.value);
        if (wl.status === "fulfilled")   setWatchlist(wl.value);
        if (sigs.status === "fulfilled") setSignals(sigs.value);
        if (ph.status === "fulfilled")   setPortfolioHistory(ph.value);
        if (sc.status === "fulfilled")   setStrategyConfig(sc.value);
        if (as.status === "fulfilled")   setAutoStats(as.value);

        const wlSyms = wl.status === "fulfilled" ? wl.value : watchlist;
        try {
          const q = await api.quotes(wlSyms);
          setQuotes(q);
          wlSyms.forEach(sym => {
            priceHistory.current[sym] = priceHistory.current[sym] || [];
            if (q[sym]?.price) priceHistory.current[sym].push(q[sym].price);
          });
        } catch (_) {}
      } catch (err) {
        setBackendOk(false);
        console.error("Init:", err.message);
      }
    }
    init();
  }, []);

  // ── WebSocket ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (backendOk !== true) return;
    const ws = createWebSocket(msg => {
      switch (msg.type) {
        case "QUOTE":
          setQuotes(prev => ({ ...prev, [msg.data.sym]: { ...prev[msg.data.sym], ...msg.data } }));
          priceHistory.current[msg.data.sym] = [...(priceHistory.current[msg.data.sym] || []).slice(-59), msg.data.price];
          break;
        case "PRICE_SNAPSHOT": setQuotes(prev => ({ ...prev, ...msg.data })); break;
        case "SIGNAL": setSignals(prev => ({ ...prev, [msg.data.sym]: msg.data })); break;
        case "SIGNAL_SNAPSHOT": setSignals(prev => ({ ...prev, ...msg.data })); break;
        case "TRADE_EXECUTED":
          setTrades(prev => [msg.data, ...prev].slice(0, 500));
          notify(`${msg.data.auto ? "🤖 AUTO" : "✅"}: ${msg.data.side} ${msg.data.sym} x${msg.data.qty} @ $${(msg.data.price||0).toFixed(2)} [${msg.data.mode}]${msg.data.confidence ? ` (${msg.data.confidence}%)` : ""}`, msg.data.side === "BUY" ? "buy" : "sell");
          api.positions().then(setPositions).catch(()=>{});
          api.account().then(a => { setAccount(a); if (!startEquity.current) startEquity.current = a.portfolioValue; }).catch(()=>{});
          break;
        case "TRADE_ERROR": notify("❌ Order failed: " + msg.data.error, "error"); break;
        case "AUTO_TRADE_STATUS": setAutoTrading(msg.data.enabled); if (msg.data.stats) setAutoStats(msg.data.stats); break;
        case "PORTFOLIO_TICK": setPortfolioHistory(prev => [...prev, msg.data].slice(-1440)); break;
        case "AUTO_CYCLE_START": setCycleFlash(true); setTimeout(() => setCycleFlash(false), 800); break;
        default: break;
      }
    });
    return () => ws.close();
  }, [backendOk, notify]);

  // ── Poll account every 30s ───────────────────────────────────────────────
  useEffect(() => {
    if (backendOk !== true) return;
    const iv = setInterval(() => {
      api.account().then(a => setAccount(a)).catch(()=>{});
      api.positions().then(setPositions).catch(()=>{});
    }, 30000);
    return () => clearInterval(iv);
  }, [backendOk]);

  // ── Bars + indicators when stock/tf changes ──────────────────────────────
  useEffect(() => {
    if (backendOk !== true) return;
    api.bars(selected, tf, 100).then(setBars).catch(()=>setBars([]));
    if (tab === "INDICATORS") {
      api.barsWithIndicators(selected).then(r => setIndicators(r.indicators)).catch(()=>{});
    }
  }, [selected, tf, backendOk]);

  // Load indicators when tab switches to INDICATORS
  useEffect(() => {
    if (tab === "INDICATORS" && backendOk) {
      api.barsWithIndicators(selected).then(r => setIndicators(r.indicators)).catch(()=>{});
    }
  }, [tab]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const toggleAutoTrade = async () => {
    try {
      const res = await api.setAutoTrade(!autoTrading);
      setAutoTrading(res.enabled);
      notify(res.enabled ? "🤖 Auto-trading ENABLED — AI is live" : "⏸ Auto-trading DISABLED", res.enabled ? "buy" : "info");
    } catch (err) { notify("Toggle failed: " + err.message, "error"); }
  };

  const scanOne = async sym => {
    setScanning(p => ({ ...p, [sym]: true }));
    try {
      const sig = await api.scanSignal(sym);
      setSignals(p => ({ ...p, [sym]: { ...sig, sym } }));
      notify(`${sym}: ${sig.signal} — ${sig.confidence}% confidence`, sig.signal === "BUY" ? "buy" : sig.signal === "SELL" ? "sell" : "info");
    } catch (err) { notify("Scan failed: " + err.message, "error"); }
    setScanning(p => ({ ...p, [sym]: false }));
  };

  const scanAll = async () => {
    setScanLoading(true);
    try {
      const res = await api.scanAll();
      setSignals(prev => ({ ...prev, ...res }));
      notify("All stocks scanned", "buy");
    } catch (err) { notify("Scan failed: " + err.message, "error"); }
    setScanLoading(false);
  };

  const placeOrder = async (sym, side) => {
    try {
      await api.placeOrder(sym, orderQty, side.toLowerCase());
      notify(`${side} ${sym} x${orderQty} submitted`, side === "BUY" ? "buy" : "sell");
    } catch (err) { notify("Order failed: " + err.message, "error"); }
  };

  const cancelOrder = async id => {
    try { await api.cancelOrder(id); notify("Order cancelled", "info"); api.orders().then(setOrders).catch(()=>{}); }
    catch (err) { notify("Cancel failed: " + err.message, "error"); }
  };

  // ── Derived values ───────────────────────────────────────────────────────
  const sel     = quotes[selected] || {};
  const selSig  = signals[selected];
  const pos     = positions.find(p => p.sym === selected);
  const portVal = account?.portfolioValue || 0;
  const cash    = account?.cash || 0;
  const dayPnl  = account?.dayPnl || 0;
  const bp      = account?.buyingPower || 0;
  const mode    = health?.mode || "paper";
  const totalPnl = startEquity.current ? portVal - startEquity.current : 0;
  const winRate  = autoStats.totalTrades > 0 ? ((autoStats.wins / autoStats.totalTrades) * 100).toFixed(0) : "—";

  return (
    <div className="dashboard">
      {notification && <div className={"notif notif-" + notification.type}>{notification.msg}</div>}
      {backendOk === false && <div className="backend-warn">⚠️ Backend unreachable at localhost:3001 — run: cd backend && npm start</div>}

      {/* ── TOPNAV ── */}
      <nav className="topnav">
        <div className="nav-logo-container">
          <img src="/logo.png" alt="Stocket Logo" className="nav-logo-img" />
          <div className="nav-logo-text">STOCKET</div>
        </div>
        <div className="nav-divider" />
        <div className={"nav-live " + (marketOpen ? "market-open" : "market-closed")}>
          <span className={"live-dot" + (marketOpen ? "" : " dot-red")} />
          <span>{marketOpen ? (mode === "live" ? "⚡ LIVE" : "📄 PAPER") : "MARKET CLOSED"}</span>
        </div>
        {account && <>
          <div className="nav-divider" />
          <div className="nav-stat"><span className="nav-stat-label">EQUITY</span><span className="nav-stat-val">${portVal.toLocaleString("en",{maximumFractionDigits:2})}</span></div>
          <div className="nav-stat"><span className="nav-stat-label">CASH</span><span className="nav-stat-val">${cash.toLocaleString("en",{maximumFractionDigits:2})}</span></div>
          <div className="nav-stat"><span className="nav-stat-label">DAY P&L</span><span className={"nav-stat-val "+(dayPnl>=0?"green":"red")}>{dayPnl>=0?"+":""}${dayPnl.toFixed(2)}</span></div>
          {strategyConfig && <div className="nav-stat"><span className="nav-stat-label">STRATEGY</span><span className="nav-stat-val" style={{color:"#ffaa00"}}>{strategyConfig.strategy.toUpperCase()}</span></div>}
        </>}
        <div style={{flex:1}} />
        <div className={"autotrade-toggle" + (cycleFlash ? " cycle-flash" : "")} onClick={toggleAutoTrade}>
          <span className={"toggle-label"+(autoTrading?" active":"")}>{autoTrading ? "🤖 AUTO ON" : "AUTO-TRADE"}</span>
          <div className={"toggle-switch"+(autoTrading?" on":"")}>
            <div className="toggle-thumb" />
          </div>
        </div>
        <div className="nav-divider" />
        <span className="nav-user">{user.name.toUpperCase()}</span>
        <button className="nav-logout" onClick={onLogout}>LOGOUT</button>
      </nav>

      <div className="main-layout">
        {/* ── LEFT SIDEBAR ── */}
        <aside className="sidebar-left">
          <div className="sidebar-title">WATCHLIST</div>
          {watchlist.map(sym => {
            const q = quotes[sym] || {};
            const sig = signals[sym];
            const hist = priceHistory.current[sym] || [];
            const up = (q.changePct || 0) >= 0;
            return (
              <div key={sym} className={"watchlist-item "+(selected===sym?"active":"")} onClick={() => setSelected(sym)}>
                <div className="wi-top"><span className="wi-sym">{sym}</span>{sig&&<span className={"sig-badge sig-"+sig.signal?.toLowerCase()}>{sig.signal}</span>}</div>
                <div className="wi-price">{q.price?"$"+q.price.toFixed(2):"—"}</div>
                <div className="wi-bottom">
                  <span className={up?"green":"red"}>{up?"▲":"▼"} {Math.abs(q.changePct||0).toFixed(2)}%</span>
                  <Sparkline data={hist.slice(-20)} color={up?"#00ff88":"#ff4466"} width={52} height={22} />
                </div>
              </div>
            );
          })}
        </aside>

        {/* ── MAIN ── */}
        <main className="main-content">
          {/* Stock header */}
          <div className="stock-header">
            <div className="sh-info">
              <div className="sh-sym">{selected}</div>
              <div className="sh-name">{sel.price?"$"+sel.price.toFixed(2):"Loading..."}</div>
              {sel.changePct!==undefined&&<div className={"sh-change "+(sel.changePct>=0?"green":"red")}>{sel.changePct>=0?"▲":"▼"} {Math.abs(sel.change||0).toFixed(2)} ({Math.abs(sel.changePct||0).toFixed(2)}%)</div>}
              {sel.bid&&<div className="sh-spread">Bid ${sel.bid} · Ask ${sel.ask} · Spread ${sel.spread}</div>}
              {pos&&<div className="sh-pos">Position: {pos.qty} shares · P&L: <span className={pos.unrealizedPnl>=0?" green":" red"}>{pos.unrealizedPnl>=0?"+":""}${pos.unrealizedPnl.toFixed(2)} ({pos.unrealizedPnlPct.toFixed(2)}%)</span></div>}
            </div>
            <div style={{flex:1}}/>
            <div className="sh-signal">
              {scanning[selected]?<span className="scanning-text">AI ANALYZING...</span>:selSig?(
                <div className="signal-box">
                  <span className={"sig-badge sig-"+selSig.signal?.toLowerCase()+" sig-lg"}>{selSig.signal==="BUY"?"▲ BUY":selSig.signal==="SELL"?"▼ SELL":"◆ HOLD"}</span>
                  <span className="sig-conf">{selSig.confidence}% · {selSig.strategy||"AI"}</span>
                </div>
              ):null}
              <button className="btn-scan" onClick={()=>scanOne(selected)} disabled={scanning[selected]}>AI SCAN</button>
            </div>
            <div className="sh-order">
              <input type="number" className="qty-input" value={orderQty} min={1} onChange={e=>setOrderQty(Math.max(1,parseInt(e.target.value)||1))}/>
              <button className="btn-buy" onClick={()=>placeOrder(selected,"BUY")}>BUY</button>
              <button className="btn-sell" onClick={()=>placeOrder(selected,"SELL")}>SELL</button>
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs">
            {TABS.map(t=><button key={t} className={"tab-btn"+(tab===t?" active":"")} onClick={()=>setTab(t)}>{t}</button>)}
            <div style={{flex:1}}/>
            {autoTrading&&<div className={"auto-active-badge"+(cycleFlash?" flash":"")}><span className="live-dot"/> AUTO-TRADING{!marketOpen?" (WAITING FOR MARKET)":""}</div>}
          </div>

          {/* ── CHART TAB ── */}
          {tab==="CHART"&&(
            <div className="tab-content">
              <div className="chart-controls">
                {["1Min","5Min","15Min","1Hour","1Day"].map(t=><button key={t} className={"tf-btn"+(tf===t?" active":"")} onClick={()=>setTf(t)}>{t}</button>)}
                <button className="btn-secondary ml-auto" onClick={scanAll} disabled={scanLoading}>{scanLoading?"SCANNING...":"⚡ SCAN ALL"}</button>
              </div>
              <div className="chart-wrapper"><CandleChart bars={bars}/></div>
              {selSig&&(
                <div className="signal-detail">
                  <div className="sd-grid">
                    <div className="sd-item"><div className="sd-label">SIGNAL</div><span className={"sig-badge sig-"+selSig.signal?.toLowerCase()+" sig-lg"}>{selSig.signal}</span></div>
                    <div className="sd-item"><div className="sd-label">CONFIDENCE</div><div className="sd-val">{selSig.confidence}%</div><div className="conf-bar"><div className="conf-fill" style={{width:selSig.confidence+"%"}}/></div></div>
                    {selSig.indicators?.rsi&&<div className="sd-item"><div className="sd-label">RSI(14)</div><div className={"sd-val "+(selSig.indicators.rsi>70?"red":selSig.indicators.rsi<30?"green":"")}>{parseFloat(selSig.indicators.rsi).toFixed(1)}</div></div>}
                    {selSig.indicators?.macdHist&&<div className="sd-item"><div className="sd-label">MACD HIST</div><div className={"sd-val "+(selSig.indicators.macdHist>0?"green":"red")}>{parseFloat(selSig.indicators.macdHist).toFixed(4)}</div></div>}
                    {selSig.target&&<div className="sd-item"><div className="sd-label">TARGET</div><div className="sd-val green">${parseFloat(selSig.target).toFixed(2)}</div></div>}
                    {selSig.stopLoss&&<div className="sd-item"><div className="sd-label">STOP LOSS</div><div className="sd-val red">${parseFloat(selSig.stopLoss).toFixed(2)}</div></div>}
                    <div className="sd-item sd-reason"><div className="sd-label">AI REASONING</div><div className="sd-text">{selSig.reason}</div></div>
                  </div>
                </div>
              )}
              <div className="section-title">MARKET OVERVIEW</div>
              <div className="market-grid">
                {watchlist.map(sym=>{
                  const q=quotes[sym]||{},sig=signals[sym],up=(q.changePct||0)>=0,hist=priceHistory.current[sym]||[];
                  return(<div key={sym} className={"market-card"+(selected===sym?" active":"")} onClick={()=>setSelected(sym)}>
                    <div className="mc-top"><span className="mc-sym">{sym}</span>{sig&&<span className={"sig-badge sig-"+sig.signal?.toLowerCase()}>{sig.signal}</span>}</div>
                    <div className="mc-price">{q.price?"$"+q.price.toFixed(2):"—"}</div>
                    <div className="mc-bottom"><span className={up?"green":"red"}>{up?"▲":"▼"} {Math.abs(q.changePct||0).toFixed(2)}%</span><Sparkline data={hist.slice(-20)} color={up?"#00ff88":"#ff4466"} width={64} height={26}/></div>
                    {sig?.confidence&&<div className="mc-conf">{sig.confidence}% · {sig.strategy||""}</div>}
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* ── INDICATORS TAB ── */}
          {tab==="INDICATORS"&&(
            <div className="tab-content">
              <div className="section-title" style={{marginBottom:12}}>
                TECHNICAL INDICATORS — {selected}
                <button className="btn-secondary" style={{marginLeft:12}} onClick={()=>api.barsWithIndicators(selected).then(r=>setIndicators(r.indicators)).catch(()=>{})}>REFRESH</button>
              </div>
              {indicators?(
                <>
                  <div className="glass-panel" style={{padding:16}}>
                    <IndicatorPanel indicators={indicators} signal={selSig}/>
                  </div>
                  <div className="glass-panel" style={{padding:16,marginTop:12}}>
                    <div className="sd-label" style={{marginBottom:10}}>SIGNAL CONSENSUS</div>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      {[
                        {label:"RSI Signal",val:indicators.rsi14>70?"OVERBOUGHT":indicators.rsi14<30?"OVERSOLD":"NEUTRAL",color:indicators.rsi14>70?"#ff4466":indicators.rsi14<30?"#00ff88":"#ffaa00"},
                        {label:"MACD",val:indicators.macdHist>0?"BULLISH":"BEARISH",color:indicators.macdHist>0?"#00ff88":"#ff4466"},
                        {label:"BB",val:indicators.bbPosition>80?"UPPER BAND":indicators.bbPosition<20?"LOWER BAND":"MID",color:indicators.bbPosition>80?"#ff4466":indicators.bbPosition<20?"#00ff88":"#ffaa00"},
                        {label:"SMA Cross",val:indicators.sma5>indicators.sma20?"GOLDEN":"DEATH",color:indicators.sma5>indicators.sma20?"#00ff88":"#ff4466"},
                        {label:"VWAP",val:indicators.price>indicators.vwap?"ABOVE":"BELOW",color:indicators.price>indicators.vwap?"#00ff88":"#ff4466"},
                      ].map(c=>(
                        <div key={c.label} style={{padding:"8px 12px",background:"#0a160a",border:`1px solid ${c.color}33`,minWidth:110}}>
                          <div style={{fontSize:9,color:"#2a5a2a",letterSpacing:1,marginBottom:4}}>{c.label}</div>
                          <div style={{color:c.color,fontWeight:"bold",fontSize:12}}>{c.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ):<div className="empty-state">Click REFRESH to load indicators for {selected}</div>}
            </div>
          )}

          {/* ── PORTFOLIO TAB ── */}
          {tab==="PORTFOLIO"&&(
            <div className="tab-content">
              <div className="stats-row">
                {[
                  {label:"PORTFOLIO VALUE",val:"$"+portVal.toLocaleString("en",{maximumFractionDigits:2}),cls:""},
                  {label:"CASH",val:"$"+cash.toLocaleString("en",{maximumFractionDigits:2}),cls:""},
                  {label:"BUYING POWER",val:"$"+bp.toLocaleString("en",{maximumFractionDigits:2}),cls:""},
                  {label:"DAY P&L",val:(dayPnl>=0?"+":"")+"$"+dayPnl.toFixed(2),cls:dayPnl>=0?"green":"red"},
                  {label:"SESSION P&L",val:(totalPnl>=0?"+":"")+"$"+totalPnl.toFixed(2),cls:totalPnl>=0?"green":"red"},
                  {label:"DAILY LOSS USED",val:(account?.dailyLossUsed||"0")+"%",cls:parseFloat(account?.dailyLossUsed||0)>3?"red":""},
                ].map(s=><div key={s.label} className="stat-card"><div className="stat-label">{s.label}</div><div className={"stat-val "+s.cls}>{s.val}</div></div>)}
              </div>
              {portfolioHistory.length > 1 && (
                <div className="glass-panel" style={{padding:16}}>
                  <div className="section-title" style={{marginBottom:12}}>EQUITY CURVE (TODAY)</div>
                  <PortfolioChart data={portfolioHistory} startValue={startEquity.current}/>
                </div>
              )}
              <div className="section-title">OPEN POSITIONS</div>
              {positions.length===0?<div className="empty-state">No open positions</div>:(
                <table className="data-table"><thead><tr><th>SYMBOL</th><th>SHARES</th><th>ENTRY</th><th>CURRENT</th><th>VALUE</th><th>P&L</th><th>P&L %</th><th>SIGNAL</th><th>ACTION</th></tr></thead>
                <tbody>{positions.map(p=>{
                  const sig=signals[p.sym];
                  return(<tr key={p.sym} onClick={()=>setSelected(p.sym)} className="clickable-row">
                    <td className="sym-cell">{p.sym}</td><td>{p.qty}</td><td>${p.avgEntry.toFixed(2)}</td><td>${p.currentPrice.toFixed(2)}</td>
                    <td>${p.marketValue.toFixed(2)}</td>
                    <td className={p.unrealizedPnl>=0?"green":"red"}>{p.unrealizedPnl>=0?"+":""}${p.unrealizedPnl.toFixed(2)}</td>
                    <td className={p.unrealizedPnlPct>=0?"green":"red"}>{p.unrealizedPnlPct>=0?"+":""}{p.unrealizedPnlPct.toFixed(2)}%</td>
                    <td>{sig?<span className={"sig-badge sig-"+sig.signal?.toLowerCase()}>{sig.signal}</span>:<span className="dim">—</span>}</td>
                    <td><div className="action-btns"><button className="btn-buy-sm" onClick={e=>{e.stopPropagation();placeOrder(p.sym,"BUY");}}>BUY</button><button className="btn-sell-sm" onClick={e=>{e.stopPropagation();placeOrder(p.sym,"SELL");}}>SELL</button></div></td>
                  </tr>);
                })}</tbody></table>
              )}
            </div>
          )}

          {/* ── ORDERS TAB ── */}
          {tab==="ORDERS"&&(
            <div className="tab-content">
              <div className="section-title">ORDER HISTORY <button className="btn-secondary" style={{marginLeft:12}} onClick={()=>api.orders().then(setOrders).catch(()=>{})}>REFRESH</button></div>
              {orders.length===0?<div className="empty-state">No orders</div>:(
                <table className="data-table"><thead><tr><th>TIME</th><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>FILLED</th><th>PRICE</th><th>STATUS</th><th>ACTION</th></tr></thead>
                <tbody>{orders.map(o=>(
                  <tr key={o.id}>
                    <td className="dim">{new Date(o.createdAt).toLocaleTimeString()}</td>
                    <td className="sym-cell">{o.sym}</td>
                    <td className={o.side==="BUY"?"green":"red"}>{o.side}</td>
                    <td>{o.qty}</td><td>{o.filledQty}</td>
                    <td>{o.filledPrice?"$"+o.filledPrice.toFixed(2):"—"}</td>
                    <td><span className={"status-badge status-"+o.status}>{o.status}</span></td>
                    <td>{["new","accepted","pending_new"].includes(o.status)&&<button className="btn-cancel" onClick={()=>cancelOrder(o.id)}>CANCEL</button>}</td>
                  </tr>
                ))}</tbody></table>
              )}
            </div>
          )}

          {/* ── TRADES TAB ── */}
          {tab==="TRADES"&&(
            <div className="tab-content">
              <div className="section-title">TRADE LOG ({trades.length})</div>
              {trades.length===0?<div className="empty-state">No trades yet</div>:(
                <table className="data-table"><thead><tr><th>TIME</th><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>PRICE</th><th>VALUE</th><th>CONF</th><th>REASON</th><th>SOURCE</th><th>MODE</th></tr></thead>
                <tbody>{trades.map((t,i)=>(
                  <tr key={t.id||i}>
                    <td className="dim">{t.time||new Date(t.ts).toLocaleTimeString()}</td>
                    <td className="sym-cell">{t.sym}</td>
                    <td className={t.side==="BUY"?"green":"red"}>{t.side}</td>
                    <td>{t.qty}</td><td>${(t.price||0).toFixed(2)}</td><td>${((t.price||0)*t.qty).toFixed(2)}</td>
                    <td>{t.confidence?<span style={{color:"#00ff8888"}}>{t.confidence}%</span>:<span className="dim">—</span>}</td>
                    <td style={{maxWidth:180,fontSize:10,color:"#3a6a3a"}}>{t.reason||"—"}</td>
                    <td>{t.auto?<span className="auto-badge">🤖 AUTO</span>:<span className="dim">MANUAL</span>}</td>
                    <td><span className={"mode-badge mode-"+(t.mode||"paper").toLowerCase()}>{t.mode||"PAPER"}</span></td>
                  </tr>
                ))}</tbody></table>
              )}
            </div>
          )}

          {/* ── ANALYTICS TAB ── */}
          {tab==="ANALYTICS"&&(
            <div className="tab-content">
              <div className="stats-row">
                {[
                  {label:"AUTO TRADES",val:autoStats.totalTrades||0,cls:""},
                  {label:"WIN RATE",val:winRate+"%",cls:parseFloat(winRate)>50?"green":"red"},
                  {label:"TOTAL P&L",val:(totalPnl>=0?"+":"")+"$"+totalPnl.toFixed(2),cls:totalPnl>=0?"green":"red"},
                  {label:"STRATEGY",val:(strategyConfig?.strategy||"—").toUpperCase(),cls:"",style:{color:"#ffaa00"}},
                  {label:"MIN CONFIDENCE",val:(strategyConfig?.minConfidence||65)+"%",cls:""},
                  {label:"MAX POSITION",val:strategyConfig?.maxPosition||5,cls:""},
                ].map(s=><div key={s.label} className="stat-card"><div className="stat-label">{s.label}</div><div className={"stat-val "+s.cls} style={s.style}>{s.val}</div></div>)}
              </div>

              {portfolioHistory.length > 1 && (
                <div className="glass-panel" style={{padding:16}}>
                  <div className="section-title" style={{marginBottom:12}}>EQUITY CURVE</div>
                  <PortfolioChart data={portfolioHistory} startValue={startEquity.current}/>
                </div>
              )}

              <div className="glass-panel" style={{padding:16}}>
                <div className="section-title" style={{marginBottom:12}}>AI SIGNAL SUMMARY</div>
                <table className="data-table"><thead><tr><th>SYMBOL</th><th>SIGNAL</th><th>CONFIDENCE</th><th>RSI</th><th>MACD HIST</th><th>BB POS</th><th>REASON</th><th>AGE</th></tr></thead>
                <tbody>{watchlist.map(sym=>{
                  const sig=signals[sym];
                  if(!sig) return(<tr key={sym}><td className="sym-cell">{sym}</td><td colSpan={7} className="dim">No signal yet</td></tr>);
                  const age=Math.floor((Date.now()-sig.ts)/60000);
                  return(<tr key={sym}>
                    <td className="sym-cell">{sym}</td>
                    <td><span className={"sig-badge sig-"+sig.signal?.toLowerCase()}>{sig.signal}</span></td>
                    <td>{sig.confidence}%</td>
                    <td className={sig.indicators?.rsi>70?"red":sig.indicators?.rsi<30?"green":""}>{sig.indicators?.rsi||"—"}</td>
                    <td className={sig.indicators?.macdHist>0?"green":"red"}>{sig.indicators?.macdHist?parseFloat(sig.indicators.macdHist).toFixed(4):"—"}</td>
                    <td>{sig.indicators?.bbPosition?parseFloat(sig.indicators.bbPosition).toFixed(0)+"%":"—"}</td>
                    <td style={{fontSize:10,color:"#3a6a3a",maxWidth:160}}>{sig.reason}</td>
                    <td className="dim">{age<1?"<1m":`${age}m ago`}</td>
                  </tr>);
                })}</tbody></table>
              </div>

              <div className="glass-panel" style={{padding:16}}>
                <div className="section-title" style={{marginBottom:12}}>RISK MANAGEMENT STATUS</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <div className="sd-label" style={{marginBottom:6}}>DAILY LOSS USED</div>
                    <div className="conf-bar" style={{width:"100%",marginBottom:4}}>
                      <div className="conf-fill" style={{width:(account?.dailyLossUsed||0)+"%",background:parseFloat(account?.dailyLossUsed||0)>3?"#ff4466":"#00ff88"}}/>
                    </div>
                    <div style={{fontSize:11,color:"#8ab88a"}}>{account?.dailyLossUsed||0}% of {account?.dailyLossLimit||5}% limit</div>
                  </div>
                  <div>
                    <div className="sd-label" style={{marginBottom:6}}>OPEN POSITIONS</div>
                    <div className="conf-bar" style={{width:"100%",marginBottom:4}}>
                      <div className="conf-fill" style={{width:(positions.length/(strategyConfig?.maxPosition||5))*100+"%"}}/>
                    </div>
                    <div style={{fontSize:11,color:"#8ab88a"}}>{positions.length} / {strategyConfig?.maxPosition||5} max positions</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ── RIGHT SIDEBAR ── */}
        <aside className="sidebar-right">
          <div className="sidebar-title">AI SIGNALS {autoTrading&&<span className="auto-pill"><span className="live-dot-sm"/>LIVE</span>}</div>
          {watchlist.map(sym=>{
            const sig=signals[sym],isScan=scanning[sym];
            return(<div key={sym} className="signal-item">
              <div className="si-top"><span className="si-sym">{sym}</span>
                {isScan?<span className="scanning-sm">...</span>:sig?<span className={"sig-badge sig-"+sig.signal?.toLowerCase()}>{sig.signal}</span>:<span className="no-signal">NO SIG</span>}
              </div>
              {sig&&<>
                <div className="si-conf">{sig.confidence}% conf · {sig.strategy||"AI"}</div>
                <div className="si-reason">{sig.reason}</div>
                {sig.target&&<div className="si-tp">TP: <span className="green">${parseFloat(sig.target).toFixed(2)}</span> · SL: <span className="red">${parseFloat(sig.stopLoss||0).toFixed(2)}</span></div>}
              </>}
              {!sig&&!isScan&&<button className="btn-scan-sm" onClick={()=>scanOne(sym)}>ANALYZE</button>}
            </div>);
          })}
          <div className="sr-footer">
            <button className="btn-scan-all" onClick={scanAll} disabled={scanLoading}>{scanLoading?"SCANNING...":"⚡ SCAN ALL"}</button>
            <div className="auto-info">
              <div className="ai-title">AUTO-TRADER</div>
              <div className={"ai-status"+(autoTrading?" active":"")} onClick={toggleAutoTrade}>
                {autoTrading?"🟢 ACTIVE — click to stop":"⏸ INACTIVE — click to start"}
              </div>
              <div className="ai-desc">
                {strategyConfig&&`Strategy: ${strategyConfig.strategy} · Min conf: ${strategyConfig.minConfidence}%`}
              </div>
              {!marketOpen&&autoTrading&&<div style={{fontSize:9,color:"#ff8800",marginTop:4}}>⏳ Waiting for market open</div>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
