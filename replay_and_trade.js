// ==========================================
// TickForge: リプレイ & ペーパートレード制御
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

// ==========================================
// XMサーバー時間 → UTC
// ==========================================
//
// CSVの日時はXMサーバー時間として扱う。
// 夏時間:
//   XM 00:00 = UTC 00:00
//   XM 01:00 = JST 07:00
//
// 冬時間:
//   XM 00:00 = UTC 00:00
//   XM 01:00 = JST 08:00
//
// 実際のUTC timestampへ変換して保持する。
// Lightweight Chartsはこのtimestampを使うことで
// ブラウザの日本時間表示になる。

function isLastSunday(year, month, date) {
    const d = new Date(year, month, date);

    return (
        d.getDay() === 0 &&
        date + 7 >
        new Date(year, month + 1, 0).getDate()
    );
}

function isXMSummerTime(year, month, day) {

    let marchLastSunday = 31;

    while (
        !isLastSunday(
            year,
            2,
            marchLastSunday
        )
    ) {
        marchLastSunday--;
    }

    let octoberLastSunday = 31;

    while (
        !isLastSunday(
            year,
            9,
            octoberLastSunday
        )
    ) {
        octoberLastSunday--;
    }

    const current =
        new Date(
            year,
            month,
            day,
            12,
            0,
            0,
            0
        );

    const summerStart =
        new Date(
            year,
            2,
            marchLastSunday,
            0,
            0,
            0,
            0
        );

    const summerEnd =
        new Date(
            year,
            9,
            octoberLastSunday,
            0,
            0,
            0,
            0
        );

    return (
        current >= summerStart &&
        current < summerEnd
    );
}

function parseDateTimeToUnix(
    dateStr,
    timeStr
) {

    if (!dateStr) return null;

    const dateParts =
        String(dateStr)
            .trim()
            .replace(/[./]/g, '-')
            .split('-')
            .map(Number);

    if (dateParts.length !== 3) {
        return null;
    }

    const year = dateParts[0];
    const month = dateParts[1];
    const day = dateParts[2];

    let hour = 0;
    let minute = 0;
    let second = 0;

    if (timeStr) {

        const tp =
            String(timeStr)
                .trim()
                .split(':')
                .map(Number);

        hour =
            Number.isFinite(tp[0])
                ? tp[0]
                : 0;

        minute =
            Number.isFinite(tp[1])
                ? tp[1]
                : 0;

        second =
            Number.isFinite(tp[2])
                ? tp[2]
                : 0;
    }

    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day)
    ) {
        return null;
    }

    const summer =
        isXMSummerTime(
            year,
            month - 1,
            day
        );

    /*
     * XMサーバー:
     *
     * 夏時間 = UTC+3
     * 冬時間 = UTC+2
     *
     * JSTとの関係:
     * 夏 = +6時間
     * 冬 = +7時間
     */

    const xmUtcOffset =
        summer ? 3 : 2;

    const fakeUtc =
        Date.UTC(
            year,
            month - 1,
            day,
            hour,
            minute,
            second
        );

    return Math.floor(
        fakeUtc -
        xmUtcOffset * 3600 * 1000
    / 1000);
}

// ==========================================
// CSV
// ==========================================

