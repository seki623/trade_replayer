// ==========================================
// TickForge: デフォルト銘柄選択対応 & トレード描画完全修正版
// ==========================================

let allRawData = [];       // CSV解析データ
let replayQueue = [];      // リプレイ対象データ
let currentIndex = 0;
let replayTimer = null;
let replaySpeed = 500;     // ms

let paperAccount = {
    balance: 1000000,
    position: null
};

// マーカーとラインの保持用
let tradeMarkers = [];
let tradeLines = [];

// 1. 指定された範囲のCSVをロード＆フィルタリング
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

    // デフォルトの銘柄選択ドロップダウン (#symbol-select) から現在選択中の銘柄を取得
    const symbolSelectEl = document.getElementById('symbol-select');
    const currentSymbol = symbolSelectEl ? symbolSelectEl.value : (typeof currentSymbol !== 'undefined' ? currentSymbol : 'XAUUSD');

    const startDate = new Date(startVal);
    const yyyy = startDate.getFullYear();
    const mm = String(startDate.getMonth() + 1).padStart(2, '0');
    
    // 選択中の銘柄フォルダーを参照 (例: ./BTCUSDT/2025-07.csv, ./XAUUSD/2025-07.csv)
    const filePath = `./${currentSymbol}/${yyyy}-${mm}.csv`;

    pauseReplay();
    clearTradeVisuals(); // 過去のトレード描画をリセット

    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`【${currentSymbol}】のデータが見つかりません:\n${filePath}\nリポジトリ内にフォルダーとCSVファイルが配置されているかご確認ください。`);
        }
        const text = await response.text();
        
        parseCSV(text);

        const historyData = allRawData.filter(d => d.time < startTs);
        replayQueue = allRawData.filter(d => d.time >= startTs && d.time <= endTs);

        if (replayQueue.length === 0) {
            alert(`指定された期間のデータがCSV内に見つかりませんでした。`);
            return;
        }

        if (typeof candleSeries !== 'undefined' && candleSeries) {
            candleSeries.setData(historyData.map(d => ({
                time: d.time, open: d.open, high: d.high, low: d.low, close: d.close
            })));
            if (typeof chart !== 'undefined' && chart) {
                chart.timeScale().fitContent();
            }
        }

        currentIndex = 0;
        alert(`【${currentSymbol} 準備完了】\n過去データ: ${historyData.length}本描画済み\nリプレイ対象: ${replayQueue.length}本\n▶ ボタンを押すとローソク足の生成が始まります。`);

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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(/[,;\t]+/);
        if (cols.length < 5) continue;

        let unixSec = null;
        let oIdx = 1, hIdx = 2, lIdx = 3, cIdx = 4, vIdx = 5;

        if (cols[0].length <= 10 && cols[1] && cols[1].includes(':')) {
            unixSec = parseDateTimeToUnix(cols[0], cols[1]);
            oIdx = 2; hIdx = 3; lIdx = 4; cIdx = 5; vIdx = 6;
        } else {
            unixSec = parseDateTimeToUnix(cols[0]);
            oIdx = 1; hIdx = 2; lIdx = 3; cIdx = 4; vIdx = 5;
        }

        const open = parseFloat(cols[oIdx]);
        const high = parseFloat(cols[hIdx]);
        const low = parseFloat(cols[lIdx]);
        const close = parseFloat(cols[cIdx]);

        if (unixSec && !isNaN(close)) {
            allRawData.push({
                time: unixSec,
                open: isNaN(open) ? close : open,
                high: isNaN(high) ? close : high,
                low: isNaN(low) ? close : low,
                close: close,
                price: close,
                volume: cols[vIdx] ? parseFloat(cols[vIdx]) : 0
            });
        }
    }
    allRawData.sort((a, b) => a.time - b.time);
}

