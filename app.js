const PEOPLE = {
  donna: { label: 'Donna', palette: ['#f5c6d6', '#c8dff0', '#d8c7ef', '#cde8d1', '#f8d7a8', '#f5e6a8', '#ffd6cc', '#d7e7e4'], presets: ['Class','Lesson','Rehearsal','Meeting','Performance','No-show','Other'] },
  tod: { label: 'Tod', palette: ['#d8dde2', '#c8d0d8', '#b6c1cc', '#a9b0b8', '#8f9aa3', '#737f87', '#60707a', '#4f5b63'], presets: ['Meeting','Event','Appointment','Other'] },
  frank: { label: 'Frank', palette: ['#c9b18f', '#b99767', '#9f7f55', '#d5c0a2', '#a58c6f', '#7d6a55', '#b9aa7f', '#8b7a4d'], presets: ['Doctor','Hair','Church','Appointment','Other'] },
  shared: { label: 'Shared', palette: ['#b7d4c5', '#e3c97f', '#c79c8a', '#9eb7c7', '#d3b4c6', '#c8c3a2', '#f0cfa8', '#a8bfa0'], presets: ['Camping','Roadtrip','Shopping','Friends','Family','Other'] }
};
const PRESET_DEFAULT = { Class:0, Lesson:1, Rehearsal:2, Meeting:3, Performance:4, 'No-show':6, Event:2, Doctor:0, Hair:1, Church:6, Appointment:2, Camping:0, Roadtrip:3, Shopping:1, Friends:4, Family:2, Other:7 };
const START_HOUR = 7;
const END_HOUR = 22;
let state = { weekStart: startOfWeek(new Date()), filter:'all', events:[], selectedColor:'#c8dff0', supabase:null, storageMode:'local', focusDate:null, detailsEvent:null, pendingScrollDate:null, adjustingScroll:false };

