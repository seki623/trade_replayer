// ==========================================
// TickForge cheesecake2
// Pine版 cheesecake2 の主要ライン + Daily VWAP
//
// 時刻:
//   内部timestamp = UTC Unix timestamp
//   表示/期間境界 = 日本時間
//
// Daily VWAP:
//   日本時間07:00を日次リセット基準とする。
//
// VWAP:
//   Σ(price × volume) / Σ(volume)
//   price = (High + Low + Close) / 3
//
// VWAP ± 2σ:
//   volume加重標準偏差
//
// リプレイ:
//   現在時点までのデータのみを使用。
//   将来データは使用しない。
// ==========================================

(function () {

  const JST_OFFSET = 9 * 3600;

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

  /* ==========================================
     基本
     ========================================== */

  function validBar(b) {

    return b &&
      Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close);
  }

  /*
   * UTC timestamp → JSTのDate相当値
   *
   * Dateオブジェクト自体はUTCとして扱い、
   * getUTC系でJSTカレンダーを取得する。
   */
  function jstDate(ts) {

    return new Date(
      (ts + JST_OFFSET) * 1000
    );
  }

  function keyDay(ts) {

    const d =
      jstDate(ts);

    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  }

  /*
   * 日本時間00:00
   */
  function dayStart(ts) {

    const d =
      jstDate(ts);

    const utc =
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        0,
        0,
        0,
        0
      );

    return Math.floor(
      utc / 1000
    ) - JST_OFFSET;
  }

  /*
   * 日本時間の週始まり = 月曜日00:00
   */
  function weekStart(ts) {

    const d =
      jstDate(ts);

    const day =
      d.getUTCDay();

    const diff =
      day === 0
        ? 6
        : day - 1;

    const start =
      new Date(
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
          0,
          0,
          0,
          0
        )
      );

    start.setUTCDate(
      start.getUTCDate() - diff
    );

    return Math.floor(
      start.getTime() / 1000
    ) - JST_OFFSET;
  }

  /*
   * 日本時間 月初00:00
   */
  function monthStart(ts) {

    const d =
      jstDate(ts);

    const utc =
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        1,
        0,
        0,
        0,
        0
      );

    return Math.floor(
      utc / 1000
    ) - JST_OFFSET;
  }

  /* ==========================================
     期間集計
     ========================================== */

  function buildPeriods(
    data,
    startFn,
    limit
  ) {

    const map =
      new Map();

    for (
      const b of data
    ) {

      if (
        !validBar(b)
      ) continue;

      const k =
        startFn(b.time);

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

        p.end = b.time;

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

  /* ==========================================
     ATR
     ========================================== */

  function tr(
    cur,
    prevClose
  ) {

    if (
      !Number.isFinite(
        prevClose
      )
    ) {
      return cur.h - cur.l;
    }

    return Math.max(
      cur.h - cur.l,
      Math.abs(
        cur.h - prevClose
      ),
      Math.abs(
        cur.l - prevClose
      )
    );
  }

  function atrSeries(
    days
  ) {

    if (
      !days.length
    ) return [];

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

  /* ==========================================
     Series削除
     ========================================== */

  function clearSeriesArray(
    arr
  ) {

    if (!chart) return;

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

  /* ==========================================
     水平ライン
     ========================================== */

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

              /*
               * 元コードでは
               * dotted=trueでも2だったため
               * 動作を維持。
               */
              lineStyle:
                dotted ? 2 : 2,

              crosshairMarkerVisible: false,
              priceLineVisible: false,
              lastValueVisible: false,
              visible: true
            }
          );

      } else if (
        chart.addLineSeries
      ) {

        s =
          chart.addLineSeries({
            color,
            lineWidth: 1,
            lineStyle: 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false
          });
      }

    } catch (e) {

      console.error(
        'cheesecake2 line creation error',
        e
      );

      return;
    }

    if (!s) return;

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

      if (
        LightweightCharts.createSeriesMarkers
      ) {

        LightweightCharts.createSeriesMarkers(
          s,
          [{
            time: endTime,
            position: 'inBar',
            shape: 'circle',
            color,
            text: title
          }]
        );
      }

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

  /* ==========================================
     D/W/M
     ========================================== */

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

      prev.prefix =
        prefix;

      makeLine(
        prev.start,
        cur.end,
        prev.o,
        COLORS.O,
        'P' + prefix + 'O',
        arr
      );

      makeLine(
        prev.start,
        cur.end,
        prev.h,
        COLORS.H,
        'P' + prefix + 'H',
        arr
      );

      makeLine(
        prev.start,
        cur.end,
        prev.l,
        COLORS.L,
        'P' + prefix + 'L',
        arr
      );

      makeLine(
        prev.start,
        cur.end,
        prev.c,
        COLORS.C,
        'P' + prefix + 'C',
        arr
      );
    }
  }

  function drawCurrentPeriod(
    period,
    prefix,
    arr
  ) {

    if (!period) return;

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

  /* ==========================================
     ATR
     ========================================== */

  function drawATR(
    data,
    days,
    atrs,
    arr
  ) {

    if (
      !days.length
    ) return;

    const i =
      days.length - 1;

    const d =
      days[i];

    const atr =
      atrs[i];

    if (
      !Number.isFinite(
        atr
      )
    ) return;

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
        d.start - 1,
        p.o + a,
        COLORS.ATR,
        'maxATR_u',
        arr,
        true
      );

      makeLine(
        p.start,
        d.start - 1,
        p.o - a,
        COLORS.ATR,
        'maxATR_l',
        arr,
        true
      );

      makeLine(
        p.start,
        d.start - 1,
        p.l + a,
        COLORS.ATR,
        'ATR_u',
        arr,
        true
      );

      makeLine(
        p.start,
        d.start - 1,
        p.h - a,
        COLORS.ATR,
        'ATR_l',
        arr,
        true
      );
    }

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
        days[i - 1].start - 1,
        p.o + a,
        COLORS.ATR,
        'maxATR_u',
        arr,
        true
      );

      makeLine(
        p.start,
        days[i - 1].start - 1,
        p.o - a,
        COLORS.ATR,
        'maxATR_l',
        arr,
        true
      );

      makeLine(
        p.start,
        days[i - 1].start - 1,
        p.l + a,
        COLORS.ATR,
        'ATR_u',
        arr,
        true
      );

      makeLine(
        p.start,
        days[i - 1].start - 1,
        p.h - a,
        COLORS.ATR,
        'ATR_l',
        arr,
        true
      );
    }
  }

  /* ==========================================
     Daily VWAP
     ========================================== */

  /*
   * UTC timestampを日本時間へ変換した上で
   * 日本時間07:00をセッション境界にする。
   *
   * 例:
   *
   * UTC 22:00
   * → JST 07:00
   *
   * ここが新しいVWAPセッション開始。
   */

  function getVWAPSessionStart(
    ts
  ) {

    const d =
      jstDate(ts);

    const year =
      d.getUTCFullYear();

    const month =
      d.getUTCMonth();

    const date =
      d.getUTCDate();

    /*
     * JST 07:00
     */
    let sessionUtc =
      Date.UTC(
        year,
        month,
        date,
        7,
        0,
        0,
        0
      );

    /*
     * Date.UTCの値は
     * 「JSTとして指定した07:00」を
     * UTC換算するため9時間引く。
     */
    sessionUtc -=
      JST_OFFSET * 1000;

    /*
     * 現在時刻が
     * 当日07:00より前なら
     * 前日のセッション。
     */
    if (
      ts < Math.floor(
        sessionUtc / 1000
      )
    ) {

      sessionUtc -=
        86400 * 1000;
    }

    return Math.floor(
      sessionUtc / 1000
    );
  }

  /* ==========================================
     VWAP本体
     ========================================== */

  function buildDailyVWAP(
    data
  ) {

    if (
      !data.length
    ) return [];

    const sessions =
      new Map();

    for (
      const b of data
    ) {

      if (
        !validBar(b)
      ) continue;

      const sessionStart =
        getVWAPSessionStart(
          b.time
        );

      let s =
        sessions.get(
          sessionStart
        );

      if (!s) {

        s = {
          start:
            sessionStart,
          bars: []
        };

        sessions.set(
          sessionStart,
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
      ).sort(
        (a, b) =>
          a.start - b.start
      );

    for (
      const session of
      sortedSessions
    ) {

      let sumPV = 0;
      let sumV = 0;
      let sumPV2 = 0;

      for (
        const b of session.bars
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
        ) continue;

        sumPV +=
          price * volume;

        sumV +=
          volume;

        sumPV2 +=
          price *
          price *
          volume;

        if (
          sumV <= 0
        ) continue;

        const vwap =
          sumPV / sumV;

        let variance =
          (
            sumPV2 / sumV
          ) -
          (
            vwap * vwap
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

  /* ==========================================
     VWAP Dynamic Line
     ========================================== */

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

    if (
      !clean.length
    ) return;

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
              color: color,
              lineWidth: 1,

              lineStyle:
                LightweightCharts
                  .LineStyle
                  .Solid,

              crosshairMarkerVisible: false,
              priceLineVisible: false,
              lastValueVisible: false,
              visible: true
            }
          );

      } else if (
        chart.addLineSeries
      ) {

        s =
          chart.addLineSeries({
            color: color,
            lineWidth: 1,
            lineStyle: 0,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false
          });
      }

    } catch (e) {

      console.error(
        'VWAP line creation error',
        e
      );

      return;
    }

    if (!s) return;

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
        chart.removeSeries(s);
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

    if (
      !points.length
    ) return;

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

  /* ==========================================
     Main Render
     ========================================== */

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

    const clean =
      data
        .filter(
          validBar
        )
        .sort(
          (a, b) =>
            a.time - b.time
        );

    if (
      !clean.length
    ) return;

    resetGroups();

    /* ----------------------------------------
       D/W/M
       ---------------------------------------- */

    const days =
      buildPeriods(
        clean,
        dayStart,
        MAX_DAYS
      );

    const weeks =
      buildPeriods(
        clean,
        weekStart,
        MAX_WEEKS
      );

    const months =
      buildPeriods(
        clean,
        monthStart,
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

    /* ----------------------------------------
       ATR
       ---------------------------------------- */

    const atrs =
      atrSeries(
        days
      );

    drawATR(
      clean,
      days,
      atrs,
      current.day
    );

    /* ----------------------------------------
       Daily VWAP
       ---------------------------------------- */

    drawDailyVWAP(
      clean,
      current.vwap
    );

    initialized = true;
  }

  /* ==========================================
     External
     ========================================== */

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