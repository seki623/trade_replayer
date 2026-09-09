'use strict';

const CRYPTO = [
  {sym:'BTCUSDT', d:2, pip:1},
  {sym:'ETHUSDT', d:2, pip:1},
];
const FX = [
  {sym:'USDJPY',d:3,pip:100},{sym:'EURUSD',d:5,pip:10000},{sym:'GBPUSD',d:5,pip:10000},
  {sym:'XAUUSD',d:2,pip:1},{sym:'XAGUSD',d:3,pip:100},{sym:'JP225',d:1,pip:1}
];
const ALL_SYMS = [...CRYPTO, ...FX];
const SYM_MAP = new Map(ALL_SYMS.map(s => [s.sym, s]));
const CRYPTO_SET = new Set(CRYPTO.map(c => c.sym));

const TIMEFRAMES = [
  {label:'Tick',sec:0},
  {label:'1s',sec:1},{label:'5s',sec:5},{label:'15s',sec:15},{label:'30s',sec:30},
  {label:'1m',sec:60},{label:'5m',sec:300},{label:'15m',sec:900},
  {label:'1h',sec:3600},{label:'4h',sec:14400},
  {label:'1D',sec:86400}
];

const JST = 9*3600;

let ws = null;
let reconnectTimer = null;
let chart = null;
let candleSeries = null, volumeSeries = null;
let currentSymbol = 'BTCUSDT';
let currentTfIdx = 5; // 1m
let dataMode = 'live';

let historyReqId = 0;
let cachedInfo = null;

let $bid, $ask, $spread, $status;

function symInfo(sym) { return SYM_MAP.get(sym) || {sym,d:2,pip:1}; }
function isCrypto(sym) { return CRYPTO_SET.has(sym); }
function isTickMode() { return TIMEFRAMES[currentTfIdx].sec === 0; }
function fmtPrice(v) { return typeof v === 'number' ? v.toFixed(cachedInfo.d) : '--'; }

function clearSeries() {
  if (candleSeries) candleSeries.setData([]);
  if (volumeSeries) volumeSeries.setData([]);
}

function addS(type, opts) {
  const map = {Candlestick:'CandlestickSeries',Histogram:'HistogramSeries'};
  const st = LightweightCharts[map[type]];
  if (st && chart.addSeries) { try { return chart.addSeries(st, opts); } catch(e){} }
  return chart['add'+type+'Series'](opts);
}

function initUI() {
  const sel = document.getElementById('symbol-select');
  appendOptgroup(sel, 'Crypto', CRYPTO, currentSymbol);
  appendOptgroup(sel, 'FX / Commodities / Index', FX, currentSymbol);
  sel.onchange = e => onSymbolSelect(e.target.value);

  const grp = document.getElementById('tf-group');
  TIMEFRAMES.forEach((tf, i) => {
    const b = document.createElement('button');
    b.className = 'tf-btn' + (i === currentTfIdx ? ' active' : '');
    b.textContent = tf.label;
    b.onclick = () => {
      currentTfIdx = i;
      grp.querySelectorAll('.tf-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      clearSeries();
      if (dataMode === 'live' && !isTickMode() && isCrypto(currentSymbol)) {
        loadHistory(currentSymbol, i);
      }
    };
    grp.appendChild(b);
  });
}

function appendOptgroup(sel, label, items, selectedSym) {
  const g = document.createElement('optgroup');
  g.label = label;
  items.forEach(({sym}) => {
    const o = document.createElement('option');
    o.value = sym; o.textContent = sym;
    if (sym === selectedSym) o.selected = true;
    g.appendChild(o);
  });
  sel.appendChild(g);
}

function switchDataMode(mode) {
  dataMode = mode;
  document.getElementById('btn-mode-live').classList.toggle('active', mode === 'live');
  document.getElementById('btn-mode-replay').classList.toggle('active', mode === 'replay');

  resetChartState();

  if (mode === 'live') {
    if (isCrypto(currentSymbol)) {
      loadHistory(currentSymbol, currentTfIdx);
      connectBinance(currentSymbol);
    }
  } else {
    disconnectWs();
    if (typeof pauseReplay === 'function') pauseReplay();
  }
}

function initChart() {
  const container = document.getElementById('chart-container');
  chart = LightweightCharts.createChart(container, {
    autoSize: true,
    layout: { background:{type:'solid',color:'#0a0a0f'}, textColor:'#444', fontFamily:"'Consolas','SF Mono',monospace", fontSize:11 },
    grid:{vertLines:{color:'#111118'},horzLines:{color:'#111118'}},
    rightPriceScale:{borderColor:'#1a1a28'},
    timeScale:{borderColor:'#1a1a28',timeVisible:true,secondsVisible:true},
  });

  volumeSeries = addS('Histogram',{color:'#1a3a5c',priceFormat:{type:'volume'},priceScaleId:'vol'});
  volumeSeries.priceScale().applyOptions({scaleMargins:{top:0.85,bottom:0}});

  candleSeries = addS('Candlestick',{
    upColor:'#26a69a',downColor:'#ef5350',borderVisible:false,wickUpColor:'#26a69a',wickDownColor:'#ef5350',
  });

  applyPrecision();
}

function applyPrecision() {
  cachedInfo = symInfo(currentSymbol);
  const pf = {type:'price',precision:cachedInfo.d,minMove:Math.pow(10,-cachedInfo.d)};
  candleSeries.applyOptions({priceFormat:pf});
}

function disconnectWs() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
  $status.className = 'err';
}

