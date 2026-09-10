// ==========================================
// TickForge cheesecake2
// Pine版 cheesecake2 の主要ラインをリプレイデータへ同期
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
    ATR: '#ff00ff'
  };

  let groups = { day: [], week: [], month: [] };
  let current = { day: [], week: [], month: [] };
  let initialized = false;

  function validBar(b) {
    return b && Number.isFinite(b.time) &&
      Number.isFinite(b.open) && Number.isFinite(b.high) &&
      Number.isFinite(b.low) && Number.isFinite(b.close);
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
    const day = d.getDay(); // 0 Sun
    const diff = day === 0 ? 6 : day - 1; // Monday
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
        p = { start:k, end:b.time, o:b.open, h:b.high, l:b.low, c:b.close };
        map.set(k,p);
      } else {
        p.end = b.time;
        p.h = Math.max(p.h,b.high);
        p.l = Math.min(p.l,b.low);
        p.c = b.close;
      }
    }
    return Array.from(map.values()).sort((a,b)=>a.start-b.start).slice(-limit);
  }

  function tr(cur, prevClose) {
    if (!Number.isFinite(prevClose)) return cur.h-cur.l;
    return Math.max(
      cur.h-cur.l,
      Math.abs(cur.h-prevClose),
      Math.abs(cur.l-prevClose)
    );
  }

  // ta.atr(5) に対応する Wilder RMA。
  // 当日については、リプレイ時点までの H/L/C で更新する。
  function atrSeries(days) {
    if (!days.length) return [];
    const out = [];
    let atr = NaN;
    let sum = 0;
    let count = 0;

    for (let i=0;i<days.length;i++) {
      const prevC = i > 0 ? days[i-1].c : NaN;
      const value = tr(days[i], prevC);

      if (!Number.isFinite(atr)) {
        sum += value;
        count++;
        if (count >= 5) atr = sum/5;
      } else {
        atr = (atr*4 + value)/5;
      }
      out.push(atr);
    }
    return out;
  }

  function clearSeriesArray(arr) {
    if (!chart) return;
    for (const s of arr) {
      try { chart.removeSeries(s.series); } catch(e) {}
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
    groups = {day:[],week:[],month:[]};
    current = {day:[],week:[],month:[]};
    initialized = false;
  }

  function makeLine(startTime,endTime,price,color,title,arr,dotted=false) {
    if (!chart || !Number.isFinite(price) || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
    if (endTime <= startTime) endTime = startTime + 1;

    let s = null;
    try {
      if (LightweightCharts.LineSeries && chart.addSeries) {
        s = chart.addSeries(LightweightCharts.LineSeries,{
          color,
          lineWidth:1,
          lineStyle:dotted ? 2 : 2,
          crosshairMarkerVisible:false,
          priceLineVisible:false,
          lastValueVisible:false,
          visible:true
        });
      } else if (chart.addLineSeries) {
        s = chart.addLineSeries({
          color,
          lineWidth:1,
          lineStyle:2,
          crosshairMarkerVisible:false,
          priceLineVisible:false,
          lastValueVisible:false
        });
      }
    } catch(e) {
      console.error('cheesecake2 line creation error',e);
      return;
    }
    if (!s) return;

    try {
      s.setData([
        {time:startTime,value:price},
        {time:endTime,value:price}
      ]);
      if (LightweightCharts.createSeriesMarkers) {
        LightweightCharts.createSeriesMarkers(s,[{
          time:endTime,
          position:'inBar',
          shape:'circle',
          color,
          text:title
        }]);
      }
    } catch(e) {
      try { chart.removeSeries(s); } catch(_) {}
      return;
    }
    arr.push({series:s,title});
  }

  function drawSet(period, prev, arr) {
    if (!period || !prev) return;
    makeLine(prev.start,period.end,prev.o,COLORS.O,'P'+period.prefix+'O',arr);
    makeLine(prev.start,period.end,prev.h,COLORS.H,'P'+period.prefix+'H',arr);
    makeLine(prev.start,period.end,prev.l,COLORS.L,'P'+period.prefix+'L',arr);
    makeLine(prev.start,period.end,prev.c,COLORS.C,'P'+period.prefix+'C',arr);
  }

  function drawHistory(periods, arr, prefix) {
    for (let i=1;i<periods.length;i++) {
      const prev=periods[i-1], cur=periods[i];
      prev.prefix=prefix;
      makeLine(prev.start,cur.end,prev.o,COLORS.O,'P'+prefix+'O',arr);
      makeLine(prev.start,cur.end,prev.h,COLORS.H,'P'+prefix+'H',arr);
      makeLine(prev.start,cur.end,prev.l,COLORS.L,'P'+prefix+'L',arr);
      makeLine(prev.start,cur.end,prev.c,COLORS.C,'P'+prefix+'C',arr);
    }
  }

  function drawCurrentPeriod(period, prefix, arr) {
    if (!period) return;
    makeLine(period.start,period.end,period.o,COLORS.O,prefix+'O',arr);
    makeLine(period.start,period.end,period.h,COLORS.H,prefix+'H',arr);
    makeLine(period.start,period.end,period.l,COLORS.L,prefix+'L',arr);
  }

  function drawATR(data, days, atrs, arr) {
    if (!days.length) return;
    const i = days.length-1;
    const d = days[i];
    const atr = atrs[i];
    if (!Number.isFinite(atr)) return;

    makeLine(d.start,d.end,d.o+atr,COLORS.ATR,'maxATR_u',arr,true);
    makeLine(d.start,d.end,d.o-atr,COLORS.ATR,'maxATR_l',arr,true);
    makeLine(d.start,d.end,d.l+atr,COLORS.ATR,'ATR_u',arr,true);
    makeLine(d.start,d.end,d.h-atr,COLORS.ATR,'ATR_l',arr,true);

    if (i >= 1 && Number.isFinite(atrs[i-1])) {
      const p=days[i-1], a=atrs[i-1];
      makeLine(p.start,d.start-1,p.o+a,COLORS.ATR,'maxATR_u',arr,true);
      makeLine(p.start,d.start-1,p.o-a,COLORS.ATR,'maxATR_l',arr,true);
      makeLine(p.start,d.start-1,p.l+a,COLORS.ATR,'ATR_u',arr,true);
      makeLine(p.start,d.start-1,p.h-a,COLORS.ATR,'ATR_l',arr,true);
    }
    if (i >= 2 && Number.isFinite(atrs[i-2])) {
      const p=days[i-2], a=atrs[i-2];
      makeLine(p.start,days[i-1].start-1,p.o+a,COLORS.ATR,'maxATR_u',arr,true);
      makeLine(p.start,days[i-1].start-1,p.o-a,COLORS.ATR,'maxATR_l',arr,true);
      makeLine(p.start,days[i-1].start-1,p.l+a,COLORS.ATR,'ATR_u',arr,true);
      makeLine(p.start,days[i-1].start-1,p.h-a,COLORS.ATR,'ATR_l',arr,true);
    }
  }

  function render(data,currentTs) {
    if (!Array.isArray(data) || !chart) return;
    const clean = data.filter(validBar).sort((a,b)=>a.time-b.time);
    if (!clean.length) return;

    resetGroups();

    const days = buildPeriods(clean,dayStart,MAX_DAYS);
    const weeks = buildPeriods(clean,weekStart,MAX_WEEKS);
    const months = buildPeriods(clean,monthStart,MAX_MONTHS);

    drawHistory(days,groups.day,'D');
    drawHistory(weeks,groups.week,'W');
    drawHistory(months,groups.month,'M');

    drawCurrentPeriod(days[days.length-1],'D',current.day);
    drawCurrentPeriod(weeks[weeks.length-1],'W',current.week);
    drawCurrentPeriod(months[months.length-1],'M',current.month);

    const atrs=atrSeries(days);
    drawATR(clean,days,atrs,current.day);

    initialized=true;
  }

  window.cheesecake2Reset = resetGroups;
  window.cheesecake2Render = render;

  window.addEventListener('DOMContentLoaded',()=>{
    // chart_live.js の initChart 後に実体が存在するため、
    // 初期化だけしておき、実データはLoad時にrenderする。
    initialized=false;
  });
})();