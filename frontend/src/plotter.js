import { authFetch, toast } from './app.js';

const UI = {
  container: '#ggb-container',
  form: '#plot-form',
  input: '#plot-input',
  list: '#expr-list',
  btnClear: '#btn-clear',
  btnGrid: '#btn-grid',
  btnExport: '#btn-export',
  btnHistory: '#btn-history',            
  modalHistory: '#modal-history',       
  historySearch: '#history-search',
  historyList: '#history-list',
  historySelectAll: '#history-select-all',
  historyPlotSelected: '#history-plot-selected',
  historyClose: '[data-close="history"]',
  toasts: '#toasts',
};

const KEYS = { sessionToken: 'ecuplot_session_token' };

const COLORS = [
  '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa',
  '#22d3ee', '#f472b6', '#2dd4bf', '#f59e0b', '#ef4444'
];

let canvas, ctx, dpi = 1, ro;
const view = { xmin:-10, xmax:10, ymin:-6, ymax:6, gridOn: true };
const state = {
  expressions: /** @type {Array<{id:string,label:string,color:string,compiled:any,visible:boolean}>} */([]),
  isPanning:false, panStart:{x:0,y:0}, viewAtPanStart:null,
  // Historial UI
  history: { items: [], selected: new Set(), q: '', limit: 50, offset: 0, total: 0 },
};

// ---------------- Utilidades & toasts ----------------

function width()  { return canvas?.clientWidth  || 800; }
function height() { return canvas?.clientHeight || 500; }

function worldToScreen(x, y) {
  const w = width() * dpi, h = height() * dpi;
  const sx = (x - view.xmin) * (w / (view.xmax - view.xmin));
  const sy = (view.ymax - y) * (h / (view.ymax - view.ymin));
  return [sx, sy];
}
function screenToWorld(sx, sy) {
  const w = width() * dpi, h = height() * dpi;
  const x = sx / (w / (view.xmax - view.xmin)) + view.xmin;
  const y = view.ymax - sy / (h / (view.ymax - view.ymin));
  return [x, y];
}
function niceStep(span) {
  const raw = span / 10;
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const base = raw / pow10;
  let step;
  if (base < 1.5) step = 1; else if (base < 3.5) step = 2; else if (base < 7.5) step = 5; else step = 10;
  return step * pow10;
}
// ---------------- Render ----------------

