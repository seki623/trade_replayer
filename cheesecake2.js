/* cheesecake2.js
 * Pine cheesecake2 -> browser/replay implementation.
 * Replay-safe: calculations use only candles supplied to renderCheesecake2().
 */
'use strict';

let cheesecakeState = {
  series: [],
  labels: [],
  lines: [],
  boxes: [],
  table: null,
  settings: {
    showPrevDay: true, showPrevWeek: true, showPrevMonth: true,
    showCurDay: true, showCurWeek: true, showCurMonth: true,
    showATRLines: true, showATR5D: true,
    showMTF: true, mtfTF: 'D', mtfCalc: 'OHLC',
    mtfHA: false, mtfDaily: false
  }
};

function c2Clear() {
  for (const x of cheesecakeState.lines) { try { candleSeries.removePriceLine(x); } catch(e) {} }
  cheesecakeState.lines = [];
  cheesecakeState.labels.forEach(x => { try { x.remove(); } catch(e) {} });
  cheesecakeState.labels = [];
  cheesecakeState.boxes.forEach(x => { try { chart.removeSeries(x); } catch(e) {} });
  cheesecakeState.boxes = [];
  if (cheesecakeState.table) { cheesecakeState.table.remove(); cheesecakeState.table = null; }
}

function c2DayKey(t) {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function c2WeekKey(t) {
  const d = new Date(t * 1000);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function c2MonthKey(t) {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}
function c2Groups(candles, keyFn) {
  const a = [];
  let cur = null;
  for (const c of candles) {
    const k = keyFn(c.time);
    if (!cur || cur.key !== k) {
      if (cur) a.push(cur);
      cur = {key:k, candles:[], open:c.open, high:c.high, low:c.low, close:c.close,
             start:c.time, end:c.time};
    }
    cur.candles.push(c);
    cur.high = Math.max(cur.high, c.high);
    cur.low = Math.min(cur.low, c.low);
    cur.close = c.close;
    cur.end = c.time;
  }
  if (cur) a.push(cur);
  return a;
}
function c2Atr(groups, n=5) {
  const tr = [];
  for (let i=0;i<groups.length;i++) {
    const g=groups[i], pc=i?groups[i-1].close:NaN;
    tr.push(i ? Math.max(g.high-g.low, Math.abs(g.high-pc), Math.abs(g.low-pc)) : g.high-g.low);
  }
  const out = Array(groups.length).fill(NaN);
  for (let i=0;i<groups.length;i++) {
    if (i>=n-1) {
      let s=0; for(let j=i-n+1;j<=i;j++) s+=tr[j];
      out[i]=s/n;
    }
  }
  return out;
}
function c2Line(price, color, title, style=2) {
  if (!Number.isFinite(price)) return;
  const l = candleSeries.createPriceLine({
    price, color, lineWidth:1,
    lineStyle: LightweightCharts.LineStyle.Dotted,
    axisLabelVisible:true, title
  });
  cheesecakeState.lines.push(l);
}
function c2PeriodLines(candles) {
  const dg=c2Groups(candles,c2DayKey), wg=c2Groups(candles,c2WeekKey), mg=c2Groups(candles,c2MonthKey);
  const add=(g, prev, names, show)=>{
    if(!show || g.length < 2) return;
    const x=g[g.length-2];
    c2Line(x.open, '#4caf50', names[0]);
    c2Line(x.high, '#2196f3', names[1]);
    c2Line(x.low, '#f44336', names[2]);
    c2Line(x.close,'#ffeb3b', names[3]);
  };
  add(dg,true,['PDO','PDH','PDL','PDC'],cheesecakeState.settings.showPrevDay);
  add(wg,true,['PWO','PWH','PWL','PWC'],cheesecakeState.settings.showPrevWeek);
  add(mg,true,['PMO','PMH','PML','PMC'],cheesecakeState.settings.showPrevMonth);

  const cur=(g,names,show)=>{
    if(!show || !g.length) return;
    const x=g[g.length-1];
    c2Line(x.open,'#4caf50',names[0]);
    c2Line(x.high,'#2196f3',names[1]);
    c2Line(x.low,'#f44336',names[2]);
  };
  cur(dg,['DO','DH','DL'],cheesecakeState.settings.showCurDay);
  cur(wg,['WO','WH','WL'],cheesecakeState.settings.showCurWeek);
  cur(mg,['MO','MH','ML'],cheesecakeState.settings.showCurMonth);
  return {dg,wg,mg};
}
function c2AtrLines(dg) {
  if(!cheesecakeState.settings.showATRLines || !dg.length) return;
  const atr=c2Atr(dg,5), i=dg.length-1;
  const a=atr[i], p=atr[i-1], p2=atr[i-2];
  const sets=[];
  if(Number.isFinite(a)) sets.push([dg[i],a]);
  if(Number.isFinite(p)) sets.push([dg[i-1],p]);
  if(Number.isFinite(p2)) sets.push([dg[i-2],p2]);
  for(const [g,x] of sets) {
    c2Line(g.open+x,'#ff00ff','maxATR_u');
    c2Line(g.open-x,'#ff00ff','maxATR_l');
    c2Line(g.low+x,'#ff00ff','ATR_u');
    c2Line(g.high-x,'#ff00ff','ATR_l');
  }
  return atr;
}
function c2HA(c) {
  // Per-bar HA, used only for MTF visual approximation.
  let po=NaN, pc=NaN;
  const out=[];
  for(const x of c) {
    const hc=(x.open+x.high+x.low+x.close)/4;
    const ho=Number.isFinite(po)&&Number.isFinite(pc)?(po+pc)/2:(x.open+x.close)/2;
    out.push({time:x.time,open:ho,high:Math.max(x.high,ho,hc),low:Math.min(x.low,ho,hc),close:hc});
    po=ho; pc=hc;
  }
  return out;
}
function c2DrawMTF(candles, tf='D', calc='OHLC', useHA=false) {
  if(!cheesecakeState.settings.showMTF || !candles.length) return;
  const sec = tf==='W'?604800:tf==='M'?2592000:tf==='3M'?7776000:tf==='12M'?31536000:86400;
  const src=useHA?c2HA(candles):candles;
  const groups=[];
  let cur=null;
  for(const c of src) {
    const k=Math.floor(c.time/sec)*sec;
    if(!cur||cur.k!==k){ if(cur)groups.push(cur); cur={k,o:c.open,h:c.high,l:c.low,c:c.close,start:c.time,end:c.time}; }
    else {cur.h=Math.max(cur.h,c.high);cur.l=Math.min(cur.l,c.low);cur.c=c.close;cur.end=c.time;}
  }
  if(cur)groups.push(cur);
  // Lightweight Charts has no generic rectangle primitive. Use histogram-like
  // custom DOM overlay for the MTF boxes, aligned approximately to the time axis.
  // The data remains replay-safe and can be enabled independently.
  window.__cheesecakeMTF = groups.map(g=>{
    let top,bottom;
    if(calc==='Open/Close Range'){top=Math.max(g.o,g.c);bottom=Math.min(g.o,g.c);}
    else if(calc==='True Range'){top=Math.max(g.h,g.o);bottom=Math.min(g.l,g.o);}
    else {top=g.h;bottom=g.l;}
    return {...g,top,bottom,diff:g.c-g.o};
  });
}
function c2AtrTable(atr5d) {
  if(!cheesecakeState.settings.showATR5D) return;
  const el=document.createElement('div');
  el.textContent=`5D ATR : ${Number.isFinite(atr5d)?atr5d.toFixed(2):'—'}`;
  Object.assign(el.style,{position:'absolute',right:'8px',bottom:'8px',
    color:'rgba(251,255,0,.52)',background:'rgba(0,0,0,.70)',padding:'2px 5px',
    font:'11px Consolas,monospace',zIndex:'20',pointerEvents:'none'});
  const host=document.getElementById('chart-container');
  host.style.position='relative'; host.appendChild(el); cheesecakeState.table=el;
}
function renderCheesecake2(candles, settings={}) {
  if(!Array.isArray(candles)||!candles.length||typeof candleSeries==='undefined') return;
  cheesecakeState.settings={...cheesecakeState.settings,...settings};
  c2Clear();
  const {dg}=c2PeriodLines(candles);
  const atr=c2AtrLines(dg);
  const atr5d=atr && Number.isFinite(atr[atr.length-1]) ? atr[atr.length-1] : NaN;
  c2AtrTable(atr5d);
  c2DrawMTF(candles,cheesecakeState.settings.mtfTF,cheesecakeState.settings.mtfCalc,cheesecakeState.settings.mtfHA);
}
function updateCheesecake2(candles, settings={}) {
  renderCheesecake2(candles, settings);
}
window.renderCheesecake2=renderCheesecake2;
window.updateCheesecake2=updateCheesecake2;
window.clearCheesecake2=c2Clear;
