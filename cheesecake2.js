// ==========================================
// TickForge cheesecake2
//
// D/W/M OHLC
// ATR
// Daily VWAP ±2σ
//
// 時間仕様
// ------------------------------------------
// CSV:
//   XMサーバー時間
//
// 表示:
//   日本時間
//
// 営業日:
//   夏時間 → JST 07:00開始
//   冬時間 → JST 08:00開始
//
// CSV内部では
//   夏時間 → XM 01:00開始
//   冬時間 → XM 00:00開始
//
// D/W/M OHLC、ATR、Daily VWAPは
// すべて同じ営業日セッション境界を使用。
// ==========================================

(function () {

    const MAX_DAYS = 40;
    const MAX_WEEKS = 20;
    const MAX_MONTHS = 12;

    const COLORS = {

        O: '#26a69a',
        H: '#2962ff',
        L: '#ef5350',
        C: '#ffff00',
        ATR: '#ff00ff',

        VWAP: '#ffffff',
        VWAP_UPPER: '#aaaaaa',
        VWAP_LOWER: '#aaaaaa'
    };

    const VWAP_SIGMA = 2;

    let groups = {
        day: [],
        week: [],
        month: [],
        vwap: []
    };

    let current = {
        day: [],
        week: [],
        month: [],
        vwap: []
    };

    let initialized = false;

    // ======================================
    // 基本
    // ======================================

    function validBar(b) {

        return b &&
            Number.isFinite(b.time) &&
            Number.isFinite(b.open) &&
            Number.isFinite(b.high) &&
            Number.isFinite(b.low) &&
            Number.isFinite(b.close);
    }

    // ======================================
    // 夏時間判定
    // ======================================

    function isLastSunday(
        year,
        month,
        date
    ) {

        const d =
            new Date(
                year,
                month,
                date
            );

        return (
            d.getDay() === 0 &&
            date + 7 >
            new Date(
                year,
                month + 1,
                0
            ).getDate()
        );
    }

    function isXMSummerTime(
        sourceTs
    ) {

        const d =
            new Date(
                sourceTs * 1000
            );

        /*
         * sourceTsはUTC timestamp。
         *
         * まずUTC日付を使って
         * 年月日を取得する。
         */

        const year =
            d.getUTCFullYear();

        const month =
            d.getUTCMonth();

        const day =
            d.getUTCDate();

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

        /*
         * XMサーバー時間基準の
         * 夏時間期間。
         *
         * 日付境界付近の細かいDST切替は
         * セッション境界判定では
         * 日付基準として扱う。
         */

        const monthNumber =
            month + 1;

        if (
            monthNumber > 3 &&
            monthNumber < 10
        ) {
            return true;
        }

        if (
            monthNumber < 3 ||
            monthNumber > 10
        ) {
            return false;
        }

        if (monthNumber === 3) {

            return (
                day >=
                marchLastSunday
            );
        }

        if (monthNumber === 10) {

            return (
                day <
                octoberLastSunday
            );
        }

        return false;
    }

    // ======================================
    // CSV上の営業日境界
    // ======================================
    //
    // 夏:
    //   XM 01:00
    //
    // 冬:
    //   XM 00:00
    //
    // sourceTsはUTC timestampだが、
    // そのtimestampをXM時間の日付として
    // 扱うための補助関数。

    function getXMDateParts(
        sourceTs
    ) {

        const d =
            new Date(
                sourceTs * 1000
            );

        const summer =
            isXMSummerTime(
                sourceTs
            );

        const offset =
            summer
                ? 3
                : 2;

        /*
         * UTC → XM
         */

        const xmMs =
            d.getTime() +
            offset * 3600 * 1000;

        const xm =
            new Date(xmMs);

        return {
            year: xm.getUTCFullYear(),
            month: xm.getUTCMonth(),
            day: xm.getUTCDate(),
            hour: xm.getUTCHours(),
            minute: xm.getUTCMinutes()
        };
    }

    // ======================================
    // Daily Session Start
    // ======================================

    function dailySessionStart(
        sourceTs
    ) {

        const p =
            getXMDateParts(
                sourceTs
            );

        /*
         * 夏:
         *   01:00開始
         *
         * 冬:
         *   00:00開始
         */

        const summer =
            isXMSummerTime(
                sourceTs
            );

        const openHour =
            summer ? 1 : 0;

        /*
         * 現在のXM日付で
         * セッション開始時刻を作る。
         */

        let y = p.year;
        let m = p.month;
        let d = p.day;

        /*
         * 開場前なら前日のセッション。
         */

        if (p.hour < openHour) {

            const prev =
                new Date(
                    Date.UTC(
                        y,
                        m,
                        d - 1
                    )
                );

            y =
                prev.getUTCFullYear();

            m =
                prev.getUTCMonth();

            d =
                prev.getUTCDate();
        }

        /*
         * XM時間 → UTC
         */

        const sessionUtc =
            Date.UTC(
                y,
                m,
                d,
                openHour,
                0,
                0
            ) -
            (
                summer
                    ? 3
                    : 2
            ) * 3600 * 1000;

        return Math.floor(
            sessionUtc / 1000
        );
    }

    // ======================================
    // セッションキー
    // ======================================

    function sessionKey(
        sourceTs
    ) {

        return dailySessionStart(
            sourceTs
        );
    }

    // ======================================
    // D/W/Mキー
    // ======================================

    function getSessionDate(
        sourceTs
    ) {

        const start =
            dailySessionStart(
                sourceTs
            );

        const d =
            new Date(
                start * 1000
            );

        /*
         * セッション開始日の
         * JST年月日ではなく、
         * セッションそのものの日付を使う。
         */

        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth(),
            day: d.getUTCDate()
        };
    }

    function dayKey(
        sourceTs
    ) {

        return dailySessionStart(
            sourceTs
        );
    }

    function weekKey(
        sourceTs
    ) {

        const s =
            dailySessionStart(
                sourceTs
            );

        const d =
            new Date(
                s * 1000
            );

        const day =
            d.getUTCDay();

        const diff =
            day === 0
                ? 6
                : day - 1;

        return Math.floor(
            (
                Date.UTC(
                    d.getUTCFullYear(),
                    d.getUTCMonth(),
                    d.getUTCDate() - diff
                )
            ) / 1000
        );
    }

    function monthKey(
        sourceTs
    ) {

        const s =
            dailySessionStart(
                sourceTs
            );

        const d =
            new Date(
                s * 1000
            );

        return Math.floor(
            Date.UTC(
                d.getUTCFullYear(),
                d.getUTCMonth(),
                1
            ) / 1000
        );
    }

    // ======================================
    // 期間集計
    // ======================================

    function buildPeriods(
        data,
        keyFn,
        limit
    ) {

        const map =
            new Map();

        for (const b of data) {

            if (!validBar(b)) {
                continue;
            }

            const k =
                keyFn(b.time);

            let p =
                map.get(k);

            if (!p) {

                p = {

                    start: k,

                    end: b.time,

                    o: b.open,

                    h: b.high,

                    l: b.low,

                    c: b.close
                };

                map.set(
                    k,
                    p
                );

            } else {

                p.end =
                    b.time;

                p.h =
                    Math.max(
                        p.h,
                        b.high
                    );

                p.l =
                    Math.min(
                        p.l,
                        b.low
                    );

                p.c =
                    b.close;
            }
        }

        return Array.from(
            map.values()
        )
        .sort(
            (a, b) =>
                a.start - b.start
        )
        .slice(-limit);
    }

    // ======================================
    // ATR
    // ======================================

    function tr(
        cur,
        prevClose
    ) {

        if (
            !Number.isFinite(
                prevClose
            )
        ) {

            return (
                cur.h -
                cur.l
            );
        }

        return Math.max(

            cur.h - cur.l,

            Math.abs(
                cur.h -
                prevClose
            ),

            Math.abs(
                cur.l -
                prevClose
            )
        );
    }

    function atrSeries(
        days
    ) {

        if (!days.length) {
            return [];
        }

        const out = [];

        let atr = NaN;
        let sum = 0;
        let count = 0;

        for (
            let i = 0;
            i < days.length;
            i++
        ) {

            const prevC =
                i > 0
                    ? days[i - 1].c
                    : NaN;

            const value =
                tr(
                    days[i],
                    prevC
                );

            if (
                !Number.isFinite(
                    atr
                )
            ) {

                sum += value;

                count++;

                if (
                    count >= 5
                ) {

                    atr =
                        sum / 5;
                }

            } else {

                atr =
                    (
                        atr * 4 +
                        value
                    ) / 5;
            }

            out.push(
                atr
            );
        }

        return out;
    }

    // ======================================
    // Series削除
    // ======================================

    function clearSeriesArray(
        arr
    ) {

        if (!chart) {
            return;
        }

        for (
            const item of arr
        ) {

            try {

                chart.removeSeries(
                    item.series
                );

            } catch (e) {}
        }

        arr.length = 0;
    }

    function resetGroups() {

        clearSeriesArray(
            groups.day
        );

        clearSeriesArray(
            groups.week
        );

        clearSeriesArray(
            groups.month
        );

        clearSeriesArray(
            groups.vwap
        );

        clearSeriesArray(
            current.day
        );

        clearSeriesArray(
            current.week
        );

        clearSeriesArray(
            current.month
        );

        clearSeriesArray(
            current.vwap
        );

        groups = {
            day: [],
            week: [],
            month: [],
            vwap: []
        };

        current = {
            day: [],
            week: [],
            month: [],
            vwap: []
        };

        initialized = false;
    }

    // ======================================
    // Line
    // ======================================

    function makeLine(
        startTime,
        endTime,
        price,
        color,
        title,
        arr,
        dotted = false
    ) {

        if (
            !chart ||
            !Number.isFinite(price) ||
            !Number.isFinite(startTime) ||
            !Number.isFinite(endTime)
        ) {
            return;
        }

        if (
            endTime <= startTime
        ) {

            endTime =
                startTime + 1;
        }

        let s = null;

        try {

            if (
                LightweightCharts.LineSeries &&
                chart.addSeries
            ) {

                s =
                    chart.addSeries(
                        LightweightCharts.LineSeries,
                        {

                            color,

                            lineWidth: 1,

                            lineStyle:
                                dotted
                                    ? 2
                                    : 0,

                            crosshairMarkerVisible:
                                false,

                            priceLineVisible:
                                false,

                            lastValueVisible:
                                false,

                            visible:
                                true
                        }
                    );

            } else if (
                chart.addLineSeries
            ) {

                s =
                    chart.addLineSeries({

                        color,

                        lineWidth: 1,

                        lineStyle:
                            dotted
                                ? 2
                                : 0,

                        crosshairMarkerVisible:
                            false,

                        priceLineVisible:
                            false,

                        lastValueVisible:
                            false
                    });
            }

        } catch (e) {

            console.error(
                'cheesecake2 line creation error',
                e
            );

            return;
        }

        if (!s) {
            return;
        }

        try {

            s.setData([
                {
                    time: startTime,
                    value: price
                },
                {
                    time: endTime,
                    value: price
                }
            ]);

        } catch (e) {

            try {
                chart.removeSeries(s);
            } catch (_) {}

            return;
        }

        arr.push({

            series: s,

            title
        });
    }

    // ======================================
    // D/W/M History
    // ======================================

    function drawHistory(
        periods,
        arr,
        prefix
    ) {

        for (
            let i = 1;
            i < periods.length;
            i++
        ) {

            const prev =
                periods[i - 1];

            const cur =
                periods[i];

            /*
             * 前期間の終端は、
             * その期間に存在した最後のバー。
             *
             * つまり実際の閉場まで。
             */

            makeLine(
                prev.start,
                prev.end,
                prev.o,
                COLORS.O,
                'P' + prefix + 'O',
                arr
            );

            makeLine(
                prev.start,
                prev.end,
                prev.h,
                COLORS.H,
                'P' + prefix + 'H',
                arr
            );

            makeLine(
                prev.start,
                prev.end,
                prev.l,
                COLORS.L,
                'P' + prefix + 'L',
                arr
            );

            makeLine(
                prev.start,
                prev.end,
                prev.c,
                COLORS.C,
                'P' + prefix + 'C',
                arr
            );
        }
    }

    // ======================================
    // Current Period
    // ======================================

    function drawCurrentPeriod(
        period,
        prefix,
        arr
    ) {

        if (!period) {
            return;
        }

        makeLine(
            period.start,
            period.end,
            period.o,
            COLORS.O,
            prefix + 'O',
            arr
        );

        makeLine(
            period.start,
            period.end,
            period.h,
            COLORS.H,
            prefix + 'H',
            arr
        );

        makeLine(
            period.start,
            period.end,
            period.l,
            COLORS.L,
            prefix + 'L',
            arr
        );
    }

    // ======================================
    // ATR
    // ======================================

    function drawATR(
        days,
        atrs,
        arr
    ) {

        if (!days.length) {
            return;
        }

        const i =
            days.length - 1;

        const d =
            days[i];

        const atr =
            atrs[i];

        if (
            !Number.isFinite(atr)
        ) {
            return;
        }

        makeLine(
            d.start,
            d.end,
            d.o + atr,
            COLORS.ATR,
            'maxATR_u',
            arr,
            true
        );

        makeLine(
            d.start,
            d.end,
            d.o - atr,
            COLORS.ATR,
            'maxATR_l',
            arr,
            true
        );

        makeLine(
            d.start,
            d.end,
            d.l + atr,
            COLORS.ATR,
            'ATR_u',
            arr,
            true
        );

        makeLine(
            d.start,
            d.end,
            d.h - atr,
            COLORS.ATR,
            'ATR_l',
            arr,
            true
        );

        // ----------------------------------
        // 前日
        // ----------------------------------

        if (
            i >= 1 &&
            Number.isFinite(
                atrs[i - 1]
            )
        ) {

            const p =
                days[i - 1];

            const a =
                atrs[i - 1];

            makeLine(
                p.start,
                p.end,
                p.o + a,
                COLORS.ATR,
                'maxATR_u',
                arr,
                true
            );

            makeLine(
                p.start,
                p.end,
                p.o - a,
                COLORS.ATR,
                'maxATR_l',
                arr,
                true
            );

            makeLine(
                p.start,
                p.end,
                p.l + a,
                COLORS.ATR,
                'ATR_u',
                arr,
                true
            );

            makeLine(
                p.start,
                p.end,
                p.h - a,
                COLORS.ATR,
                'ATR_l',
                arr,
                true
            );
        }

        // ----------------------------------
        // 前々日
        // ----------------------------------

        if (
            i >= 2 &&
            Number.isFinite(
                atrs[i - 2]
            )
        ) {

            const p =
                days[i - 2];

            const a =
                atrs[i - 2];

            makeLine(
                p.start,
                p.end,
                p.o + a,
                COLORS.ATR,
                'maxATR_u',
                arr,
                true
            );

            makeLine(
                p.start,
                p.end,
                p.o - a,
                COLORS.ATR,
                'maxATR_l',
                arr,
                true
            );

            makeLine(
                p.start,
                p.end,
                p.l + a,
                COLORS.ATR,
                'ATR_u',
                arr,
                true
            );

            makeLine(
                p.start,
                p.end,
                p.h - a,
                COLORS.ATR,
                'ATR_l',
                arr,
                true
            );
        }
    }

    // ======================================
    // Daily VWAP
    // ======================================

    function buildDailyVWAP(
        data
    ) {

        if (!data.length) {
            return [];
        }

        const sessions =
            new Map();

        for (
            const b of data
        ) {

            if (!validBar(b)) {
                continue;
            }

            const start =
                dailySessionStart(
                    b.time
                );

            let s =
                sessions.get(
                    start
                );

            if (!s) {

                s = {

                    start,

                    bars: []
                };

                sessions.set(
                    start,
                    s
                );
            }

            s.bars.push(
                b
            );
        }

        const output = [];

        const sortedSessions =
            Array.from(
                sessions.values()
            )
            .sort(
                (a, b) =>
                    a.start -
                    b.start
            );

        for (
            const session
            of sortedSessions
        ) {

            let sumPV = 0;
            let sumV = 0;
            let sumPV2 = 0;

            for (
                const b
                of session.bars
            ) {

                /*
                 * Typical Price
                 */

                const price =
                    (
                        b.high +
                        b.low +
                        b.close
                    ) / 3;

                const volume =
                    Number.isFinite(
                        b.volume
                    ) &&
                    b.volume > 0
                        ? b.volume
                        : 0;

                if (
                    volume <= 0
                ) {
                    continue;
                }

                sumPV +=
                    price *
                    volume;

                sumV +=
                    volume;

                sumPV2 +=
                    price *
                    price *
                    volume;

                if (
                    sumV <= 0
                ) {
                    continue;
                }

                const vwap =
                    sumPV /
                    sumV;

                let variance =
                    (
                        sumPV2 /
                        sumV
                    ) -
                    (
                        vwap *
                        vwap
                    );

                if (
                    variance < 0
                ) {
                    variance = 0;
                }

                const sigma =
                    Math.sqrt(
                        variance
                    );

                output.push({

                    time: b.time,

                    vwap,

                    upper:
                        vwap +
                        VWAP_SIGMA *
                        sigma,

                    lower:
                        vwap -
                        VWAP_SIGMA *
                        sigma
                });
            }
        }

        return output;
    }

    // ======================================
    // VWAP Line
    // ======================================

    function makeDynamicLine(
        points,
        valueKey,
        color,
        title,
        arr
    ) {

        if (
            !chart ||
            !points ||
            points.length < 1
        ) {
            return;
        }

        const clean =
            points.filter(
                p =>
                    Number.isFinite(
                        p.time
                    ) &&
                    Number.isFinite(
                        p[valueKey]
                    )
            );

        if (!clean.length) {
            return;
        }

        let s = null;

        try {

            if (
                LightweightCharts.LineSeries &&
                chart.addSeries
            ) {

                s =
                    chart.addSeries(
                        LightweightCharts.LineSeries,
                        {

                            color,

                            lineWidth: 1,

                            lineStyle:
                                LightweightCharts.LineStyle
                                    ? LightweightCharts.LineStyle.Solid
                                    : 0,

                            crosshairMarkerVisible:
                                false,

                            priceLineVisible:
                                false,

                            lastValueVisible:
                                false,

                            visible:
                                true
                        }
                    );

            } else if (
                chart.addLineSeries
            ) {

                s =
                    chart.addLineSeries({

                        color,

                        lineWidth: 1,

                        lineStyle: 0,

                        crosshairMarkerVisible:
                            false,

                        priceLineVisible:
                            false,

                        lastValueVisible:
                            false
                    });
            }

        } catch (e) {

            console.error(
                'VWAP line creation error',
                e
            );

            return;
        }

        if (!s) {
            return;
        }

        try {

            s.setData(
                clean.map(
                    p => ({
                        time: p.time,
                        value:
                            p[valueKey]
                    })
                )
            );

        } catch (e) {

            try {
                chart.removeSeries(
                    s
                );
            } catch (_) {}

            return;
        }

        arr.push({

            series: s,

            title
        });
    }

    function drawDailyVWAP(
        data,
        arr
    ) {

        const points =
            buildDailyVWAP(
                data
            );

        if (!points.length) {
            return;
        }

        makeDynamicLine(
            points,
            'vwap',
            COLORS.VWAP,
            'Daily VWAP',
            arr
        );

        makeDynamicLine(
            points,
            'upper',
            COLORS.VWAP_UPPER,
            'VWAP +2σ',
            arr
        );

        makeDynamicLine(
            points,
            'lower',
            COLORS.VWAP_LOWER,
            'VWAP -2σ',
            arr
        );
    }

    // ======================================
    // Render
    // ======================================

    function render(
        data,
        currentTs
    ) {

        if (
            !Array.isArray(data) ||
            !chart
        ) {
            return;
        }

        /*
         * 念のため時系列順にする。
         */

        const clean =
            data
                .filter(validBar)
                .sort(
                    (a, b) =>
                        a.time -
                        b.time
                );

        if (!clean.length) {
            return;
        }

        resetGroups();

        // ----------------------------------
        // D/W/M
        // ----------------------------------

        const days =
            buildPeriods(
                clean,
                dayKey,
                MAX_DAYS
            );

        const weeks =
            buildPeriods(
                clean,
                weekKey,
                MAX_WEEKS
            );

        const months =
            buildPeriods(
                clean,
                monthKey,
                MAX_MONTHS
            );

        drawHistory(
            days,
            groups.day,
            'D'
        );

        drawHistory(
            weeks,
            groups.week,
            'W'
        );

        drawHistory(
            months,
            groups.month,
            'M'
        );

        drawCurrentPeriod(
            days[
                days.length - 1
            ],
            'D',
            current.day
        );

        drawCurrentPeriod(
            weeks[
                weeks.length - 1
            ],
            'W',
            current.week
        );

        drawCurrentPeriod(
            months[
                months.length - 1
            ],
            'M',
            current.month
        );

        // ----------------------------------
        // ATR
        // ----------------------------------

        const atrs =
            atrSeries(
                days
            );

        drawATR(
            days,
            atrs,
            current.day
        );

        // ----------------------------------
        // Daily VWAP ±2σ
        // ----------------------------------

        drawDailyVWAP(
            clean,
            current.vwap
        );

        initialized = true;
    }

    // ======================================
    // 外部公開
    // ======================================

    window.cheesecake2Reset =
        resetGroups;

    window.cheesecake2Render =
        render;

    window.addEventListener(
        'DOMContentLoaded',
        () => {
            initialized = false;
        }
    );

})();