function drawGridAndAxes() {
  const w = width()*dpi, h = height()*dpi;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#0b1020';
  ctx.fillRect(0,0,w,h);

  if (view.gridOn) {
    const stepX = niceStep(view.xmax - view.xmin);
    const stepY = niceStep(view.ymax - view.ymin);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(148,163,184,0.15)';
    let x0 = Math.ceil(view.xmin/stepX)*stepX;
    for (let x=x0; x<=view.xmax; x+=stepX) {
      const [sx] = worldToScreen(x,0); ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,h); ctx.stroke();
    }
    let y0 = Math.ceil(view.ymin/stepY)*stepY;
    for (let y=y0; y<=view.ymax; y+=stepY) {
      const [,sy] = worldToScreen(0,y); ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(w,sy); ctx.stroke();
    }
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#94a3b8';
    ctx.font = `${12*dpi}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.textAlign='left'; ctx.textBaseline='top';
    for (let x=x0; x<=view.xmax; x+=stepX) { const [sx,sy0]=worldToScreen(x,0); ctx.fillText(formatTick(x), sx+2, sy0+2); }
    ctx.textAlign='right';
    for (let y=y0; y<=view.ymax; y+=stepY) { const [sx0,sy]=worldToScreen(0,y); ctx.fillText(formatTick(y), sx0-2, sy+2); }
  }

  ctx.lineWidth = 1.5*dpi; ctx.strokeStyle='rgba(148,163,184,0.35)';
  let [sx1,syX]=worldToScreen(view.xmin,0); let [sx2]=worldToScreen(view.xmax,0);
  ctx.beginPath(); ctx.moveTo(sx1,syX); ctx.lineTo(sx2,syX); ctx.stroke();
  let [sxY,sy1]=worldToScreen(0,view.ymin); let [,sy2]=worldToScreen(0,view.ymax);
  ctx.beginPath(); ctx.moveTo(sxY,sy1); ctx.lineTo(sxY,sy2); ctx.stroke();
}
function formatTick(v){ if(!isFinite(v))return''; const a=Math.abs(v); if(a===0)return'0'; if(a>=1000||a<0.01)return v.toExponential(0); if(a<1)return v.toFixed(2); if(a<10)return v.toFixed(1); return v.toFixed(0); }

function renderAll(){
  if(!canvas||!ctx)return;
  fixDpi(); drawGridAndAxes();
  ctx.lineJoin='round'; ctx.lineCap='round';
  for(const f of state.expressions){ if(!f.visible)continue; drawFunction(f); }
}

function drawFunction(f){
  const w=width()*dpi, h=height()*dpi;
  const pxTol=1.25;
  const xSpan=view.xmax-view.xmin;
  const worldTol=(xSpan/(w||1))*(pxTol*2);
  const ySpan=view.ymax-view.ymin;
  const Y_LIMIT=ySpan*6;

  ctx.save(); ctx.lineWidth=2*dpi; ctx.strokeStyle=f.color;
  const evalY=(x)=>{ try{ const y=f.compiled.evaluate({x}); return (typeof y==='number'&&isFinite(y))?y:null; }catch{ return null; } };

  const segments=[];
  function addSegment(x1,y1,x2,y2,depth){
    if(y1==null||Math.abs(y1)>Y_LIMIT) y1=null;
    if(y2==null||Math.abs(y2)>Y_LIMIT) y2=null;
    if(y1==null||y2==null){
      if(depth<=0) return;
      const xm=0.5*(x1+x2), ym=evalY(xm);
      addSegment(x1,y1,xm,ym,depth-1);
      addSegment(xm,ym,x2,y2,depth-1);
      return;
    }
    const xm=0.5*(x1+x2); let ym=evalY(xm);
    if(ym==null||Math.abs(ym)>Y_LIMIT){
      if(depth<=0) return;
      addSegment(x1,y1,xm,null,depth-1);
      addSegment(xm,null,x2,y2,depth-1);
      return;
    }
    const dx=x2-x1, dy=y2-y1;
    const t=((xm-x1)*dx+(ym-y1)*dy)/(dx*dx+dy*dy+1e-12);
    const px=x1+t*dx, py=y1+t*dy;
    const errWorld=Math.hypot(xm-px, ym-py);
    const [,sy1]=worldToScreen(0,y1); const [,sy2]=worldToScreen(0,y2);
    const bigScreenJump=Math.abs(sy2-sy1)>80*dpi;
    if((errWorld>worldTol||bigScreenJump)&&depth>0){
      addSegment(x1,y1,xm,ym,depth-1);
      addSegment(xm,ym,x2,y2,depth-1);
    }else{
      segments.push([x1,y1,x2,y2]);
    }
  }

  const baseN=Math.max(64, Math.floor(w/10)), maxDepth=12;
  let prevX=view.xmin, prevY=evalY(prevX);
  for(let i=1;i<=baseN;i++){
    const x=view.xmin+(i/baseN)*(view.xmax-view.xmin);
    const y=evalY(x);
    addSegment(prevX,prevY,x,y,maxDepth);
    prevX=x; prevY=y;
  }

  ctx.beginPath();
  let pen=false;
  for(const [x1,y1,x2,y2] of segments){
    if(y1==null||y2==null){ pen=false; continue; }
    const [sx1,sy1]=worldToScreen(x1,y1); const [sx2,sy2]=worldToScreen(x2,y2);
    if(!pen){ ctx.moveTo(sx1,sy1); pen=true; }
    ctx.lineTo(sx2,sy2);
  }
  ctx.stroke(); ctx.restore();
}

// ---------------- Expresiones actuales ----------------

function normalizeExpr(raw){
  let s=(raw||'').trim(); if(!s) return '';
  s=s.replace(/^\s*y\s*=\s*/i,'f(x)=');
  if(!s.includes('=')) s=`f(x)=${s}`;
  return s;
}

async function addExpression(raw){
  const label=normalizeExpr(raw);
  if(!label){ toast.warn?.('Escribe una expresión.'); return; }
  const rhs=label.split('=').slice(1).join('=').trim();

  let compiled;
  try{
    compiled=math.compile(rhs);
    try{ void compiled.evaluate({x:0}); }catch{}
  }catch{
    toast.error?.('Expresión inválida. Tip: para trozos usa if(cond, expr1, expr2).');
    return;
  }

  const id=`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const color=COLORS[state.expressions.length % COLORS.length];
  state.expressions.push({id,label,color,compiled,visible:true});
  renderChip({id,label,color});
  renderAll();

  if(localStorage.getItem(KEYS.sessionToken)){
    try{
      await authFetch('/api/plot',{
        method:'POST',
        body:JSON.stringify({expression:label})
      });
    }catch{}
  }
  toast.success?.('Expresión añadida.');
}