const $ = id => document.getElementById(id);
function startOfWeek(d){ const x=new Date(d); x.setHours(0,0,0,0); const day=x.getDay(); const diff=(day+6)%7; x.setDate(x.getDate()-diff); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function isoDate(d){ return d.toISOString().slice(0,10); }
function hmToMin(hm){ const [h,m]=hm.split(':').map(Number); return h*60+m; }
function minToHm(min){ return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }
function fmtDate(d){ return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function fmtDay(d){ return d.toLocaleDateString(undefined,{weekday:'short'}); }
function fmtTime(hm){ const [h,m]=hm.split(':').map(Number); const suffix=h>=12?'pm':'am'; const hr=((h+11)%12)+1; return `${hr}:${String(m).padStart(2,'0')}${suffix}`; }
function uuid(){ return crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2); }

async function init(){
  document.body.classList.add('zoom-compact');
  setupSupabase();
  setupControls();
  setupSwipeNavigation();
  fillPersonSelect();
  await loadEvents();
  render();
}
function setupSupabase(){
  const url = window.TOD_DONNA_CALENDAR_SUPABASE_URL;
  const key = window.TOD_DONNA_CALENDAR_SUPABASE_ANON_KEY;
  if(url && key && window.supabase){
    state.supabase = window.supabase.createClient(url,key);
    state.storageMode='supabase';
  }
}
function seedEvents(){
  return (window.TOD_DONNA_CALENDAR_SEED_EVENTS||[]).map(e=>({
    ...e,
    id: uuid(),
    color: PEOPLE[e.person_key]?.palette[PRESET_DEFAULT[e.preset_name] ?? 0] || '#ddd',
    recurrence_rule:null,
    imported:true
  }));
}
async function loadEvents(){
  if(state.storageMode==='supabase'){
    const { data, error } = await state.supabase.from('tod_donna_calendar_events').select('*').order('event_date');
    if(!error && data?.length){ state.events = data.map(fromDb); return; }
    if(!error){
      state.events = seedEvents();
      await state.supabase.from('tod_donna_calendar_events').upsert(state.events.map(toDb));
      await saveAllLocal();
      return;
    }
  }
  const saved = localStorage.getItem('tod_donna_calendar_events_v1');
  if(saved){ state.events=JSON.parse(saved); return; }
  state.events=seedEvents();
  await saveAllLocal();
}
function fromDb(r){
  return { id:r.id, title:r.title, person_key:r.person_key, preset_name:r.preset_name, status:r.status, date:r.event_date, start_time:r.start_time.slice(0,5), end_time:r.end_time.slice(0,5), notes:r.notes||'', color:r.color_hex, recurrence_rule:r.recurrence_rule, imported:r.imported_source?true:false };
}
function toDb(e){
  return { id:e.id, title:e.title, person_key:e.person_key, preset_name:e.preset_name, status:e.status, event_date:e.date, start_time:e.start_time, end_time:e.end_time, notes:e.notes, color_hex:e.color, recurrence_rule:e.recurrence_rule, imported_source:e.source||null };
}
async function saveEvent(e){
  const i=state.events.findIndex(x=>x.id===e.id);
  if(i>=0) state.events[i]=e; else state.events.push(e);
  if(state.storageMode==='supabase') await state.supabase.from('tod_donna_calendar_events').upsert(toDb(e));
  await saveAllLocal();
}
async function deleteEvent(id){
  state.events=state.events.filter(e=>e.id!==id);
  if(state.storageMode==='supabase') await state.supabase.from('tod_donna_calendar_events').delete().eq('id',id);
  await saveAllLocal();
}
async function saveAllLocal(){ localStorage.setItem('tod_donna_calendar_events_v1', JSON.stringify(state.events)); }

function setupControls(){
  $('prevWeekBtn').onclick=()=>{ state.weekStart=addDays(state.weekStart,-7); closeToolbarMenu(); render(); };
  $('nextWeekBtn').onclick=()=>{ state.weekStart=addDays(state.weekStart,7); closeToolbarMenu(); render(); };
  $('todayBtn').onclick=()=>{ state.weekStart=startOfWeek(new Date()); closeToolbarMenu(); render(); };
  $('menuTodayBtn').onclick=()=>{ state.weekStart=startOfWeek(new Date()); closeToolbarMenu(); render(); };
  $('weekRangeBtn').onclick=()=>toggleToolbarMenu();
  $('navMenuBtn').onclick=()=>toggleToolbarMenu();
  $('weekPicker').onchange=e=>{ if(e.target.value){ state.weekStart=startOfWeek(new Date(e.target.value+'T00:00')); closeToolbarMenu(); render(); } };
  $('zoomSelect').onchange=e=>{ document.body.classList.remove('zoom-compact','zoom-detailed'); document.body.classList.add('zoom-'+e.target.value); };
  $('calendarSelect').onchange=e=>{ state.filter=e.target.value; state.focusDate=null; document.body.classList.remove('focus-day'); closeToolbarMenu(); render(); };
  $('addEventBtn').onclick=()=>openDialog({date: isoDate(state.weekStart), start_time:'09:00', end_time:'09:30', person_key:'donna'});
  $('personSelect').onchange=()=>{ fillPresetSelect(); fillPalette(); };
  $('presetSelect').onchange=()=>{ const p=$('personSelect').value, preset=$('presetSelect').value; const idx=PRESET_DEFAULT[preset] ?? 0; state.selectedColor=PEOPLE[p].palette[idx]; fillPalette(); if(preset==='No-show') $('statusSelect').value='no_show'; };
  $('repeatToggle').onchange=e=>$('repeatControls').classList.toggle('hidden', !e.target.checked);
  $('saveEventBtn').onclick=async ev=>{ ev.preventDefault(); await submitForm(); };
  $('deleteEventBtn').onclick=async()=>{ const id=$('eventId').value; if(id){ await deleteEvent(id); $('eventDialog').close(); render(); } };
  $('cancelEventBtn').onclick=()=>{$('eventDialog').close();};
  $('closeDetailsBtn').onclick=()=>$('eventDetailsDialog').close();
  $('editDetailsBtn').onclick=()=>{ const e=state.detailsEvent; $('eventDetailsDialog').close(); if(e) openDialog(e); };
  $('deleteDetailsBtn').onclick=async()=>{ const e=state.detailsEvent; if(e?.id && !e.recurring_instance){ await deleteEvent(e.id); $('eventDetailsDialog').close(); render(); } };
  document.addEventListener('click', ev=>{ if(!ev.target.closest('.toolbar')) closeToolbarMenu(); });
}
function toggleToolbarMenu(){ const tb=document.querySelector('.toolbar'); const open=!tb.classList.contains('menu-open'); tb.classList.toggle('menu-open', open); $('navMenuBtn').setAttribute('aria-expanded', String(open)); }
function closeToolbarMenu(){ const tb=document.querySelector('.toolbar'); if(tb){ tb.classList.remove('menu-open'); } if($('navMenuBtn')) $('navMenuBtn').setAttribute('aria-expanded','false'); }
function weekRangeText(){ const days=visibleDayCount(); const start=state.weekStart; const end=addDays(start, days-1); return `${fmtDate(start)} – ${fmtDate(end)}`; }
function visibleDayCount(){
  if(document.body.classList.contains('focus-day')) return 1;
  if(window.matchMedia('(max-width: 760px) and (orientation: portrait)').matches) return 3;
  if(window.matchMedia('(max-width: 900px) and (orientation: landscape)').matches) return 5;
  return 7;
}
function isScrollableDayRail(){ return window.matchMedia('(max-width: 900px)').matches && !document.body.classList.contains('focus-day'); }
function renderRange(){ return isScrollableDayRail() ? { start:addDays(state.weekStart,-21), days:49 } : { start:state.weekStart, days:7 }; }

function setupSwipeNavigation(){
  // Native horizontal rail: days move with the finger. Edge-recenter makes it effectively unlimited.
  const grid = $('calendarGrid');
  if(!grid) return;
  let edgeTimer=null;
  grid.addEventListener('wheel', ev => {
    if(isScrollableDayRail() && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)){
      grid.scrollLeft += ev.deltaY;
    }
  }, { passive:true });
  grid.addEventListener('scroll', () => {
    if(state.adjustingScroll || !isScrollableDayRail()) return;
    clearTimeout(edgeTimer);
    edgeTimer=setTimeout(checkRailEdges, 90);
  }, { passive:true });
}

