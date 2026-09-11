// ==========================================
// TickForge cheesecake2
// Pine版 cheesecake2 の主要ラインをリプレイデータへ同期
// + Daily VWAP / VWAP ±2σ
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
    VWAP_UPPER: '#ffffff',
    VWAP_LOWER: '#ffffff'
  };

  let groups = { day: [], week: [], month: [], vwap: [] };
  let current = { day: [], week: [], month: [], vwap: [] };
  let initialized = false;

  function validBar(b) {
    return b && Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close);
  }

  function keyDay(ts) {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }

  function dayStart(ts) {
    const d = new Date(ts * 1000);
    d.setHours(0,0,0,0);
    return Math.floor(d.getTime()/1000);
  }

  function weekStart(ts) {
    const d = new Date(ts * 1000);
    d.setHours(0,0,0,0);

    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;

    d.setDate(d.getDate() - diff);

    return Math.floor(d.getTime()/1000);
  }

  function monthStart(ts) {
    const d = new Date(ts * 1000);
    d.setDate(1);
    d.setHours(0,0,0,0);

    return Math.floor(d.getTime()/1000);
  }

  function buildPeriods(data, startFn, limit) {
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
      .sort((a,b) => a.start - b.start)
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

  // ------------------------------------------
  // ATR
  // ------------------------------------------
  // ta.atr(5) に対応する Wilder RMA。
  // 当日についてはリプレイ時点までのH/L/Cで更新。
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

  // ------------------------------------------
  // Series削除
  // ------------------------------------------
  function clearSeriesArray(arr) {
    if (!chart) return;

    for (const s of arr) {
      try {
        chart.removeSeries(s.series);
      } catch(e) {}
    }

    arr.length = 0;
  }

  function resetGroups() {
    clearSeriesArray(groups.day);
    clearSeriesArray(groups.week);
    clearSeriesArray(groups.month);
    clearSeriesArray(groups.vwap);

    clearSeriesArray(current.day);
    clearSeriesArray(current.week);
    clearSeriesArray(current.month);
    clearSeriesArray(current.vwap);

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

  // ------------------------------------------
  // 水平ライン作成
  // ------------------------------------------
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

    if (endTime <= startTime) {
      endTime = startTime + 1;
    }

    let s = null;

    try {
      if (LightweightCharts.LineSeries && chart.addSeries) {
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
    } catch(e) {
      console.error('cheesecake2 line creation error', e);
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

      if (LightweightCharts.createSeriesMarkers) {
        LightweightCharts.createSeriesMarkers(s, [{
          time: endTime,
          position: 'inBar',
          shape: 'circle',
          color,
          text: title
        }]);
      }
    } catch(e) {
      try {
        chart.removeSeries(s);
      } catch(_) {}

      return;
    }

    arr.push({
      series: s,
      title
    });
  }

  // ------------------------------------------
  // 過去期間OHLC
  // ------------------------------------------
  function drawHistory(periods, arr, prefix) {
    for (let i = 1; i < periods.length; i++) {
      const prev = periods[i - 1];
      const cur = periods[i];

      prev.prefix = prefix;

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

  // ------------------------------------------
  // 現在期間OHLC
  // ------------------------------------------
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

  // ------------------------------------------
  // ATR
  // ------------------------------------------
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
  // Daily VWAP + 2σ
  // ==========================================
  //
  // 価格:
  //   HLC3 = (High + Low + Close) / 3
  //
  // VWAP:
  //   Σ(HLC3 × Volume) / ΣVolume
  //
  // σ:
  //   Volume加重分散から算出
  //
  //   variance =
  //   Σ(Volume × (HLC3 - VWAP)^2) / ΣVolume
  //
  // Upper = VWAP + 2σ
  // Lower = VWAP - 2σ
  //
  // Daily開始時に累積値をリセット。
  // リプレイでは渡されたデータ時点までしか使用しない。
  //
  function buildDailyVWAP(data) {
    if (!Array.isArray(data) || !data.length) {
      return [];
    }

    const result = [];

    let currentDay = null;

    let sumPV = 0;
    let sumVolume = 0;
    let sumPV2 = 0;

    for (const b of data) {
      if (!validBar(b)) continue;

      const dStart = dayStart(b.time);

      if (currentDay === null || currentDay !== dStart) {
        currentDay = dStart;

        sumPV = 0;
        sumVolume = 0;
        sumPV2 = 0;
      }

      const volume = Number.isFinite(b.volume) && b.volume > 0
        ? b.volume
        : 0;

      const hlc3 = (
        b.high +
        b.low +
        b.close
      ) / 3;

      if (volume > 0) {
        sumPV += hlc3 * volume;
        sumVolume += volume;

        sumPV2 += hlc3 * hlc3 * volume;
      }

      if (sumVolume <= 0) {
        continue;
      }

      const vwap = sumPV / sumVolume;

      const variance =
        (sumPV2 / sumVolume) -
        (vwap * vwap);

      const sigma = Math.sqrt(
        Math.max(0, variance)
      );

      result.push({
        time: b.time,
        vwap: vwap,
        upper: vwap + sigma * 2,
        lower: vwap - sigma * 2,
        dayStart: currentDay
      });
    }

    return result;
  }

  // ------------------------------------------
  // VWAPを動的ラインとして描画
  // ------------------------------------------
  function drawDailyVWAP(data, arr) {
    const values = buildDailyVWAP(data);

    if (!values.length) return;

    // 日ごとにラインを分ける
    let segment = [];
    let segmentDay = null;

    function drawSegment(seg) {
      if (seg.length < 2) return;

      const start = seg[0].time;
      const end = seg[seg.length - 1].time;

      let vwapSeries = null;
      let upperSeries = null;
      let lowerSeries = null;

      try {
        if (LightweightCharts.LineSeries && chart.addSeries) {
          vwapSeries = chart.addSeries(
            LightweightCharts.LineSeries,
            {
              color: COLORS.VWAP,
              lineWidth: 1,
              lineStyle: 0,
              crosshairMarkerVisible: false,
              priceLineVisible: false,
              lastValueVisible: false
            }
          );

          upperSeries = chart.addSeries(
            LightweightCharts.LineSeries,
            {
              color: COLORS.VWAP_UPPER,
              lineWidth: 1,
              lineStyle: 2,
              crosshairMarkerVisible: false,
              priceLineVisible: false,
              lastValueVisible: false
            }
          );

          lowerSeries = chart.addSeries(
            LightweightCharts.LineSeries,
            {
              color: COLORS.VWAP_LOWER,
              lineWidth: 1,
              lineStyle: 2,
              crosshairMarkerVisible: false,
              priceLineVisible: false,
              lastValueVisible: false
            }
          );
        } else if (chart.addLineSeries) {
          vwapSeries = chart.addLineSeries({
            color: COLORS.VWAP,
            lineWidth: 1,
            lineStyle: 0,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false
          });

          upperSeries = chart.addLineSeries({
            color: COLORS.VWAP_UPPER,
            lineWidth: 1,
            lineStyle: 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false
          });

          lowerSeries = chart.addLineSeries({
            color: COLORS.VWAP_LOWER,
            lineWidth: 1,
            lineStyle: 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false
          });
        }
      } catch(e) {
        console.error('Daily VWAP creation error', e);
        return;
      }

      if (!vwapSeries || !upperSeries || !lowerSeries) return;

      try {
        vwapSeries.setData(
          seg.map(x => ({
            time: x.time,
            value: x.vwap
          }))
        );

        upperSeries.setData(
          seg.map(x => ({
            time: x.time,
            value: x.upper
          }))
        );

        lowerSeries.setData(
          seg.map(x => ({
            time: x.time,
            value: x.lower
          }))
        );
      } catch(e) {
        try { chart.removeSeries(vwapSeries); } catch(_) {}
        try { chart.removeSeries(upperSeries); } catch(_) {}
        try { chart.removeSeries(lowerSeries); } catch(_) {}
        return;
      }

      arr.push({
        series: vwapSeries,
        title: 'Daily VWAP'
      });

      arr.push({
        series: upperSeries,
        title: 'VWAP +2σ'
      });

      arr.push({
        series: lowerSeries,
        title: 'VWAP -2σ'
      });
    }

    for (const v of values) {
      if (segmentDay === null) {
        segmentDay = v.dayStart;
      }

      if (segmentDay !== v.dayStart) {
        drawSegment(segment);

        segment = [];
        segmentDay = v.dayStart;
      }

      segment.push(v);
    }

    drawSegment(segment);
  }

  // ------------------------------------------
  // メインRender
  // ------------------------------------------
  function render(data, currentTs) {
    if (!Array.isArray(data) || !chart) return;

    const clean = data
      .filter(validBar)
      .sort((a,b) => a.time - b.time);

    if (!clean.length) return;

    resetGroups();

    const days = buildPeriods(
      clean,
      dayStart,
      MAX_DAYS
    );

    const weeks = buildPeriods(
      clean,
      weekStart,
      MAX_WEEKS
    );

    const months = buildPeriods(
      clean,
      monthStart,
      MAX_MONTHS
    );

    // 過去D/W/M
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

    // 現在D/W/M
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

    // ATR
    const atrs = atrSeries(days);

    drawATR(
      clean,
      days,
      atrs,
      current.day
    );

    // Daily VWAP + 2σ
    // cleanはリプレイ時点までのデータなので、
    // 未来のデータをVWAP計算に使用しない。
    drawDailyVWAP(
      clean,
      groups.vwap
    );

    initialized = true;
  }

  // ------------------------------------------
  // 外部公開
  // ------------------------------------------
  window.cheesecake2Reset = resetGroups;
  window.cheesecake2Render = render;

  window.addEventListener(
    'DOMContentLoaded',
    () => {
      initialized = false;
    }
  );
})();