function renderChip({id,label,color}){
  const host=document.querySelector(UI.list); if(!host) return;
  const btn=document.createElement('button'); btn.className='chip'; btn.type='button'; btn.dataset.id=id;
  const sw=document.createElement('span'); sw.className='chip__swatch'; sw.style.background=color;
  const tx=document.createElement('span'); tx.className='chip__label'; tx.textContent=label;
  const cl=document.createElement('span'); cl.className='chip__close'; cl.setAttribute('aria-hidden','true'); cl.textContent='✕';
  btn.appendChild(sw); btn.appendChild(tx); btn.appendChild(cl);
  btn.addEventListener('click',()=>{ removeExpression(id); btn.remove(); });
  host.appendChild(btn);
}

function removeExpression(id){
  const i=state.expressions.findIndex(e=>e.id===id);
  if(i>=0){ state.expressions.splice(i,1); renderAll(); }
}
function clearAll(){ state.expressions.splice(0); renderAll(); }
function toggleGrid(btn){
  view.gridOn=!view.gridOn;
  btn?.setAttribute('aria-pressed', String(view.gridOn));
  if(btn) btn.textContent=`Cuadrícula: ${view.gridOn?'ON':'OFF'}`;
  renderAll();
}
function exportPNG(){
  const url=canvas.toDataURL('image/png');
  const a=document.createElement('a'); a.download='ecuplot.png'; a.href=url; document.body.appendChild(a); a.click(); a.remove();
}

// ---------------- Historial (modal + API) ----------------

function openHistoryModal(){ const m=document.querySelector(UI.modalHistory); m?.classList.add('is-open'); }
function closeHistoryModal(){ const m=document.querySelector(UI.modalHistory); m?.classList.remove('is-open'); }

async function fetchHistory(q=''){
  const token=localStorage.getItem(KEYS.sessionToken);
  if(!token){ toast.warn?.('Inicia sesión para ver tu historial.'); return; }
  const params=new URLSearchParams();
  if(q) params.set('q', q);
  params.set('limit', String(state.history.limit));
  params.set('offset', String(state.history.offset));

  const res=await authFetch(`/api/plot/history?${params.toString()}`);
  if(!res.ok){
    toast.error?.('No se pudo cargar el historial.');
    return;
  }
  const data=await res.json();
  state.history.items=data.items||[];
  state.history.total=data.total||0;
  renderHistoryList();
}

function renderHistoryList(){
  const host=document.querySelector(UI.historyList); if(!host) return;
  host.innerHTML='';
  for(const it of state.history.items){
    const row=document.createElement('label');
    row.className='history__row';

    const cb=document.createElement('input');
    cb.type='checkbox'; cb.className='history__check';
    cb.value=it.expression;
    cb.addEventListener('change', (e)=>{
      if(cb.checked) state.history.selected.add(it.expression);
      else state.history.selected.delete(it.expression);
    });

    const expr=document.createElement('span');
    expr.className='history__expr';
    expr.textContent=it.expression;

    const date=document.createElement('time');
    date.className='history__date';
    date.textContent=new Date(it.created_at).toLocaleString();

    row.appendChild(cb); row.appendChild(expr); row.appendChild(date);
    host.appendChild(row);
  }
}

function selectAllHistory(checked){
  const host=document.querySelector(UI.historyList); if(!host) return;
  state.history.selected.clear();
  host.querySelectorAll('input[type="checkbox"]').forEach((cb)=>{
    cb.checked=checked;
    if(checked) state.history.selected.add(cb.value);
  });
}

function plotSelectedFromHistory(){
  if(state.history.selected.size===0){ toast.warn?.('No hay expresiones seleccionadas.'); return; }
  for(const expr of state.history.selected){
    addExpression(expr);
  }
  closeHistoryModal();
}