function resetCarouselPosition(){
  const grid=$('calendarGrid');
  if(!grid) return;
  grid.style.transform='';
  if(!isScrollableDayRail()) return;
  const target = state.pendingScrollDate || isoDate(state.weekStart);
  state.pendingScrollDate=null;
  scrollRailToDate(target);
}
function scrollRailToDate(dateStr){
  const grid=$('calendarGrid');
  if(!grid) return;
  const col=[...grid.children].find(el=>el.dataset.date===dateStr) || grid.children[21] || grid.children[0];
  if(!col) return;
  state.adjustingScroll=true;
  grid.scrollLeft = Math.max(0, col.offsetLeft - 6);
  setTimeout(()=>{ state.adjustingScroll=false; }, 120);
}
function firstVisibleRailDate(){
  const grid=$('calendarGrid');
  if(!grid) return isoDate(state.weekStart);
  const x=grid.scrollLeft + 8;
  let best=null;
  for(const col of grid.children){ if(col.offsetLeft + col.offsetWidth > x){ best=col; break; } }
  return best?.dataset.date || isoDate(state.weekStart);
}
function checkRailEdges(){
  const grid=$('calendarGrid');
  if(!grid || !isScrollableDayRail()) return;
  const max=grid.scrollWidth-grid.clientWidth;
  if(max<=0) return;
  if(grid.scrollLeft < grid.clientWidth*0.7){
    state.pendingScrollDate=firstVisibleRailDate();
    state.weekStart=addDays(state.weekStart,-14);
    render();
  } else if(grid.scrollLeft > max - grid.clientWidth*0.7){
    state.pendingScrollDate=firstVisibleRailDate();
    state.weekStart=addDays(state.weekStart,14);
    render();
  }
}

