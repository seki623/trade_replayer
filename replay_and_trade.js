// ==========================================
// TickForge: リプレイ & ペパートレード制御 script
// ==========================================

let allRawData = [];
let replayQueue = [];
let currentIndex = 0;
let replayTimer = null;
let replaySpeed = 500;

let paperAccount = {
    balance: 1000000,
    position: null
};

let tradeLines = [];
let slPriceLine = null;
let tpPriceLine = null;

async function loadSelectedRange() {
    const startVal = document.getElementById('startTime').value;
    const endVal = document.getElementById('endTime').value;

    if (!startVal || !endVal) {
        alert("開始日時と終了日時を正しく指定してください。");
        return;
    }

    const startTs = Math.floor(new Date(startVal).getTime() / 1000);
    const endTs = Math.floor(new Date(endVal).getTime() / 1000);

    if (startTs >= endTs) {
        alert("終了日時は開始日時より後の時間を設定してください。");
        return;
    }

    const symbolSelectEl = document.getElementById('symbol-select');
    const symbol = symbolSelectEl ? symbolSelectEl.value : 'XAUUSD';

    const startDate = new Date(startVal);
    const yyyy = startDate.getFullYear();
    const mm = String(startDate.getMonth() + 1).padStart(2, '0');
    const filePath = `./${symbol}/${yyyy}-${mm}.csv`;

    pauseReplay();
    clearTradeVisuals();

    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`【${symbol}】のCSVデータが見つかりません:\n${filePath}`);
        }
        const text = await response.text();
        
        parseCSV(text);

        const historyData = allRawData.filter(d => d.time < startTs);
        replayQueue = allRawData.filter(d => d.time >= startTs && d.time <= endTs);

        if (replayQueue.length === 0) {
            alert(`【${symbol}】指定の期間データがCSV内に見つかりませんでした。`);
            return;
        }

        if (typeof candleSeries !== 'undefined' && candleSeries) {
            candleSeries.setData(historyData.map(d => ({
                time: d.time, open: d.open, high: d.high, low: d.low, close: d.close
            })));
            if (typeof volumeSeries !== 'undefined' && volumeSeries) {
                volumeSeries.setData(historyData.map(d => ({
                    time: d.time,
                    value: d.volume,
                    color: d.close >= d.open ? '#1e4d3b' : '#4d1e24'
                })));
            }
            if (typeof chart !== 'undefined' && chart) {
                chart.timeScale().fitContent();
            }
        }

        currentIndex = 0;
        alert(`【${symbol} ロード完了】\n過去背景データ: ${historyData.length}本\nリプレイ再生対象: ${replayQueue.length}本`);

    } catch (err) {
        console.error("ロードエラー:", err);
        alert(`データの読み込みに失敗しました:\n${err.message}`);
    }
}

function parseDateTimeToUnix(dateStr, timeStr) {
    try {
        let fullStr = dateStr;
        if (timeStr) fullStr += ' ' + timeStr;
        fullStr = fullStr.replace(/[\.\/]/g, '-');
        const d = new Date(fullStr);
        if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
    } catch(e) {}
    return null;
}

function parseCSV(text) {
    const lines = text.trim().split('\n');
    allRawData = [];

    // ヘッダー行があるか確認（1パターン目対策）
    let startLine = 0;
    if (lines[0].includes('Price') || lines[0].includes('Datetime') || lines[0].includes('Ticker')) {
        // ヘッダー行をスキップ
        while (startLine < lines.length && (
            lines[startLine].includes('Price') || 
            lines[startLine].includes('Ticker') || 
            lines[startLine].includes('Datetime')
        )) {
            startLine++;
        }
    }

    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(/[,;\t]+/);
        if (cols.length < 5) continue;

        let unixSec = null;
        let open = 0, high = 0, low = 0, close = 0, volume = 0;

        // パターン2: 日付と時間が分かれている場合 (例: 2026.01.02, 08:00, Open, High, Low, Close, Volume)
        if (cols[0].length <= 10 && cols[1] && cols[1].includes(':')) {
            unixSec = parseDateTimeToUnix(cols[0], cols[1]);
            open  = parseFloat(cols[2]);
            high  = parseFloat(cols[3]);
            low   = parseFloat(cols[4]);
            close = parseFloat(cols[5]);
            volume = cols[6] ? parseFloat(cols[6]) : 0;
        } 
        // パターン1: 1列目に日時がまとまっている場合 (例: 2026-09-01 00:00:00-04:00, Close, High, Low, Open, Volume)
        else {
            unixSec = parseDateTimeToUnix(cols[0]);
            // Yahoo形式（1パターン目）のカラム順: Close, High, Low, Open, Volume
            close  = parseFloat(cols[1]);
            high   = parseFloat(cols[2]);
            low    = parseFloat(cols[3]);
            open   = parseFloat(cols[4]);
            volume = cols[5] ? parseFloat(cols[5]) : 0;
        }

        if (unixSec && !isNaN(close) && !isNaN(open)) {
            allRawData.push({
                time: unixSec,
                open: open,
                high: high,
                low: low,
                close: close,
                price: close,
                volume: volume
            });
        }
    }
    allRawData.sort((a, b) => a.time - b.time);
}