// 2. リプレイ再生
function startReplay() {
    if (replayQueue.length === 0) {
        alert("リプレイデータがありません。日時を指定して 'Load' を押してください。");
        return;
    }
    if (replayTimer) clearInterval(replayTimer);

    replayTimer = setInterval(() => {
        if (currentIndex >= replayQueue.length) {
            clearInterval(replayTimer);
            alert("指定期間のリプレイが終了いたしました。");
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

// 3. デモトレード（注文・決済処理）
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
        qty: 1
    };

    // オープン位置に矢印マーカーを追加
    const marker = {
        time: currentBar.time,
        position: side === 'BUY' ? 'belowBar' : 'aboveBar',
        color: side === 'BUY' ? '#26a69a' : '#ef5350',
        shape: side === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: side === 'BUY' ? `BUY @${currentBar.price.toFixed(2)}` : `SELL @${currentBar.price.toFixed(2)}`
    };
    
    tradeMarkers.push(marker);
    setChartMarkers();

    updateAccountUI(currentBar.price);
}

function closePaperPosition() {
    if (!paperAccount.position) return;

    const currentBar = replayQueue[currentIndex - 1];
    const pos = paperAccount.position;

    let pnl = (pos.side === 'BUY') 
        ? (currentBar.price - pos.entryPrice) * pos.qty 
        : (pos.entryPrice - currentBar.price) * pos.qty;

    // クローズ位置にスクエアマーカーを追加
    const closeMarker = {
        time: currentBar.time,
        position: pos.side === 'BUY' ? 'aboveBar' : 'belowBar',
        color: pnl >= 0 ? '#26a69a' : '#ef5350',
        shape: 'square',
        text: `CLOSE @${currentBar.price.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)})`
    };
    tradeMarkers.push(closeMarker);
    setChartMarkers();

    // エントリーから決済までを繋ぐラインを描画
    drawTradeLine(pos.entryTime, pos.entryPrice, currentBar.time, currentBar.price, pnl >= 0);

    paperAccount.balance += pnl;
    paperAccount.position = null;
    updateAccountUI(currentBar.price);
}

// 4. チャート描画処理 (Lightweight Charts v3/v4 完全対応)
function setChartMarkers() {
    if (typeof candleSeries !== 'undefined' && candleSeries && candleSeries.setMarkers) {
        tradeMarkers.sort((a, b) => a.time - b.time);
        candleSeries.setMarkers(tradeMarkers);
    }
}

function drawTradeLine(startTime, startPrice, endTime, endPrice, isWin) {
    if (typeof chart === 'undefined' || !chart) return;

    const lineColor = isWin ? '#26a69a' : '#ef5350';
    let lineSeries = null;

    // 軽量チャートのバージョン差分を安全に吸収して LineSeries を作成
    try {
        if (typeof LightweightCharts !== 'undefined' && LightweightCharts.LineSeries) {
            lineSeries = chart.addSeries(LightweightCharts.LineSeries, {
                color: lineColor,
                lineWidth: 2,
                lineStyle: 2, // 点線
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
        } else if (chart.addLineSeries) {
            lineSeries = chart.addLineSeries({
                color: lineColor,
                lineWidth: 2,
                lineStyle: 2, // 点線
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
        }
    } catch(e) {
        console.error("ライン描画エラー:", e);
    }

    if (lineSeries) {
        lineSeries.setData([
            { time: startTime, value: startPrice },
            { time: endTime, value: endPrice }
        ]);
        tradeLines.push(lineSeries);
    }
}

function clearTradeVisuals() {
    tradeMarkers = [];
    if (typeof candleSeries !== 'undefined' && candleSeries && candleSeries.setMarkers) {
        candleSeries.setMarkers([]);
    }
    if (typeof chart !== 'undefined' && chart) {
        tradeLines.forEach(line => {
            try { chart.removeSeries(line); } catch(e) {}
        });
    }
    tradeLines = [];
}

function processPaperTrade(bar) {
    if (!paperAccount.position) return;
    updateAccountUI(bar.price);
}

// 5. UI更新ヘルパー
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