function fillPersonSelect(){ $('personSelect').innerHTML=Object.entries(PEOPLE).map(([k,p])=>`<option value="${k}">${p.label}</option>`).join(''); fillPresetSelect(); fillPalette(); }
function fillPresetSelect(){ const p=$('personSelect').value||'donna'; $('presetSelect').innerHTML=PEOPLE[p].presets.map(x=>{ const c=PEOPLE[p].palette[PRESET_DEFAULT[x] ?? 0]; return `<option style="background:${c}">${x}</option>`; }).join(''); }
function fillPalette(){ const p=$('personSelect').value||'donna'; $('colorPalette').innerHTML=''; PEOPLE[p].palette.forEach(c=>{ const b=document.createElement('button'); b.type='button'; b.className='color-swatch'+(c===state.selectedColor?' selected':''); b.style.background=c; b.title=c; b.onclick=()=>{ state.selectedColor=c; fillPalette(); }; $('colorPalette').appendChild(b); }); }

function expandEventsForRange(rangeStart, rangeDays){
  const start=isoDate(rangeStart), end=isoDate(addDays(rangeStart,rangeDays));
  let out=[];
  for(const e of state.events){
    if(e.date>=start && e.date<end) out.push(e);
    if(e.recurrence_rule?.enabled){
      const base=new Date(e.date+'T00:00'); const until=e.recurrence_rule.until ? new Date(e.recurrence_rule.until+'T00:00') : addDays(base,365);
      for(let i=0;i<rangeDays;i++){ const d=addDays(rangeStart,i); const ds=isoDate(d); if(ds<=e.date || d>until) continue;
        const dow=d.getDay();
        const days=e.recurrence_rule.days?.length ? e.recurrence_rule.days.map(Number) : [base.getDay()];
        if(days.includes(dow)) out.push({...e, id:e.id+'__'+ds, date:ds, recurring_instance:true});
      }
    }
  }
  if(state.filter!=='all') out=out.filter(e=>e.person_key===state.filter);
  return out;
}
function render(){
  $('weekPicker').value=isoDate(state.weekStart);
  $('weekRangeBtn').textContent=weekRangeText();
  const range=renderRange();
  const events=expandEventsForRange(range.start, range.days);
  renderDensity(events); renderGrid(events); renderPrint(events);
}
function renderDensity(events){
  const panel=$('densityPanel'); panel.innerHTML='';
  for(let i=0;i<7;i++){ const d=addDays(state.weekStart,i); const ds=isoDate(d); const dayEvents=events.filter(e=>e.date===ds && e.status!=='cancelled'); const total=dayEvents.reduce((s,e)=>s+Math.max(0,hmToMin(e.end_time)-hmToMin(e.start_time)),0);
    const lunchFree=hasGap(dayEvents, 11*60, 14*60, 45);
    const level= total>=360 ? 'heavy' : total>=210 ? 'busy' : 'easy';
    const div=document.createElement('div'); div.className=`density-card density-level-${level}`;
    div.innerHTML=`<div class="density-title">${fmtDay(d)} ${fmtDate(d)} · ${Math.round(total/60*10)/10} hrs</div><div class="density-note">${lunchFree?'Lunch window OK':'Lunch risk: no 45-min gap 11–2'}</div>`;
    panel.appendChild(div);
  }
}
function hasGap(events, start, end, need){
  const busy=events.map(e=>[Math.max(start,hmToMin(e.start_time)), Math.min(end,hmToMin(e.end_time))]).filter(x=>x[1]>x[0]).sort((a,b)=>a[0]-b[0]);
  let cursor=start; for(const [a,b] of busy){ if(a-cursor>=need) return true; cursor=Math.max(cursor,b); } return end-cursor>=need;
}
function renderGrid(events){
  const grid=$('calendarGrid'); grid.innerHTML=''; const today=isoDate(new Date());
  grid.classList.remove('is-dragging','is-snapping');
  const phoneCarousel = isScrollableDayRail();
  const range=renderRange();
  grid.classList.toggle('phone-carousel', phoneCarousel);
  for(let i=0;i<range.days;i++){ const d=addDays(range.start,i); const ds=isoDate(d); const col=document.createElement('section'); col.className='day-column'+(ds===today?' current-day':''); col.dataset.date=ds;
    if(state.focusDate===ds) col.classList.add('focused');
    col.innerHTML=`<div class="day-header" title="Double-click to zoom this day"><div><strong>${fmtDay(d)}</strong><small>${fmtDate(d)}</small></div><button class="add-day" aria-label="Add event">+</button></div><div class="day-timeline"><div class="half-lines"></div></div>`;
    col.querySelector('.day-header').ondblclick=(ev)=>{ if(ev.target.closest('button')) return; state.focusDate = state.focusDate===ds ? null : ds; document.body.classList.toggle('focus-day', !!state.focusDate); render(); };
    col.querySelector('.add-day').onclick=()=>openDialog({date:ds,start_time:'09:00',end_time:'09:30',person_key:'donna'});
    const tl=col.querySelector('.day-timeline');
    for(let h=START_HOUR; h<=END_HOUR; h++){ const lab=document.createElement('div'); lab.className='time-label'+(h===START_HOUR?' start-label':''); lab.style.top = h===START_HOUR ? '2px' : `calc(${h-START_HOUR} * var(--hour-height) - 1px)`; lab.textContent=fmtTime(String(h).padStart(2,'0')+':00'); tl.appendChild(lab); }
    const dayEvents=events.filter(e=>e.date===ds).sort((a,b)=>hmToMin(a.start_time)-hmToMin(b.start_time)); assignOverlapLanes(dayEvents).forEach(e=>tl.appendChild(eventEl(e)));
    grid.appendChild(col);
  }
  requestAnimationFrame(resetCarouselPosition);
}
function assignOverlapLanes(list){
  return list.map((e,idx)=>{ const overlap=list.some((o,j)=>j!==idx && hmToMin(o.start_time)<hmToMin(e.end_time) && hmToMin(e.start_time)<hmToMin(o.end_time)); const previous=list.filter((o,j)=>j<idx && hmToMin(o.start_time)<hmToMin(e.end_time) && hmToMin(e.start_time)<hmToMin(o.end_time)).length; return {...e, overlap, lane: overlap ? previous%2 : 0}; });
}
function eventEl(e){
  const div=document.createElement('article'); div.className='event-block '+(e.status==='no_show'?'no-show ':'')+(e.status==='cancelled'?'cancelled ':'')+(e.overlap?'overlap-2 lane-'+e.lane:'');
  const top=(hmToMin(e.start_time)-START_HOUR*60)/((END_HOUR-START_HOUR)*60)*100; const height=(hmToMin(e.end_time)-hmToMin(e.start_time))/((END_HOUR-START_HOUR)*60)*100;
  div.style.top=top+'%'; div.style.height=height+'%'; div.style.background=e.color||'#ddd';
  const meta = e.notes ? e.notes : `${PEOPLE[e.person_key]?.label||e.person_key} · ${e.preset_name}`;
  div.innerHTML=`<div><div class="event-title">${escapeHtml(e.title)}</div><div class="event-meta">${escapeHtml(meta)}</div></div>`;
  div.addEventListener('pointerdown', ev=>ev.stopPropagation()); div.addEventListener('dblclick', ev=>ev.stopPropagation()); div.onclick=(ev)=>{ ev.stopPropagation(); ev.preventDefault(); openDetails(e); };
  return div;
}
function renderPrint(events){
  const box=$('printList'); box.innerHTML='';
  for(let i=0;i<7;i++){ const d=addDays(state.weekStart,i); const ds=isoDate(d); const dayEvents=events.filter(e=>e.date===ds).sort((a,b)=>hmToMin(a.start_time)-hmToMin(b.start_time)); const wrap=document.createElement('div'); wrap.className='print-day';
    wrap.innerHTML=`<h3>${fmtDay(d)} ${fmtDate(d)}</h3>` + (dayEvents.length?`<ul>${dayEvents.map(e=>`<li>${fmtTime(e.start_time)}–${fmtTime(e.end_time)} · ${escapeHtml(e.title)} · ${PEOPLE[e.person_key]?.label} · ${e.preset_name}${e.status==='no_show'?' · NO-SHOW':''}</li>`).join('')}</ul>`:'<p>No blocks.</p>'); box.appendChild(wrap);
  }
}

