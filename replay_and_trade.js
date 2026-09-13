```javascript
// ==========================================
// TickForge: リプレイ & ペーパートレード制御 script
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
// 日本時間への時刻変換
// ==========================================
//
// XM等のブローカーCSV:
//   2025.07.01,01:00,...
//
// のようにタイムゾーン情報を持たないデータは、
// ブローカー時間として扱う。
//
// 夏時間:
//   ブローカー時刻 + 6時間 = 日本時間
//
// 冬時間:
//   ブローカー時刻 + 7時間 = 日本時間
//
// Yahoo Finance等:
//   2026-09-01 06:58:00-04:00
//
// のようにタイムゾーン情報を持つデータは、
// new Date() がタイムゾーンを考慮してUTC時刻へ変換するため、
// 追加補正しない。
// ==========================================

function getNthSunday(year, month, nth) {
    // month: 0 = January
    const first = new Date(year, month, 1);
    const firstDay = first.getDay(); // 0 = Sunday

    const firstSunday =
        firstDay === 0
            ? 1
            : 8 - firstDay;

    return firstSunday + (nth - 1) * 7;
}

function isJapanDisplaySummerTime(year, month, day) {
    // 3月第2日曜日
    const summerStartDay =
        getNthSunday(year, 2, 2);

    // 11月第1日曜日
    const summerEndDay =
        getNthSunday(year, 10, 1);

    const current =
        new Date(year, month - 1, day);

    const start =
        new Date(
            year,
            2,
            summerStartDay,
            0,
            0,
            0
        );

    const end =
        new Date(
            year,
            10,
            summerEndDay,
            0,
            0,
            0
        );

    return current >= start && current < end;
}

function getBrokerToJapanOffsetHours(
    year,
    month,
    day
) {
    return isJapanDisplaySummerTime(
        year,
        month,
        day
    )
        ? 6
        : 7;
}

function parseBrokerDateTimeToUnix(
    dateStr,
    timeStr
) {
    try {
        const normalizedDate =
            dateStr.replace(
                /[\.\/]/g,
                '-'
            );

        const parts =
            normalizedDate.split('-');

        if (parts.length !== 3) {
            return null;
        }

        const year =
            parseInt(parts[0], 10);

        const month =
            parseInt(parts[1], 10);

        const day =
            parseInt(parts[2], 10);

        if (
            !Number.isFinite(year) ||
            !Number.isFinite(month) ||
            !Number.isFinite(day)
        ) {
            return null;
        }

        const timeParts =
            timeStr.split(':');

        const hour =
            parseInt(timeParts[0] || '0', 10);

        const minute =
            parseInt(timeParts[1] || '0', 10);

        const second =
            parseInt(timeParts[2] || '0', 10);

        if (
            !Number.isFinite(hour) ||
            !Number.isFinite(minute) ||
            !Number.isFinite(second)
        ) {
            return null;
        }

        const offsetHours =
            getBrokerToJapanOffsetHours(
                year,
                month,
                day
            );

        // ブローカー時刻をUTCへ戻してから
        // Unix秒へ変換する。
        //
        // 例:
        // 夏時間 01:00
        // 01:00 + 6時間 = 07:00 JST
        //
        // 例:
        // 冬時間 01:00
        // 01:00 + 7時間 = 08:00 JST
        const utcMs =
            Date.UTC(
                year,
                month - 1,
                day,
                hour - offsetHours,
                minute,
                second
            );

        return Math.floor(
            utcMs / 1000
        );

    } catch (e) {
        return null;
    }
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

    // startTime / endTime は
    // ブラウザ上の日本時間として扱う。
    const startTs =
        Math.floor(
            new Date(startVal).getTime() /
            1000
        );

    const endTs =
        Math.floor(
            new Date(endVal).getTime() /
            1000
        );

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
        // ------------------------------------------
        // 開始月の1か月前から終了月まで読む。
        // 既存の読み込み仕様を維持。
        // ------------------------------------------

        const firstMonth =
            new Date(
                new Date(startVal).getFullYear(),
                new Date(startVal).getMonth() - 1,
                1
            );

        const lastMonth =
            new Date(
                new Date(endVal).getFullYear(),
                new Date(endVal).getMonth(),
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
                    new Date(startVal).getFullYear(),
                    new Date(startVal).getMonth(),
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

        // ------------------------------------------
        // 指定期間より前 = 背景履歴
        // ------------------------------------------

        const historyData =
            allRawData.filter(
                d =>
                    d.time < startTs
            );

        // ------------------------------------------
        // 指定期間内 = リプレイ対象
        // ------------------------------------------

        replayQueue =
            allRawData.filter(
                d =>
                    d.time >= startTs &&
                    d.time <= endTs
            );

        if (
            replayQueue.length === 0
        ) {
            alert(
                `【${symbol}】指定の期間データがCSV内に見つかりませんでした。`
            );

            return;
        }

        // ------------------------------------------
        // チャート背景
        // ------------------------------------------

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

        // ------------------------------------------
        // Daily OHLC / VWAP
        //
        // 指定期間内のみ。
        // 開始前データは混ぜない。
        // ------------------------------------------

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
                [],
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
// 日時文字列 → Unix
// ==========================================

function parseDateTimeToUnix(
    dateStr,
    timeStr
) {
    try {
        let fullStr =
            dateStr;

        if (timeStr) {
            fullStr +=
                ' ' + timeStr;
        }

        fullStr =
            fullStr.replace(
                /[\.\/]/g,
                '-'
            );

        const d =
            new Date(fullStr);

        if (
            !isNaN(
                d.getTime()
            )
        ) {
            return Math.floor(
                d.getTime() / 1000
            );
        }
    } catch (e) {}

    return null;
}


// ==========================================
// CSV解析
// ==========================================

function parseCSVText(text) {
    const lines =
        text.trim().split('\n');

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
            line.split(
                /[,;\t]+/
            );

        if (
            cols.length < 5
        ) {
            continue;
        }

        let unixSec = null;

        let open = 0;
        let high = 0;
        let low = 0;
        let close = 0;
        let volume = 0;

        // ------------------------------------------
        // XM等:
        //
        // 2025.07.01,23:56,3339.08,...
        //
        // タイムゾーンなし。
        // ブローカー時間として日本時間へ変換。
        // ------------------------------------------

        if (
            cols[0].length <= 10 &&
            cols[1] &&
            cols[1].includes(':')
        ) {
            unixSec =
                parseBrokerDateTimeToUnix(
                    cols[0],
                    cols[1]
                );

            open =
                parseFloat(
                    cols[2]
                );

            high =
                parseFloat(
                    cols[3]
                );

            low =
                parseFloat(
                    cols[4]
                );

            close =
                parseFloat(
                    cols[5]
                );

            volume =
                cols[6]
                    ? parseFloat(
                        cols[6]
                    )
                    : 0;

        } else {

            // --------------------------------------
            // Yahoo Finance等:
            //
            // 2026-09-01 06:58:00-04:00,...
            //
            // タイムゾーン情報を持っている場合は
            // Date() にそのまま渡す。
            // --------------------------------------

            unixSec =
                parseDateTimeToUnix(
                    cols[0]
                );

            close =
                parseFloat(
                    cols[1]
                );

            high =
                parseFloat(
                    cols[2]
                );

            low =
                parseFloat(
                    cols[3]
                );

            open =
                parseFloat(
                    cols[4]
                );

            volume =
                cols[5]
                    ? parseFloat(
                        cols[5]
                    )
                    : 0;
        }

        if (
            unixSec &&
            !isNaN(close) &&
            !isNaN(open) &&
            !isNaN(high) &&
            !isNaN(low)
        ) {
            result.push({
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

    return result;
}


// ==========================================
// 既存CSV解析
// ==========================================

function parseCSV(text) {
    allRawData =
        parseCSVText(text);

    allRawData.sort(
        (a, b) =>
            a.time - b.time
    );
}


// ==========================================
// リプレイ開始
// ==========================================

function startReplay() {
    if (
        replayQueue.length === 0
    ) {
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
                typeof candleSeries !== 'undefined' &&
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
                    typeof volumeSeries !== 'undefined' &&
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

            // --------------------------------------
            // 現在までに確定した
            // 指定期間内のM1だけ。
            // --------------------------------------

            const visibleReplayData =
                replayQueue.slice(
                    0,
                    currentIndex
                );

            if (
                typeof cheesecake2Render ===
                'function'
            ) {
                cheesecake2Render(
                    visibleReplayData,
                    bar.time
                );
            }

        }, replaySpeed);
}


// ==========================================
// リプレイ停止
// ==========================================

function pauseReplay() {
    if (replayTimer) {
        clearInterval(
            replayTimer
        );

        replayTimer = null;
    }
}


// ==========================================
// 再生速度変更
// ==========================================

function changeReplaySpeed(val) {
    replaySpeed =
        parseInt(val);

    if (replayTimer) {
        startReplay();
    }
}


// ==========================================
// Paper Trade
// ==========================================

function placePaperOrder(side) {
    if (
        paperAccount.position
    ) {
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
    if (
        !paperAccount.position
    ) {
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
        typeof candleSeries === 'undefined' ||
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

    if (
        !paperAccount.position
    ) {
        return;
    }

    const pos =
        pa
```
