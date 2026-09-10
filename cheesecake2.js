/* cheesecake2.js - TickForge integration */
'use strict';

window.cheesecake2 = {
  enabled: true,
  settings: {
    showPrevDay:true, showPrevWeek:true, showPrevMonth:true,
    showCurDay:true, showCurWeek:true, showCurMonth:true,
    showATRLines:true, showATR5D:true
  },
  lines:[]
};

function c2RemoveLines(){
  if (typeof candleSeries === 'undefined' || !candleSeries) return;
  for (const l of window.cheesecake2.lines) {
    try { candleSeries.removePriceLine(l); } catch(e) {}
  }
  window.cheesecake2.lines = [];
}
function c2AddLine(price, color, title){
  if (!Number.isFinite(price)) return;
  if (typeof candleSeries === 'undefined' || !candleSeries) return;
  try {
    const l = candleSeries.createPriceLine({
      price: price,
      color: color,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: true,
      title: title
    });
    window.cheesecake2.lines.push(l);
  } catch(e) {
    console.error('cheesecake2 line error', e);
  }
}
function c2DayKey(t){
  const d=new Date(t*1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function c2WeekKey(t){
  const d=new Date(t*1000);
  const day=d.getUTCDay();
  d.setUTCDate(d.getUTCDate()-day);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function c2MonthKey(t){
  const d=new Date(t*1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}
function c2Groups(data,keyFn){
  const groups=[];
  let g=null;
  for(const b of data){
    const k=keyFn(b.time);
    if(!g || g.key!==k){
      if(g) groups.push(g);
      g={key:k,open:b.open,high:b.high,low:b.low,close:b.close,start:b.time,end:b.time};
    }else{
      g.high=Math.max(g.high,b.high);
      g.low=Math.min(g.low,b.low);
      g.close=b.close;
      g.end=b.time;
    }
  }
  if(g) groups.push(g);
  return groups;
}
function c2ATR(groups,n){
  const tr=[];
  for(let i=0;i<groups.length;i++){
    const g=groups[i];
    if(i===0) tr.push(g.high-g.low);
    else {
      const pc=groups[i-1].close;
      tr.push(Math.max(g.high-g.low,Math.abs(g.high-pc),Math.abs(g.low-pc)));
    }
  }
  const atr=new Array(groups.length).fill(NaN);
  for(let i=n-1;i<groups.length;i++){
    let s=0;
    for(let j=i-n+1;j<=i;j++) s+=tr[j];
    atr[i]=s/n;
  }
  return atr;
}

function renderCheesecake2(data){
  if(!Array.isArray(data) || data.length===0) return;
  c2RemoveLines();

  const dg=c2Groups(data,c2DayKey);
  const wg=c2Groups(data,c2WeekKey);
  const mg=c2Groups(data,c2MonthKey);

  const s=window.cheesecake2.settings;
  const addPrev=(groups,names,show)=>{
    if(!show || groups.length<2) return;
    const g=groups[groups.length-2];
    c2AddLine(g.open,'#00c853',names[0]);
    c2AddLine(g.high,'#2979ff',names[1]);
    c2AddLine(g.low,'#ff1744',names[2]);
    c2AddLine(g.close,'#ffea00',names[3]);
  };
  addPrev(dg,['PDO','PDH','PDL','PDC'],s.showPrevDay);
  addPrev(wg,['PWO','PWH','PWL','PWC'],s.showPrevWeek);
  addPrev(mg,['PMO','PMH','PML','PMC'],s.showPrevMonth);

  const addCur=(groups,names,show)=>{
    if(!show || !groups.length) return;
    const g=groups[groups.length-1];
    c2AddLine(g.open,'#00c853',names[0]);
    c2AddLine(g.high,'#2979ff',names[1]);
    c2AddLine(g.low,'#ff1744',names[2]);
  };
  addCur(dg,['DO','DH','DL'],s.showCurDay);
  addCur(wg,['WO','WH','WL'],s.showCurWeek);
  addCur(mg,['MO','MH','ML'],s.showCurMonth);

  const atr=c2ATR(dg,5);
  if(s.showATRLines){
    const indices=[dg.length-1,dg.length-2,dg.length-3];
    for(const i of indices){
      if(i<0 || !Number.isFinite(atr[i])) continue;
      const g=dg[i], a=atr[i];
      c2AddLine(g.open+a,'#ff00ff','maxATR_u');
      c2AddLine(g.open-a,'#ff00ff','maxATR_l');
      c2AddLine(g.low+a,'#ff00ff','ATR_u');
      c2AddLine(g.high-a,'#ff00ff','ATR_l');
    }
  }

  // Keep the latest ATR value available to the UI.
  window.cheesecake2.lastATR5D = atr.length ? atr[atr.length-1] : NaN;
  return {daily:dg,weekly:wg,monthly:mg,atr5D:window.cheesecake2.lastATR5D};
}

window.renderCheesecake2=renderCheesecake2;
window.clearCheesecake2=c2RemoveLines;