// ---------------- Interacción (zoom/pan) ----------------

function onWheel(e){
  e.preventDefault();
  const rect=canvas.getBoundingClientRect();
  const sx=(e.clientX-rect.left)*dpi, sy=(e.clientY-rect.top)*dpi;
  const [wx,wy]=screenToWorld(sx,sy);
  const z=e.deltaY<0?0.9:1.1;
  const nx=(view.xmax-view.xmin)*z, ny=(view.ymax-view.ymin)*z;
  view.xmin=wx-(wx-view.xmin)*z; view.xmax=view.xmin+nx;
  view.ymin=wy-(wy-view.ymin)*z; view.ymax=view.ymin+ny;
  renderAll();
}
function onMouseDown(e){ state.isPanning=true; state.panStart.x=e.clientX; state.panStart.y=e.clientY; state.viewAtPanStart={...view}; canvas.style.cursor='grabbing'; }
function onMouseMove(e){
  if(!state.isPanning) return;
  const dx=(e.clientX-state.panStart.x)*dpi, dy=(e.clientY-state.panStart.y)*dpi;
  const [wx1,wy1]=screenToWorld(0,0), [wx2,wy2]=screenToWorld(dx,dy);
  const ddx=wx1-wx2, ddy=wy1-wy2;
  view.xmin=state.viewAtPanStart.xmin+ddx; view.xmax=state.viewAtPanStart.xmax+ddx;
  view.ymin=state.viewAtPanStart.ymin+ddy; view.ymax=state.viewAtPanStart.ymax+ddy;
  renderAll();
}
function onMouseUp(){ state.isPanning=false; canvas.style.cursor='default'; }

// ---------------- Boot ----------------

function fixDpi(){
  const w=width(), h=height(), dpr=window.devicePixelRatio||1; dpi=dpr;
  const W=Math.floor(w*dpi), H=Math.floor(h*dpi);
  if(canvas.width!==W||canvas.height!==H){ canvas.width=W; canvas.height=H; }
}
function bootCanvas(){
  const host=document.querySelector(UI.container); if(!host) return;
  canvas=host.querySelector('canvas');
  if(!canvas){
    canvas=document.createElement('canvas');
    canvas.style.width='100%';
    canvas.style.height='min(65vh, 560px)';
    canvas.style.display='block';
    canvas.className='plotter-canvas';
    host.appendChild(canvas);
  }
  ctx=canvas.getContext('2d');
  fixDpi(); renderAll();
  ro=new ResizeObserver(()=>{ fixDpi(); renderAll(); }); ro.observe(host);
  canvas.addEventListener('wheel', onWheel, {passive:false});
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function bindUI(){
  const form=document.querySelector(UI.form);
  const input=document.querySelector(UI.input);
  const btnClear=document.querySelector(UI.btnClear);
  const btnGrid=document.querySelector(UI.btnGrid);
  const btnExport=document.querySelector(UI.btnExport);
  const btnHistory=document.querySelector(UI.btnHistory);

  form?.addEventListener('submit',(e)=>{ e.preventDefault(); addExpression(input?.value||''); if(input) input.value=''; input?.focus(); });
  btnClear?.addEventListener('click', clearAll);
  btnGrid?.addEventListener('click', ()=>toggleGrid(btnGrid));
  btnExport?.addEventListener('click', exportPNG);

  input?.addEventListener('keydown',(e)=>{ if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){ e.preventDefault(); addExpression(input.value||''); input.value=''; }});

  // Historial
  btnHistory?.addEventListener('click', async ()=>{
    openHistoryModal();
    state.history.selected.clear();
    await fetchHistory('');
  });

  document.querySelectorAll(UI.historyClose).forEach(el=> el.addEventListener('click', closeHistoryModal));
  const search=document.querySelector(UI.historySearch);
  search?.addEventListener('input', async ()=>{
    state.history.q=search.value.trim();
    await fetchHistory(state.history.q);
  });
  const selAll=document.querySelector(UI.historySelectAll);
  selAll?.addEventListener('change', (e)=> selectAllHistory(/** @type {HTMLInputElement} */(selAll).checked));
  const btnPlotSel=document.querySelector(UI.historyPlotSelected);
  btnPlotSel?.addEventListener('click', plotSelectedFromHistory);
}

(function start(){ bindUI(); bootCanvas(); })();