function connectBinance(symbol) {
  disconnectWs();
  const stream = symbol.toLowerCase() + '@ticker';
  ws = new WebSocket('wss://stream.binance.com:9443/ws/' + stream);

  ws.onopen = () => {
    $status.className = 'ok';
  };

  ws.onmessage = e => {
    if (dataMode !== 'live') return;
    try {
      const m = JSON.parse(e.data);
      if (m.c) {
        const price = parseFloat(m.c);
        const bid = parseFloat(m.b || m.c);
        const ask = parseFloat(m.a || m.c);
        onLiveTick(m.s, price, bid, ask);
      }
    } catch(err){}
  };

  ws.onclose = () => {
    $status.className = 'err';
    if (dataMode === 'live' && isCrypto(currentSymbol)) {
      reconnectTimer = setTimeout(() => connectBinance(currentSymbol), 2000);
    }
  };

  ws.onerror = () => {
    $status.className = 'err';
  };
}

let lastBar = null;

function onLiveTick(symbol, price, bid, ask) {
  if (symbol !== currentSymbol || dataMode !== 'live') return;

  $bid.textContent = fmtPrice(bid);
  $ask.textContent = fmtPrice(ask);
  $spread.textContent = ((ask - bid) * cachedInfo.pip).toFixed(1);

  const nowSec = Math.floor(Date.now() / 1000) + JST;
  const tfSec = TIMEFRAMES[currentTfIdx].sec;

  if (tfSec > 0) {
    const barTime = Math.floor(nowSec / tfSec) * tfSec;
    if (!lastBar || lastBar.time !== barTime) {
      lastBar = { time: barTime, open: price, high: price, low: price, close: price };
    } else {
      lastBar.high = Math.max(lastBar.high, price);
      lastBar.low = Math.min(lastBar.low, price);
      lastBar.close = price;
    }
    candleSeries.update(lastBar);
  }
}

function onSymbolSelect(sym) {
  currentSymbol = sym;
  resetChartState();
  applyPrecision();

  if (dataMode === 'live') {
    if (isCrypto(sym)) {
      loadHistory(sym, currentTfIdx);
      connectBinance(sym);
    } else {
      disconnectWs();
    }
  }
}

function resetChartState() {
  lastBar = null;
  historyReqId++;
  clearSeries();
  if (typeof clearTradeVisuals === 'function') clearTradeVisuals();
  $bid.textContent = '\u2014'; $ask.textContent = '\u2014'; $spread.textContent = '\u2014';
}

async function loadHistory(symbol, tfIdx) {
  if (isTickMode() || !isCrypto(symbol) || dataMode !== 'live') return;
  const reqId = ++historyReqId;
  const BINANCE_TF_MAP = {60:'1m',300:'5m',900:'15m',3600:'1h',14400:'4h',86400:'1d'};
  const interval = BINANCE_TF_MAP[TIMEFRAMES[tfIdx].sec];
  if (!interval) return;

  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`);
    if (!res.ok || reqId !== historyReqId) return;
    const raw = await res.json();
    const candles = raw.map(k => ({
      time: Math.floor(k[0]/1000) + JST, open:parseFloat(k[1]), high:parseFloat(k[2]), low:parseFloat(k[3]), close:parseFloat(k[4])
    }));
    if (candles.length > 0 && reqId === historyReqId) {
      candleSeries.setData(candles);
      chart.timeScale().fitContent();
    }
  } catch(e) {}
}

window.addEventListener('DOMContentLoaded', () => {
  $bid = document.getElementById('bid-val');
  $ask = document.getElementById('ask-val');
  $spread = document.getElementById('spread-val');
  $status = document.getElementById('status');

  initUI();
  initChart();
  if (isCrypto(currentSymbol)) {
    loadHistory(currentSymbol, currentTfIdx);
    connectBinance(currentSymbol);
  }
});