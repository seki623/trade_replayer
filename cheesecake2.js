// ==========================================
// TickForge cheesecake2
// Pine版 cheesecake2 の主要ラインをリプレイデータへ同期
//
// Daily:
//   M1データ間の時間差 >= 60分をDaily境界として検出。
//   Daily OHLC / Daily VWAP は同じDaily期間を共有する。
//
// Daily VWAP:
//   Price = HLC3
//   VWAP = Σ(Price × Volume) / Σ(Volume)
//   ±2σ = VWAP ± 2 × weighted standard deviation
// ==========================================
(function () {
  const MAX_DAYS = 40;
  const MAX_WEEKS = 20;
  const MAX_MONTHS = 12;

  const DAILY_GAP_MINUTES = 60;
  const DAILY_GAP_SECONDS = DAILY_GAP_MINUTES * 60;

  const COLORS = {
    O: '#26a69a',
    H: '#2962ff',
    L: '#ef5350',
    C: '#ffff00',
    ATR: '#ff00ff',
    VWAP: '#ffffff',
    VWAP_BAND: '#ffffff'
  };

  let groups = { day: [], week: [], month: [] };
  let current = { day: [], week: [], month: [] };
  let initialized = false;

  function validBar(b) {
    return b &&
      Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close);
  }

  function dayStart(ts) {
    const d = new Date(ts * 1000);
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }

  function weekStart(ts) {
    const d = new Date(ts * 1000);
    d.setHours(0, 0, 0, 0);

    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;

    d.setDate(d.getDate() - diff);

    return Math.floor(d.getTime() / 1000);
  }

  function monthStart(ts) {
    const d = new Date(ts * 1000);

    d.setDate(1);
    d.setHours(0, 0, 0, 0);

    return Math.floor(d.getTime() / 1000);
  }

  // ==========================================
  // Daily Boundary Detection
  //
  // Daily判定は固定時刻ではなく、
  // M1データ間の時間差だけで判断する。
  //
  // 指定期間の最初のM1 = Daily開始
  // 前M1 → 次M1 が60分以上 = 新しいDaily開始
  // ==========================================
  function detectDailyPeriods(data) {
    const clean = data
      .filter(validBar)
      .sort((a, b) => a.time - b.time);

    if (!clean.length) return [];

    const periods = [];

    let period = {
      start: clean[0].time,
      end: clean[0].time,
      o: clean[0].open,
      h: clean[0].high,
      l: clean[0].low,
      c: clean[0].close,
      bars: [clean[0]]
    };

    for (let i = 1; i < clean.length; i++) {
      const prev = clean[i - 1];
      const bar = clean[i];

      const gapSeconds = bar.time - prev.time;

      if (gapSeconds >= DAILY_GAP_SECONDS) {
        periods.push(period);

        period = {
          start: bar.time,
          end: bar.time,
          o: bar.open,
          h: bar.high,
          l: bar.low,
          c: bar.close,
          bars: [bar]
        };

        console.log(
          'Daily boundary detected',
          'previous =', formatDebugTime(prev.time),
          'current =', formatDebugTime(bar.time),
          'gap =', Math.round(gapSeconds / 60), 'minutes'
        );

        continue;
      }

      period.end = bar.time;
      period.h = Math.max(period.h, bar.high);
      period.l = Math.min(period.l, bar.low);
      period.c = bar.close;
      period.bars.push(bar);
    }

    periods.push(period);

    return periods.slice(-MAX_DAYS);
  }

  function formatDebugTime(ts) {
    try {
      return new Date(ts * 1000).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour12: false
      });
    } catch (e) {
      return new Date(ts * 1000).toISOString();
    }
  }

  // ==========================================
  // Calendar-based periods
  //
  // Weekly / Monthlyは既存仕様を維持。
  // DailyだけはdetectDailyPeriods()を使用。
  // ==========================================
  function buildCalendarPeriods(data, startFn, limit) {
    const map = new Map();

    for (const b of data) {
      if (!validBar(b)) continue;

      const k = startFn(b.time);

      let p = map.get(k);

      if (!p) {
        p = {
          start: k,
          end: b.time,
          o: b.open,
          h: b.high,
          l: b.low,
          c: b.close
        };

        map.set(k, p);
      } else {
        p.end = b.time;
        p.h = Math.max(p.h, b.high);
        p.l = Math.min(p.l, b.low);
        p.c = b.close;
      }
    }

    return Array.from(map.values())
      .sort((a, b) => a.start - b.start)
      .slice(-limit);
  }

  function tr(cur, prevClose) {
    if (!Number.isFinite(prevClose)) {
      return cur.h - cur.l;
    }

    return Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prevClose),
      Math.abs(cur.l - prevClose)
    );
  }

  // ==========================================
  // ta.atr(5) に対応する Wilder RMA
  // Daily境界で生成したDailyデータを使用。
  // ==========================================
  function atrSeries(days) {
    if (!days.length) return [];

    const out = [];

    let atr = NaN;
    let sum = 0;
    let count = 0;

    for (let i = 0; i < days.length; i++) {
      const prevC = i > 0 ? days[i - 1].c : NaN;
      const value = tr(days[i], prevC);

      if (!Number.isFinite(atr)) {
        sum += value;
        count++;

        if (count >= 5) {
          atr = sum / 5;
        }
      } else {
        atr = (atr * 4 + value) / 5;
      }

      out.push(atr);
    }

    return out;
  }

  // ==========================================
  // HLC3
  //
  // 現在提示されているコードには既存VWAP価格定義が
  // 存在しないため、Daily VWAPではHLC3を使用。
  // ==========================================
  function vwapPrice(bar) {
    return (bar.high + bar.low + bar.close) / 3;
  }

  // ==========================================
  // Daily VWAP
  //
  // Daily boundaryごとに累積をリセット。
  //
  // VWAP = Σ(price × volume) / Σ(volume)
  //
  // σ = sqrt(
  //       Σ(volume × (price - VWAP)^2)
  //       / Σ(volume)
  //     )
  //
  // VWAP ± 2σ
  // ==========================================
  function calculateDailyVWAP(period) {
    if (!period || !Array.isArray(period.bars) || !period.bars.length) {
      return [];
    }

    let sumPV = 0;
    let sumVolume = 0;
    let sumPV2 = 0;

    const result = [];

    for (const bar of period.bars) {
      const price = vwapPrice(bar);

      let volume = Number(bar.volume);

      if (!Number.isFinite(volume) || volume < 0) {
        volume = 0;
      }

      if (volume > 0) {
        sumPV += price * volume;
        sumPV2 += price * price * volume;
        sumVolume += volume;
      }

      if (sumVolume > 0) {
        const vwap = sumPV / sumVolume;

        let variance = (sumPV2 / sumVolume) - (vwap * vwap);

        if (variance < 0 && variance > -1e-10) {
          variance = 0;
        }

        const sigma = Math.sqrt(Math.max(0, variance));

        result.push({
          time: bar.time,
          vwap: vwap,
          upper2: vwap + sigma * 2,
          lower2: vwap - sigma * 2
        });
      } else {
        result.push({
          time: bar.time,
          vwap: NaN,
          upper2: NaN,
          lower2: NaN
        });
      }
    }

    return result;
  }

  // ==========================================
  // Line Series helpers
  // ==========================================
  function clearSeriesArray(arr) {
    if (typeof chart === 'undefined' || !chart) {
      arr.length = 0;
      return;
    }

    for (const s of arr) {
      try {
        chart.removeSeries(s.series);
      } catch (e) {}
    }

    arr.length = 0;
  }

  function resetGroups() {
    clearSeriesArray(groups.day);
    clearSeriesArray(groups.week);
    clearSeriesArray(groups.month);

    clearSeriesArray(current.day);
    clearSeriesArray(current.week);
    clearSeriesArray(current.month);

    groups = {
      day: [],
      week: [],
      month: []
    };

    current = {
      day: [],
      week: [],
      month: []
    };

    initialized = false;
  }

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
      typeof chart === 'undefined' ||
      !chart ||
      !Number.isFinite(price) ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime)
    ) {
      return null;
    }

    if (endTime <= startTime) {
      endTime = startTime + 1;
    }

    let s = null;

    try {
      if (
        typeof LightweightCharts !== 'undefined' &&
        LightweightCharts.LineSeries &&
        chart.addSeries
      ) {
        s = chart.addSeries(
          LightweightCharts.LineSeries,
          {
            color,
            lineWidth: 1,
            lineStyle: dotted ? 2 : 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            visible: true
          }
        );
      } else if (chart.addLineSeries) {
        s = chart.addLineSeries({
          color,
          lineWidth: 1,
          lineStyle: 2,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false
        });
      }
    } catch (e) {
      console.error('cheesecake2 line creation error', e);
      return null;
    }

    if (!s) return null;

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

      return null;
    }

    arr.push({
      series: s,
      title
    });

    return s;
  }

  // ==========================================
  // History OHLC
  // ==========================================
  function drawHistory(periods, arr, prefix) {
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i - 1];
      const cur = periods[i];

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

  // ==========================================
  // Current OHLC
  // ==========================================
  function drawCurrentPeriod(period, prefix, arr) {
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

  // ==========================================
  // Daily VWAP / ±2σ
  //
  // 現在のDaily期間のみ描画。
  // M1が進むたびに再計算されるため動的に変化する。
  // ==========================================
  function drawDailyVWAP(period, arr) {
    if (!period || !period.bars || !period.bars.length) {
      return;
    }

    const values = calculateDailyVWAP(period);

    if (!values.length) return;

    const vwapData = [];
    const upperData = [];
    const lowerData = [];

    for (const v of values) {
      if (!Number.isFinite(v.vwap)) continue;

      vwapData.push({
        time: v.time,
        value: v.vwap
      });

      upperData.push({
        time: v.time,
        value: v.upper2
      });

      lowerData.push({
        time: v.time,
        value: v.lower2
      });
    }

    if (!vwapData.length) return;

    let vwapSeries = null;
    let upperSeries = null;
    let lowerSeries = null;

    try {
      if (
        typeof LightweightCharts !== 'undefined' &&
        LightweightCharts.LineSeries &&
        chart.addSeries
      ) {
        vwapSeries = chart.addSeries(
          LightweightCharts.LineSeries,
          {
            color: COLORS.VWAP,
            lineWidth: 2,
            lineStyle: 0,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            visible: true
          }
        );

        upperSeries = chart.addSeries(
          LightweightCharts.LineSeries,
          {
            color: COLORS.VWAP_BAND,
            lineWidth: 1,
            lineStyle: 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            visible: true
          }
        );

        lowerSeries = chart.addSeries(
          LightweightCharts.LineSeries,
          {
            color: COLORS.VWAP_BAND,
            lineWidth: 1,
            lineStyle: 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            visible: true
          }
        );
      } else if (chart.addLineSeries) {
        vwapSeries = chart.addLineSeries({
          color: COLORS.VWAP,
          lineWidth: 2,
          lineStyle: 0,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false
        });

        upperSeries = chart.addLineSeries({
          color: COLORS.VWAP_BAND,
          lineWidth: 1,
          lineStyle: 2,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false
        });

        lowerSeries = chart.addLineSeries({
          color: COLORS.VWAP_BAND,
          lineWidth: 1,
          lineStyle: 2,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false
        });
      }
    } catch (e) {
      console.error('Daily VWAP series creation error', e);
      return;
    }

    if (!vwapSeries || !upperSeries || !lowerSeries) {
      return;
    }

    try {
      vwapSeries.setData(vwapData);
      upperSeries.setData(upperData);
      lowerSeries.setData(lowerData);

      arr.push({
        series: vwapSeries,
        title: 'DailyVWAP'
      });

      arr.push({
        series: upperSeries,
        title: 'DailyVWAP+2σ'
      });

      arr.push({
        series: lowerSeries,
        title: 'DailyVWAP-2σ'
      });
    } catch (e) {
      try {
        chart.removeSeries(vwapSeries);
      } catch (_) {}

      try {
        chart.removeSeries(upperSeries);
      } catch (_) {}

      try {
        chart.removeSeries(lowerSeries);
      } catch (_) {}
    }
  }

  // ==========================================
  // ATR
  // ==========================================
  function drawATR(data, days, atrs, arr) {
    if (!days.length) return;

    const i = days.length - 1;
    const d = days[i];
    const atr = atrs[i];

    if (!Number.isFinite(atr)) return;

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

    if (i >= 1 && Number.isFinite(atrs[i - 1])) {
      const p = days[i - 1];
      const a = atrs[i - 1];

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

    if (i >= 2 && Number.isFinite(atrs[i - 2])) {
      const p = days[i - 2];
      const a = atrs[i - 2];

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

  // ==========================================
  // Render
  //
  // dataには「指定期間内のM1」だけを渡す。
  // Daily OHLC / VWAPとも同じdailyPeriodsを使用。
  // ==========================================
  function render(data, currentTs) {
    if (
      !Array.isArray(data) ||
      typeof chart === 'undefined' ||
      !chart
    ) {
      return;
    }

    const clean = data
      .filter(validBar)
      .sort((a, b) => a.time - b.time);

    if (!clean.length) return;

    resetGroups();

    // ------------------------------------------
    // DailyだけはM1の時間差から自動検出
    // ------------------------------------------
    const days = detectDailyPeriods(clean);

    // ------------------------------------------
    // Weekly / Monthlyは既存のカレンダー方式を維持
    // ------------------------------------------
    const weeks = buildCalendarPeriods(
      clean,
      weekStart,
      MAX_WEEKS
    );

    const months = buildCalendarPeriods(
      clean,
      monthStart,
      MAX_MONTHS
    );

    // ------------------------------------------
    // OHLC
    // ------------------------------------------
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
      days[days.length - 1],
      'D',
      current.day
    );

    drawCurrentPeriod(
      weeks[weeks.length - 1],
      'W',
      current.week
    );

    drawCurrentPeriod(
      months[months.length - 1],
      'M',
      current.month
    );

    // ------------------------------------------
    // Daily VWAP / ±2σ
    //
    // OHLCと同じdays[days.length - 1]を使用。
    // ------------------------------------------
    const currentDay = days[days.length - 1];

    drawDailyVWAP(
      currentDay,
      current.day
    );

    // ------------------------------------------
    // ATR
    // ------------------------------------------
    const atrs = atrSeries(days);

    drawATR(
      clean,
      days,
      atrs,
      current.day
    );

    initialized = true;
  }

  window.cheesecake2Reset = resetGroups;
  window.cheesecake2Render = render;

  window.addEventListener('DOMContentLoaded', () => {
    initialized = false;
  });
})();