function startReplay() {
    if (replayQueue.length === 0) {
        alert("リプレイデータがセットされていません。日時を指定して 'Load' を押してください。");
        return;
    }
    if (replayTimer) clearInterval(replayTimer);

    replayTimer = setInterval(() => {
        if (currentIndex >= replayQueue.length) {
            clearInterval(replayTimer);
            alert("リプレイが終了しました。");
            return;
        }

        const bar = replayQueue[currentIndex];

        if (typeof candleSeries !== 'undefined' && candleSeries) {
            candleSeries.update({
                time: bar.time,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close
            });
            if (typeof volumeSeries !== 'undefined' && volumeSeries) {
                volumeSeries.update({
                    time: bar.time,
                    value: bar.volume,
                    color: bar.close >= bar.open ? '#1e4d3b' : '#4d1e24'
                });
            }
        }

        updatePriceHeader(bar.price);
        processPaperTrade(bar);

        currentIndex++;
    }, replaySpeed);
}

function pauseReplay() {
    if (replayTimer) clearInterval(replayTimer);
}

function changeReplaySpeed(val) {
    replaySpeed = parseInt(val);
    if (replayTimer) startReplay();
}

function placePaperOrder(side) {
    if (paperAccount.position) {
        alert("すでにポジションを保有しています。");
        return;
    }
    if (replayQueue.length === 0 || currentIndex === 0) {
        alert("リプレイを開始（▶）してから注文してください。");
        return;
    }

    const currentBar = replayQueue[currentIndex - 1];

    paperAccount.position = {
        side: side,
        entryPrice: currentBar.price,
        entryTime: currentBar.time,
        sl: null,
        tp: null,
        qty: 1
    };

    applySLTP();
    showActiveMarker(currentBar.time, side);
    updateAccountUI(currentBar.price);
}

function applySLTP() {
    if (!paperAccount.position) return;

    const slVal = parseFloat(document.getElementById('input-sl').value);
    const tpVal = parseFloat(document.getElementById('input-tp').value);

    paperAccount.position.sl = !isNaN(slVal) ? slVal : null;
    paperAccount.position.tp = !isNaN(tpVal) ? tpVal : null;

    renderSltpLines();
}

function renderSltpLines() {
    if (typeof candleSeries === 'undefined' || !candleSeries || typeof candleSeries.createPriceLine !== 'function') return;

    if (slPriceLine) {
        try { candleSeries.removePriceLine(slPriceLine); } catch (e) {}
        slPriceLine = null;
    }
    if (tpPriceLine) {
        try { candleSeries.removePriceLine(tpPriceLine); } catch (e) {}
        tpPriceLine = null;
    }

    if (!paperAccount.position) return;

    const pos = paperAccount.position;

    if (pos.sl !== null) {
        slPriceLine = candleSeries.createPriceLine({
            price: pos.sl,
            color: '#ef5350',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'SL',
        });
    }

    if (pos.tp !== null) {
        tpPriceLine = candleSeries.createPriceLine({
            price: pos.tp,
            color: '#26a69a',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'TP',
        });
    }
}

function closePaperPosition(reason = 'MANUAL') {
    if (!paperAccount.position) return;

    const currentBar = replayQueue[currentIndex - 1];
    const pos = paperAccount.position;

    let exitPrice = currentBar.price;
    if (reason === 'SL' && pos.sl !== null) exitPrice = pos.sl;
    if (reason === 'TP' && pos.tp !== null) exitPrice = pos.tp;

    let pnl = (pos.side === 'BUY') 
        ? (exitPrice - pos.entryPrice) * pos.qty 
        : (pos.entryPrice - exitPrice) * pos.qty;

    clearMarkers();
    drawTradeLine(pos.entryTime, pos.entryPrice, currentBar.time, exitPrice, pnl >= 0);

    paperAccount.balance += pnl;
    paperAccount.position = null;

    renderSltpLines();
    updateAccountUI(currentBar.price);
}

