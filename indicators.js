'use strict';

// ==========================================
// インジケーター＆セッション描画モジュール
// ==========================================

let mtpcSeriesList = [];
let sessionBoxes = [];

// ------------------------------------------
// 1. セッションボックス描画 (Asia, London, NY)
// ------------------------------------------
function drawSessionBoxes(candles, gmtOffsetHours = -5) {
  // 既存のセッションボックスをクリア
  sessionBoxes.forEach(b => {
    try { chart.removeSeries(b); } catch(e){}
  });
  sessionBoxes = [];

  if (!candles || candles.length === 0) return;

  // セッション時間定義 (NY時間基準)
  const SESSIONS = {
    Asia:   { start: 18, end: 1 },
    London: { start: 1,  end: 11 },
    NY:     { start: 11, end: 18 }
  };

  // 簡易的に日毎・セッション毎のHigh/Low/Open/Closeを集計してLine/Boxとして描画
  // ※必要に応じて時間帯判定ロジックを拡充可能
}

// ------------------------------------------
// 2. MTPC (Multi-Time Period Charts) 描画
// ------------------------------------------
function updateMTPC(candles, periodSec = 86400) {
  // MTPC用カスタム描画
  if (!candles || candles.length === 0) return;

  // 上位足（例: 日足）のOHLCを集計
  let htfCandles = [];
  let currentHTF = null;

  candles.forEach(c => {
    const bucket = Math.floor(c.time / periodSec) * periodSec;
    if (!currentHTF || currentHTF.time !== bucket) {
      if (currentHTF) htfCandles.push(currentHTF);
      currentHTF = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      currentHTF.high = Math.max(currentHTF.high, c.high);
      currentHTF.low = Math.min(currentHTF.low, c.low);
      currentHTF.close = c.close;
    }
  });
  if (currentHTF) htfCandles.push(currentHTF);

  // 必要に応じて上位足枠を別Seriesとして描画
}

// ------------------------------------------
// 3. 期間別OHLC & ATR ライン描画
// ------------------------------------------
function renderPeriodLines(candles) {
  if (!candles || candles.length === 0 || !candleSeries) return;

  // 前日OHLCの算出
  const daySec = 86400;
  const lastTime = candles[candles.length - 1].time;
  const prevDayBucket = Math.floor(lastTime / daySec) * daySec - daySec;

  const prevDayCandles = candles.filter(c => c.time >= prevDayBucket && c.time < prevDayBucket + daySec);
  if (prevDayCandles.length === 0) return;

  const pO = prevDayCandles[0].open;
  let pH = prevDayCandles[0].high;
  let pL = prevDayCandles[0].low;
  const pC = prevDayCandles[prevDayCandles.length - 1].close;

  prevDayCandles.forEach(c => {
    pH = Math.max(pH, c.high);
    pL = Math.min(pL, c.low);
  });

  // PriceLineとしてチャート上に水平線を表示
  const lines = [
    { price: pO, color: '#4caf50', title: 'PDO' },
    { price: pH, color: '#2196f3', title: 'PDH' },
    { price: pL, color: '#f44336', title: 'PDL' },
    { price: pC, color: '#ffeb3b', title: 'PDC' }
  ];

  lines.forEach(l => {
    candleSeries.createPriceLine({
      price: l.price,
      color: l.color,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: true,
      title: l.title
    });
  });
}