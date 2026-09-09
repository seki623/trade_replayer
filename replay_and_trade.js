// ==========================================
// TickForge 連携版: 期間指定ステップ描画リプレイ
// ==========================================

let allRawData = [];       // CSVから解析した全データ
let replayQueue = [];      // 開始〜終了期間中に1足ずつ追加していくデータ
let currentIndex = 0;
let replayTimer = null;
let replaySpeed = 500; // ms

let paperAccount = {
    balance: 1000000,
    position: null
};

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

    // 開始日時の年月から該当するCSVファイルパスを特定 (例: XAUUSD/2025-07.csv)
    const startDate = new Date(startVal);
    const yyyy = startDate.getFullYear();
    const mm = String(startDate.getMonth() + 1).padStart(2, '0');
    const filePath = `./XAUUSD/${yyyy}-${mm}.csv`;

    pauseReplay();

    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error("ファイルが見つかりません: " + filePath);
        const text = await response.text();
        
        parseCSV(text);

        // 開始時間より前のデータ（背景となる過去チャート）
        const historyData = allRawData.filter(d => d.time < startTs);
        // 再生期間中のデータ（▶ ボタンで1足ずつ描画するデータ）
        replayQueue = allRawData.filter(d => d.time >= startTs && d.time <= endTs);

        if (replayQueue.length === 0) {
            alert("指定された期間のデータが見つかりませんでした。");
            return;
        }

        // 過去データのみを初期描画（未来の足は見せない）
        if (typeof candleSeries !== 'undefined' && candleSeries) {
            candleSeries.setData(historyData.map(d => ({
                time: d.time, open: d.open, high: d.high, low: d.low, close: d.close
            })));
            if (typeof chart !== 'undefined' && chart) {
                chart.timeScale().fitContent();
            }
        }

        currentIndex = 0;
        alert(`【準備完了】\n過去データ: ${historyData.length}本描画済み\nリプレイ対象: ${replayQueue.length}本\n▶ ボタンを押すとローソク足の生成が始まります。`);

    } catch (err) {
        console.error("ロードエラー:", err);
        alert(`データの読み込みに失敗しました:\n${filePath}`);
    }
}

// 日付文字列のパース関数
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

// CSV解析関数
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

// 2. リプレイ再生（1足ずつ生成・更新）
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

        // 1足ずつ動的に追加・更新
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

// 3. デモトレード処理
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
        qty: 1
    };
    updateAccountUI(currentBar.price);
}

function closePaperPosition() {
    if (!paperAccount.position) return;

    const currentBar = replayQueue[currentIndex - 1];
    const pos = paperAccount.position;
    let pnl = (pos.side === 'BUY') 
        ? (currentBar.price - pos.entryPrice) * pos.qty 
        : (pos.entryPrice - currentBar.price) * pos.qty;

    paperAccount.balance += pnl;
    paperAccount.position = null;
    updateAccountUI(currentBar.price);
}

function processPaperTrade(bar) {
    if (!paperAccount.position) return;
    updateAccountUI(bar.price);
}

// 4. UI更新ヘルパー
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