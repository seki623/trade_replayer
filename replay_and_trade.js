// ==========================================
// TickForge 連携版: リプレイ & ペパートレード
// ==========================================

let tickData = [];
let currentIndex = 0;
let replayTimer = null;
let replaySpeed = 500; // ms

let paperAccount = {
    balance: 1000000,
    position: null
};

// 1. CSV読み込み処理 (XAUUSD/YYYY-MM.csv に対応)
function loadSelectedCSV() {
    const yearEl = document.getElementById('yearSelect');
    const monthEl = document.getElementById('monthSelect');
    if (!yearEl || !monthEl) return;
    
    const year = yearEl.value;
    const month = monthEl.value;
    const filePath = `./XAUUSD/${year}-${month}.csv`;

    pauseReplay();
    
    fetch(filePath)
        .then(response => {
            if (!response.ok) throw new Error("CSVファイルが見つかりません: " + filePath);
            return response.text();
        })
        .then(text => {
            parseCSV(text);
            alert(`【ロード完了】${year}年${month}月 (全${tickData.length}本)`);
        })
        .catch(err => {
            console.error("CSV読み込みエラー:", err);
            alert(`指定されたファイルが存在しませんでした:\n${filePath}`);
        });
}

function parseCSV(text) {
    const lines = text.trim().split('\n');
    tickData = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',');
        if (cols.length >= 6) {
            // YYYY.MM.DD HH:MM のパース
            const dateParts = cols[0].split('.');
            const timeParts = cols[1].split(':');
            
            if (dateParts.length === 3 && timeParts.length >= 2) {
                const year = parseInt(dateParts[0]);
                const month = parseInt(dateParts[1]) - 1;
                const day = parseInt(dateParts[2]);
                const hour = parseInt(timeParts[0]);
                const min = parseInt(timeParts[1]);

                // Unixタイムスタンプ（秒）
                const unixSec = Math.floor(Date.UTC(year, month, day, hour, min) / 1000);

                tickData.push({
                    time: unixSec,
                    open: parseFloat(cols[2]),
                    high: parseFloat(cols[3]),
                    low: parseFloat(cols[4]),
                    close: parseFloat(cols[5]),
                    price: parseFloat(cols[5]), // 終値を現在価格とする
                    volume: cols[6] ? parseFloat(cols[6]) : 0
                });
            }
        }
    }
    currentIndex = 0;

    // ロード時に全データを一括描画してフィットさせる
    if (tickData.length > 0 && typeof candleSeries !== 'undefined' && candleSeries) {
        candleSeries.setData(tickData.map(d => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close
        })));
        if (typeof chart !== 'undefined' && chart) {
            chart.timeScale().fitContent();
        }
    }
}

// 2. リプレイ再生コントロール
function startReplay() {
    if (tickData.length === 0) {
        alert("データがロードされていません。'Load' ボタンを押してください。");
        return;
    }
    if (replayTimer) clearInterval(replayTimer);

    replayTimer = setInterval(() => {
        if (currentIndex >= tickData.length) {
            clearInterval(replayTimer);
            alert("リプレイが終了しました。");
            return;
        }

        const currentBar = tickData[currentIndex];

        // チャートに1足ずつリアルタイム更新
        if (typeof candleSeries !== 'undefined' && candleSeries) {
            candleSeries.update({
                time: currentBar.time,
                open: currentBar.open,
                high: currentBar.high,
                low: currentBar.low,
                close: currentBar.close
            });
        }

        // ツールバーの Bid / Ask 表示を更新
        updatePriceHeader(currentBar.price);

        // 建玉の損益をリアルタイム更新
        processPaperTrade(currentBar);

        currentIndex++;
    }, replaySpeed);
}

function pauseReplay() {
    if (replayTimer) clearInterval(replayTimer);
}

function changeReplaySpeed(val) {
    replaySpeed = parseInt(val);
    if (replayTimer) {
        startReplay(); // 新しい速度でタイマー再開
    }
}

// 3. デモトレード（注文・決済）処理
function placePaperOrder(side) {
    if (paperAccount.position) {
        alert("すでにポジションを保有しています。CLOSEで決済してください。");
        return;
    }
    if (tickData.length === 0 || currentIndex === 0) {
        alert("リプレイを開始（▶）してから注文してください。");
        return;
    }

    const currentBar = tickData[currentIndex - 1];
    paperAccount.position = {
        side: side,
        entryPrice: currentBar.price,
        qty: 1
    };
    updateAccountUI(currentBar.price);
}

function closePaperPosition() {
    if (!paperAccount.position) return;

    const currentBar = tickData[currentIndex - 1];
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