function parseCSVText(text) {

    const lines =
        text
            .trim()
            .split(/\r?\n/);

    const result = [];

    let startLine = 0;

    if (
        lines.length &&
        (
            lines[0].includes('Price') ||
            lines[0].includes('Datetime') ||
            lines[0].includes('Ticker')
        )
    ) {

        while (
            startLine < lines.length &&
            (
                lines[startLine].includes('Price') ||
                lines[startLine].includes('Ticker') ||
                lines[startLine].includes('Datetime')
            )
        ) {
            startLine++;
        }
    }

    for (
        let i = startLine;
        i < lines.length;
        i++
    ) {

        const line =
            lines[i].trim();

        if (!line) continue;

        const cols =
            line.split(/[,;\t]+/);

        if (cols.length < 5) {
            continue;
        }

        let sourceTs = null;

        let open = 0;
        let high = 0;
        let low = 0;
        let close = 0;
        let volume = 0;

        // ----------------------------------
        // MT5形式
        // YYYY.MM.DD,HH:MM,Open,High,Low,Close,Volume
        // ----------------------------------

        if (
            cols[0].length <= 10 &&
            cols[1] &&
            cols[1].includes(':')
        ) {

            sourceTs =
                parseDateTimeToUnix(
                    cols[0],
                    cols[1]
                );

            open =
                parseFloat(cols[2]);

            high =
                parseFloat(cols[3]);

            low =
                parseFloat(cols[4]);

            close =
                parseFloat(cols[5]);

            volume =
                cols[6]
                    ? parseFloat(cols[6])
                    : 0;

        } else {

            // ----------------------------------
            // Datetime,Close,High,Low,Open,Volume
            // ----------------------------------

            const rawDate =
                String(cols[0]).trim();

            const dateParts =
                rawDate.split(/\s+/);

            sourceTs =
                parseDateTimeToUnix(
                    dateParts[0],
                    dateParts[1] || ''
                );

            close =
                parseFloat(cols[1]);

            high =
                parseFloat(cols[2]);

            low =
                parseFloat(cols[3]);

            open =
                parseFloat(cols[4]);

            volume =
                cols[5]
                    ? parseFloat(cols[5])
                    : 0;
        }

        if (
            sourceTs !== null &&
            Number.isFinite(open) &&
            Number.isFinite(high) &&
            Number.isFinite(low) &&
            Number.isFinite(close)
        ) {

            result.push({

                /*
                 * time:
                 * Lightweight Charts用UTC Unix timestamp
                 *
                 * sourceTs:
                 * CSV元データの時刻を基準にした識別用timestamp
                 *
                 * CSVの時刻そのものを
                 * JS Dateのローカル時刻として
                 * 解釈しない。
                 */

                time: sourceTs,
                sourceTs: sourceTs,

                open: open,
                high: high,
                low: low,
                close: close,

                price: close,

                volume:
                    Number.isFinite(volume)
                        ? volume
                        : 0
            });
        }
    }

    return result;
}

function parseCSV(text) {

    allRawData =
        parseCSVText(text);

    allRawData.sort(
        (a, b) =>
            a.time - b.time
    );
}

// ==========================================
// JST入力 → UTC timestamp
// ==========================================

function parseJSTInput(value) {

    if (!value) {
        return null;
    }

    const parts =
        value.split('T');

    if (parts.length !== 2) {
        return null;
    }

    const date =
        parts[0].split('-').map(Number);

    const time =
        parts[1].split(':').map(Number);

    if (
        date.length !== 3 ||
        time.length < 2
    ) {
        return null;
    }

    return Math.floor(
        Date.UTC(
            date[0],
            date[1] - 1,
            date[2],
            time[0],
            time[1],
            time[2] || 0
        ) / 1000
    ) - 9 * 3600;
}

// ==========================================
// 指定期間ロード
// ==========================================