function showActiveMarker(time, side) {
    if (typeof candleSeries === 'undefined' || !candleSeries) return;

    const marker = {
        time: time,
        position: side === 'BUY' ? 'belowBar' : 'aboveBar',
        color: side === 'BUY' ? '#26a69a' : '#ef5350',
        text: side === 'BUY' ? '▲' : '▼'
    };

    try {
        if (typeof LightweightCharts !== 'undefined' && typeof LightweightCharts.createSeriesMarkers === 'function') {
            LightweightCharts.createSeriesMarkers(candleSeries, [marker]);
        } else if (typeof candleSeries.setMarkers === 'function') {
            candleSeries.setMarkers([marker]);
        }
    } catch (e) {}
}

function clearMarkers() {
    if (typeof candleSeries === 'undefined' || !candleSeries) return;
    try {
        if (typeof LightweightCharts !== 'undefined' && typeof LightweightCharts.createSeriesMarkers === 'function') {
            LightweightCharts.createSeriesMarkers(candleSeries, []);
        } else if (typeof candleSeries.setMarkers === 'function') {
            candleSeries.setMarkers([]);
        }
    } catch(e){}
}

function drawTradeLine(startTime, startPrice, endTime, endPrice, isWin) {
    if (typeof chart === 'undefined' || !chart) return;

    const lineColor = isWin ? '#26a69a' : '#ef5350';
    let lineSeries = null;

    try {
        if (typeof LightweightCharts !== 'undefined' && LightweightCharts.LineSeries && chart.addSeries) {
            lineSeries = chart.addSeries(LightweightCharts.LineSeries, {
                color: lineColor,
                lineWidth: 2,
                lineStyle: 2,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
        } else if (chart.addLineSeries) {
            lineSeries = chart.addLineSeries({
                color: lineColor,
                lineWidth: 2,
                lineStyle: 2,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
        }
    } catch(e) {}

    if (lineSeries) {
        lineSeries.setData([
            { time: startTime, value: startPrice },
            { time: endTime, value: endPrice }
        ]);
        tradeLines.push(lineSeries);
    }
}

function clearTradeVisuals() {
    clearMarkers();
    if (typeof chart !== 'undefined' && chart) {
        tradeLines.forEach(line => {
            try { chart.removeSeries(line); } catch(e) {}
        });
    }
    tradeLines = [];
    renderSltpLines();
}

function processPaperTrade(bar) {
    if (!paperAccount.position) return;

    const pos = paperAccount.position;

    if (pos.side === 'BUY') {
        if (pos.sl !== null && bar.low <= pos.sl) {
            closePaperPosition('SL');
            return;
        }
        if (pos.tp !== null && bar.high >= pos.tp) {
            closePaperPosition('TP');
            return;
        }
    }

    if (pos.side === 'SELL') {
        if (pos.sl !== null && bar.high >= pos.sl) {
            closePaperPosition('SL');
            return;
        }
        if (pos.tp !== null && bar.low <= pos.low && pos.tp >= bar.low) {
            closePaperPosition('TP');
            return;
        }
    }

    updateAccountUI(bar.price);
}

function updatePriceHeader(price) {
    const $bid = document.getElementById('bid-val');
    const $ask = document.getElementById('ask-val');
    if ($bid) $bid.textContent = price.toFixed(2);
    if ($ask) $ask.textContent = price.toFixed(2);
}

function updateAccountUI(currentPrice) {
    let unrealizedPnl = 0;
    if (paperAccount.position) {
        const pos = paperAccount.position;
        unrealizedPnl = (pos.side === 'BUY')
            ? (currentPrice - pos.entryPrice) * pos.qty
            : (pos.entryPrice - currentPrice) * pos.qty;
    }

    const equity = paperAccount.balance + unrealizedPnl;
    const $equity = document.getElementById('acc-equity');
    const $pnl = document.getElementById('acc-pnl');

    if ($equity) $equity.textContent = Math.round(equity).toLocaleString();
    if ($pnl) {
        $pnl.textContent = Math.round(unrealizedPnl).toLocaleString();
        $pnl.className = 'pnl-val ' + (unrealizedPnl >= 0 ? 'pnl-plus' : 'pnl-minus');
    }
}

// cheesecake2 integration hook.
// Call this from any replay/live update path that has the visible candle array.
function refreshCheesecake2ForCandles(candles) {
  if (window.renderCheesecake2 && Array.isArray(candles)) {
    window.renderCheesecake2(candles);
  }
}