function openDetails(e){
  state.detailsEvent=e;
  const person=PEOPLE[e.person_key]?.label||e.person_key;
  const status=e.status==='no_show'?'No-show':(e.status==='cancelled'?'Cancelled':'Scheduled');
  const recurrence=e.recurrence_rule?.enabled ? `${e.recurrence_rule.frequency || 'Recurring'}${e.recurrence_rule.until ? ' until '+e.recurrence_rule.until : ''}` : 'None';
  $('deleteDetailsBtn').classList.toggle('hidden', !!e.recurring_instance);
  $('eventDetailsContent').innerHTML=`
    <div class="detail-main-title"><span class="detail-dot" style="background:${escapeHtml(e.color||'#ddd')}"></span>${escapeHtml(e.title)}</div>
    <div class="detail-row"><span class="detail-label">Person</span><span>${escapeHtml(person)}</span></div>
    <div class="detail-row"><span class="detail-label">Preset</span><span><span class="detail-chip" style="background:${escapeHtml(e.color||'#ddd')}">${escapeHtml(e.preset_name||'')}</span></span></div>
    <div class="detail-row"><span class="detail-label">Date</span><span>${escapeHtml(e.date)}</span></div>
    <div class="detail-row"><span class="detail-label">Time</span><span>${fmtTime(e.start_time)}–${fmtTime(e.end_time)}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span>${escapeHtml(status)}</span></div>
    <div class="detail-row"><span class="detail-label">Repeat</span><span>${escapeHtml(recurrence)}</span></div>
    <div class="detail-row"><span class="detail-label">Notes</span><span>${escapeHtml(e.notes||'')}</span></div>`;
  $('eventDetailsDialog').showModal();
}
function openDialog(e){
  $('dialogTitle').textContent=e.id?'Edit':'+ Add'; $('eventId').value=e.id||''; $('eventTitle').value=e.title||''; $('personSelect').value=e.person_key||'donna'; fillPresetSelect(); $('presetSelect').value=e.preset_name||PEOPLE[$('personSelect').value].presets[0];
  $('eventDate').value=e.date||isoDate(state.weekStart); $('startTime').value=e.start_time||'09:00'; $('endTime').value=e.end_time||'09:30'; $('statusSelect').value=e.status||'scheduled'; $('eventNotes').value=e.notes||''; state.selectedColor=e.color||PEOPLE[$('personSelect').value].palette[0]; fillPalette();
  $('repeatToggle').checked=!!e.recurrence_rule?.enabled; $('repeatControls').classList.toggle('hidden',!$('repeatToggle').checked); $('repeatFrequency').value=e.recurrence_rule?.frequency||'weekly'; $('repeatUntil').value=e.recurrence_rule?.until||''; document.querySelectorAll('.weekday-picker input').forEach(ch=>ch.checked=e.recurrence_rule?.days?.map(String).includes(ch.value)||false);
  $('deleteEventBtn').classList.toggle('hidden',!e.id || e.recurring_instance); $('eventDialog').showModal();
}
async function submitForm(){
  const rec=$('repeatToggle').checked ? { enabled:true, frequency:$('repeatFrequency').value, until:$('repeatUntil').value||null, days:[...document.querySelectorAll('.weekday-picker input:checked')].map(x=>Number(x.value)) } : null;
  const e={ id:$('eventId').value||uuid(), title:$('eventTitle').value.trim(), person_key:$('personSelect').value, preset_name:$('presetSelect').value, date:$('eventDate').value, start_time:$('startTime').value, end_time:$('endTime').value, status:$('statusSelect').value, color:state.selectedColor, notes:$('eventNotes').value.trim(), recurrence_rule:rec };
  if(hmToMin(e.end_time)<=hmToMin(e.start_time)){ alert('End time has to be after start time. Time goblin denied.'); return; }
  await saveEvent(e); $('eventDialog').close(); render();
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
init();