async function loadSelectedRange() {

    const startVal =
        document.getElementById(
            'startTime'
        ).value;

    const endVal =
        document.getElementById(
            'endTime'
        ).value;

    if (!startVal || !endVal) {

        alert(
            "開始日時と終了日時を正しく指定してください。"
        );

        return;
    }

    // 入力欄はJST
    const startTs =
        parseJSTInput(startVal);

    const endTs =
        parseJSTInput(endVal);

    if (
        startTs === null ||
        endTs === null
    ) {

        alert(
            "日時の形式が正しくありません。"
        );

        return;
    }

    if (startTs >= endTs) {

        alert(
            "終了日時は開始日時より後の時間を設定してください。"
        );

        return;
    }

    const symbolSelectEl =
        document.getElementById(
            'symbol-select'
        );

    const symbol =
        symbolSelectEl
            ? symbolSelectEl.value
            : 'XAUUSD';

    pauseReplay();
    clearTradeVisuals();

    try {

        /*
         * 指定期間の前月から読み込む。
         *
         * これにより月初でも
         * 前営業日のデータを利用できる。
         */

        const startDate =
            new Date(
                startTs * 1000
            );

        const endDate =
            new Date(
                endTs * 1000
            );

        const firstMonth =
            new Date(
                startDate.getUTCFullYear(),
                startDate.getUTCMonth() - 1,
                1
            );

        const lastMonth =
            new Date(
                endDate.getUTCFullYear(),
                endDate.getUTCMonth(),
                1
            );

        const texts = [];

        for (
            let d = new Date(firstMonth);
            d <= lastMonth;
            d.setMonth(
                d.getMonth() + 1
            )
        ) {

            const yyyy =
                d.getFullYear();

            const mm =
                String(
                    d.getMonth() + 1
                ).padStart(2, '0');

            const filePath =
                `./${symbol}/${yyyy}-${mm}.csv`;

            const response =
                await fetch(filePath);

            if (response.ok) {

                texts.push(
                    await response.text()
                );

            } else if (
                d.getTime() >=
                new Date(
                    startDate.getUTCFullYear(),
                    startDate.getUTCMonth(),
                    1
                ).getTime()
            ) {

                throw new Error(
                    `【${symbol}】のCSVデータが見つかりません:\n${filePath}`
                );
            }
        }

        allRawData = [];

        for (const text of texts) {

            const parsed =
                parseCSVText(text);

            allRawData.push(
                ...parsed
            );
        }

        allRawData.sort(
            (a, b) =>
                a.time - b.time
        );

        /*
         * ここで初めて指定期間を切る。
         *
         * startTs / endTs
         * CSVと同じUTC timestamp基準なので
         * JST表示とのズレが起きない。
         */

        const historyData =
            allRawData.filter(
                d => d.time < startTs
            );

        replayQueue =
            allRawData.filter(
                d =>
                    d.time >= startTs &&
                    d.time <= endTs
            );

        if (replayQueue.length === 0) {

            alert(
                `【${symbol}】指定の期間データがCSV内に見つかりませんでした。\n` +
                `指定: ${startVal} ～ ${endVal}\n` +
                `読み込み本数: ${allRawData.length}本`
            );

            return;
        }

        // ----------------------------------
        // チャート
        // ----------------------------------

        if (
            typeof candleSeries !== 'undefined' &&
            candleSeries
        ) {

            candleSeries.setData(
                historyData.map(d => ({
                    time: d.time,
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close
                }))
            );

            if (
                typeof volumeSeries !== 'undefined' &&
                volumeSeries
            ) {

                volumeSeries.setData(
                    historyData.map(d => ({
                        time: d.time,
                        value: d.volume,
                        color:
                            d.close >= d.open
                                ? '#1e4d3b'
                                : '#4d1e24'
                    }))
                );
            }

            if (
                typeof chart !== 'undefined' &&
                chart
            ) {

                chart.timeScale()
                    .fitContent();
            }
        }

        currentIndex = 0;

        // ----------------------------------
        // cheesecake2
        // ----------------------------------

        if (
            typeof cheesecake2Reset ===
            'function'
        ) {
            cheesecake2Reset();
        }

        if (
            typeof cheesecake2Render ===
            'function'
        ) {

            cheesecake2Render(
                historyData,
                null
            );
        }

        alert(
            `【${symbol} ロード完了】\n` +
            `過去背景データ: ${historyData.length}本\n` +
            `リプレイ再生対象: ${replayQueue.length}本`
        );

    } catch (err) {

        console.error(
            "ロードエラー:",
            err
        );

        alert(
            `データの読み込みに失敗しました:\n${err.message}`
        );
    }
}

// ==========================================
// Replay
// ==========================================

function startReplay() {

    if (replayQueue.length === 0) {

        alert(
            "リプレイデータがセットされていません。日時を指定して 'Load' を押してください。"
        );

        return;
    }

    if (replayTimer) {
        clearInterval(
            replayTimer
        );
    }

    replayTimer =
        setInterval(() => {

            if (
                currentIndex >=
                replayQueue.length
            ) {

                clearInterval(
                    replayTimer
                );

                replayTimer = null;

                alert(
                    "リプレイが終了しました。"
                );

                return;
            }

            const bar =
                replayQueue[
                    currentIndex
                ];

            if (
                typeof candleSeries !==
                    'undefined' &&
                candleSeries
            ) {

                candleSeries.update({
                    time: bar.time,
                    open: bar.open,
                    high: bar.high,
                    low: bar.low,
                    close: bar.close
                });

                if (
                    typeof volumeSeries !==
                        'undefined' &&
                    volumeSeries
                ) {

                    volumeSeries.update({
                        time: bar.time,
                        value: bar.volume,
                        color:
                            bar.close >= bar.open
                                ? '#1e4d3b'
                                : '#4d1e24'
                    });
                }
            }

            updatePriceHeader(
                bar.price
            );

            processPaperTrade(
                bar
            );

            currentIndex++;

            /*
             * 現在バーまで。
             *
             * 未来データを渡さない。
             */

            if (
                typeof cheesecake2Render ===
                'function'
            ) {

                const visibleData =
                    allRawData.filter(
                        d =>
                            d.time <=
                            bar.time
                    );

                cheesecake2Render(
                    visibleData,
                    bar.time
                );
            }

        }, replaySpeed);
}

function pauseReplay() {

    if (replayTimer) {

        clearInterval(
            replayTimer
        );

        replayTimer = null;
    }
}

function changeReplaySpeed(val) {

    replaySpeed =
        parseInt(val);

    if (replayTimer) {
        startReplay();
    }
}

// ==========================================
// Paper Order
// ==========================================

function placePaperOrder(side) {

    if (paperAccount.position) {

        alert(
            "すでにポジションを保有しています。"
        );

        return;
    }

    if (
        replayQueue.length === 0 ||
        currentIndex === 0
    ) {

        alert(
            "リプレイを開始（▶）してから注文してください。"
        );

        return;
    }

    const currentBar =
        replayQueue[
            currentIndex - 1
        ];

    paperAccount.position = {

        side: side,

        entryPrice:
            currentBar.price,

        entryTime:
            currentBar.time,

        sl: null,
        tp: null,

        qty: 1
    };

    applySLTP();

    showActiveMarker(
        currentBar.time,
        side
    );

    updateAccountUI(
        currentBar.price
    );
}

// ==========================================
// SL / TP
// ==========================================

function applySLTP() {

    if (!paperAccount.position) {
        return;
    }

    const slVal =
        parseFloat(
            document.getElementById(
                'input-sl'
            ).value
        );

    const tpVal =
        parseFloat(
            document.getElementById(
                'input-tp'
            ).value
        );

    paperAccount.position.sl =
        !isNaN(slVal)
            ? slVal
            : null;

    paperAccount.position.tp =
        !isNaN(tpVal)
            ? tpVal
            : null;

    renderSltpLines();
}

function renderSltpLines() {

    if (
        typeof candleSeries ===
            'undefined' ||
        !candleSeries ||
        typeof candleSeries.createPriceLine !==
            'function'
    ) {
        return;
    }

    if (slPriceLine) {

        try {
            candleSeries.removePriceLine(
                slPriceLine
            );
        } catch (e) {}

        slPriceLine = null;
    }

    if (tpPriceLine) {

        try {
            candleSeries.removePriceLine(
                tpPriceLine
            );
        } catch (e) {}

        tpPriceLine = null;
    }

    if (!paperAccount.position) {
        return;
    }

    const pos =
        paperAccount.position;

    if (pos.sl !== null) {

        slPriceLine =
            candleSeries.createPriceLine({

                price: pos.sl,

                color: '#ef5350',

                lineWidth: 1,

                lineStyle: 2,

                axisLabelVisible: true,

                title: 'SL'
            });
    }

    if (pos.tp !== null) {

        tpPriceLine =
            candleSeries.createPriceLine({

                price: pos.tp,

                color: '#26a69a',

                lineWidth: 1,

                lineStyle: 2,

                axisLabelVisible: true,

                title: 'TP'
            });
    }
}

// ==========================================
// Close
// ==========================================

function closePaperPosition(
    reason = 'MANUAL'
) {

    if (!paperAccount.position) {
        return;
    }

    const currentBar =
        replayQueue[
            currentIndex - 1
        ];

    if (!currentBar) {
        return;
    }

    const pos =
        paperAccount.position;

    let exitPrice =
        currentBar.price;

    if (
        reason === 'SL' &&
        pos.sl !== null
    ) {
        exitPrice = pos.sl;
    }

    if (
        reason === 'TP' &&
        pos.tp !== null
    ) {
        exitPrice = pos.tp;
    }

    const pnl =
        pos.side === 'BUY'
            ? (
                exitPrice -
                pos.entryPrice
            ) * pos.qty
            : (
                pos.entryPrice -
                exitPrice
            ) * pos.qty;

    clearMarkers();

    drawTradeLine(
        pos.entryTime,
        pos.entryPrice,
        currentBar.time,
        exitPrice,
        pnl >= 0
    );

    paperAccount.balance += pnl;

    paperAccount.position = null;

    renderSltpLines();

    updateAccountUI(
        currentBar.price
    );
}

// ==========================================
// Marker
// ==========================================

function showActiveMarker(
    time,
    side
) {

    if (
        typeof candleSeries ===
            'undefined' ||
        !candleSeries
    ) {
        return;
    }

    const marker = {

        time: time,

        position:
            side === 'BUY'
                ? 'belowBar'
                : 'aboveBar',

        color:
            side === 'BUY'
                ? '#26a69a'
                : '#ef5350',

        text:
            side === 'BUY'
                ? '▲'
                : '▼'
    };

    try {

        if (
            typeof LightweightCharts !==
                'undefined' &&
            typeof LightweightCharts.createSeriesMarkers ===
                'function'
        ) {

            LightweightCharts.createSeriesMarkers(
                candleSeries,
                [marker]
            );

        } else if (
            typeof candleSeries.setMarkers ===
                'function'
        ) {

            candleSeries.setMarkers(
                [marker]
            );
        }

    } catch (e) {}
}

function clearMarkers() {

    if (
        typeof candleSeries ===
            'undefined' ||
        !candleSeries
    ) {
        return;
    }

    try {

        if (
            typeof LightweightCharts !==
                'undefined' &&
            typeof LightweightCharts.createSeriesMarkers ===
                'function'
        ) {

            LightweightCharts.createSeriesMarkers(
                candleSeries,
                []
            );

        } else if (
            typeof candleSeries.setMarkers ===
                'function'
        ) {

            candleSeries.setMarkers(
                []
            );
        }

    } catch (e) {}
}

// ==========================================
// Trade Line
// ==========================================

function drawTradeLine(
    startTime,
    startPrice,
    endTime,
    endPrice,
    isWin
) {

    if (
        typeof chart ===
            'undefined' ||
        !chart
    ) {
        return;
    }

    const lineColor =
        isWin
            ? '#26a69a'
            : '#ef5350';

    let lineSeries = null;

    try {

        if (
            typeof LightweightCharts !==
                'undefined' &&
            LightweightCharts.LineSeries &&
            chart.addSeries
        ) {

            lineSeries =
                chart.addSeries(
                    LightweightCharts.LineSeries,
                    {
                        color: lineColor,
                        lineWidth: 2,
                        lineStyle: 2,
                        crosshairMarkerVisible: false,
                        priceLineVisible: false,
                        lastValueVisible: false
                    }
                );

        } else if (
            chart.addLineSeries
        ) {

            lineSeries =
                chart.addLineSeries({
                    color: lineColor,
                    lineWidth: 2,
                    lineStyle: 2,
                    crosshairMarkerVisible: false,
                    priceLineVisible: false,
                    lastValueVisible: false
                });
        }

    } catch (e) {}

    if (lineSeries) {

        lineSeries.setData([
            {
                time: startTime,
                value: startPrice
            },
            {
                time: endTime,
                value: endPrice
            }
        ]);

        tradeLines.push(
            lineSeries
        );
    }
}

// ==========================================
// Visual Clear
// ==========================================

function clearTradeVisuals() {

    clearMarkers();

    if (
        typeof chart !==
            'undefined' &&
        chart
    ) {

        tradeLines.forEach(
            line => {

                try {
                    chart.removeSeries(
                        line
                    );
                } catch (e) {}
            }
        );
    }

    tradeLines = [];

    renderSltpLines();
}

// ==========================================
// Paper Trade Processing
// ==========================================

function processPaperTrade(bar) {

    if (!paperAccount.position) {
        return;
    }

    const pos =
        paperAccount.position;

    if (pos.side === 'BUY') {

        if (
            pos.sl !== null &&
            bar.low <= pos.sl
        ) {

            closePaperPosition(
                'SL'
            );

            return;
        }

        if (
            pos.tp !== null &&
            bar.high >= pos.tp
        ) {

            closePaperPosition(
                'TP'
            );

            return;
        }
    }

    if (pos.side === 'SELL') {

        if (
            pos.sl !== null &&
            bar.high >= pos.sl
        ) {

            closePaperPosition(
                'SL'
            );

            return;
        }

        if (
            pos.tp !== null &&
            bar.low <= pos.tp
        ) {

            closePaperPosition(
                'TP'
            );

            return;
        }
    }

    updateAccountUI(
        bar.price
    );
}

// ==========================================
// Header
// ==========================================

function updatePriceHeader(price) {

    const $bid =
        document.getElementById(
            'bid-val'
        );

    const $ask =
        document.getElementById(
            'ask-val'
        );

    if ($bid) {
        $bid.textContent =
            price.toFixed(2);
    }

    if ($ask) {
        $ask.textContent =
            price.toFixed(2);
    }
}

// ==========================================
// Account
// ==========================================

function updateAccountUI(
    currentPrice
) {

    let unrealizedPnl = 0;

    if (paperAccount.position) {

        const pos =
            paperAccount.position;

        unrealizedPnl =
            pos.side === 'BUY'
                ? (
                    currentPrice -
                    pos.entryPrice
                ) * pos.qty
                : (
                    pos.entryPrice -
                    currentPrice
                ) * pos.qty;
    }

    const equity =
        paperAccount.balance +
        unrealizedPnl;

    const $equity =
        document.getElementById(
            'acc-equity'
        );

    const $pnl =
        document.getElementById(
            'acc-pnl'
        );

    if ($equity) {

        $equity.textContent =
            Math.round(
                equity
            ).toLocaleString();
    }

    if ($pnl) {

        $pnl.textContent =
            Math.round(
                unrealizedPnl
            ).toLocaleString();

        $pnl.className =
            'pnl-val ' +
            (
                unrealizedPnl >= 0
                    ? 'pnl-plus'
                    : 'pnl-minus'
            );
    }
}