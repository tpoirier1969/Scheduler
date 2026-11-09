const PEOPLE = {
  donna: { label: 'Donna', palette: ['#f5c6d6', '#c8dff0', '#d8c7ef', '#cde8d1', '#f8d7a8', '#f5e6a8', '#ffd6cc', '#d7e7e4'], presets: ['Class','Lesson','Rehearsal','Meeting','Performance','No-show','Other'] },
  tod: { label: 'Tod', palette: ['#d8dde2', '#c8d0d8', '#b6c1cc', '#a9b0b8', '#8f9aa3', '#737f87', '#60707a', '#4f5b63'], presets: ['Meeting','Event','Appointment','Other'] },
  frank: { label: 'Frank', palette: ['#c9b18f', '#b99767', '#9f7f55', '#d5c0a2', '#a58c6f', '#7d6a55', '#b9aa7f', '#8b7a4d'], presets: ['Doctor','Hair','Church','Appointment','Other'] },
  shared: { label: 'Shared', palette: ['#b7d4c5', '#e3c97f', '#c79c8a', '#9eb7c7', '#d3b4c6', '#c8c3a2', '#f0cfa8', '#a8bfa0'], presets: ['Camping','Roadtrip','Shopping','Friends','Family','Other'] }
};
const PRESET_DEFAULT = { Class:0, Lesson:1, Rehearsal:2, Meeting:3, Performance:4, 'No-show':6, Event:2, Doctor:0, Hair:1, Church:6, Appointment:2, Camping:0, Roadtrip:3, Shopping:1, Friends:4, Family:2, Other:7 };
const START_HOUR = 6;
const END_HOUR = 24;
let state = { weekStart: startOfWeek(new Date()), filter:'all', events:[], exceptions:[], studentList:{ group: defaultStudentGroupName(), students:[], names:[] }, selectedColor:'#c8dff0', supabase:null, storageMode:'local', focusDate:null, detailsEvent:null, pendingScrollDate:isoDate(new Date()), adjustingScroll:false, viewMode:'week', editScope:null };
let appReady = false;
let resumeRefreshTimer = null;
if('scrollRestoration' in history) history.scrollRestoration = 'manual';

const $ = id => document.getElementById(id);
function startOfWeek(d){ const x=new Date(d); x.setHours(0,0,0,0); const day=x.getDay(); const diff=(day+6)%7; x.setDate(x.getDate()-diff); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function isoDate(d){ const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }
function hmToMin(hm){ const [h,m]=hm.split(':').map(Number); return h*60+m; }
function minToHm(min){ return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }
function daysInMonth(year, monthIndex){ return new Date(year, monthIndex + 1, 0).getDate(); }
function monthDiff(a,b){ return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()); }
function sameCalendarDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function monthlyAnchorDate(base, target, intervalMonths){
  const diff=monthDiff(base,target);
  if(diff < 0 || diff % intervalMonths !== 0) return false;
  const anchorDay=Math.min(base.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  return target.getDate()===anchorDay;
}
function yearlyAnchorDate(base,target){
  if(target.getFullYear() < base.getFullYear()) return false;
  if(base.getMonth()===1 && base.getDate()===29){
    const anchorDay=daysInMonth(target.getFullYear(),1)===29 ? 29 : 28;
    return target.getMonth()===1 && target.getDate()===anchorDay;
  }
  return target.getMonth()===base.getMonth() && target.getDate()===base.getDate();
}
function normalizeRepeatInterval(value){
  const n=Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n,99) : 1;
}
function normalizeRepeatUnit(value){
  const unit=String(value||'').toLowerCase();
  if(['day','week','month','year'].includes(unit)) return unit;
  const legacy={ daily:'day', weekly:'week', monthly:'month', quarterly:'month', yearly:'year', annual:'year' };
  return legacy[unit] || 'week';
}
function legacyIntervalFromFrequency(freq){
  return freq==='quarterly' ? 3 : 1;
}
function getRepeatParts(rule){
  const unit=normalizeRepeatUnit(rule?.unit || rule?.frequency);
  const interval=normalizeRepeatInterval(rule?.interval || legacyIntervalFromFrequency(rule?.frequency));
  return { unit, interval };
}
function recurringEventOccursOn(e,d){
  const rule=e.recurrence_rule;
  if(!rule?.enabled) return false;
  const base=new Date(e.date+'T00:00');
  const target=new Date(isoDate(d)+'T00:00');
  if(target <= base) return false;
  if(rule.until && target > new Date(rule.until+'T23:59:59')) return false;
  const {unit, interval}=getRepeatParts(rule);
  if(unit==='day'){
    const diffDays=Math.round((target-base)/86400000);
    return diffDays > 0 && diffDays % interval === 0;
  }
  if(unit==='week'){
    const days=rule.days?.length ? rule.days.map(Number) : [base.getDay()];
    if(!days.includes(target.getDay())) return false;
    const weekStartBase=startOfWeek(base);
    const weekStartTarget=startOfWeek(target);
    const diffWeeks=Math.round((weekStartTarget-weekStartBase)/(86400000*7));
    return diffWeeks >= 0 && diffWeeks % interval === 0;
  }
  if(unit==='month') return monthlyAnchorDate(base,target,interval);
  if(unit==='year'){
    const diffYears=target.getFullYear()-base.getFullYear();
    return diffYears > 0 && diffYears % interval === 0 && yearlyAnchorDate(base,target);
  }
  return false;
}
function recurrenceLabel(rule){
  if(!rule?.enabled) return 'None';
  const {unit, interval}=getRepeatParts(rule);
  const unitLabel=unit.charAt(0).toUpperCase()+unit.slice(1)+(interval===1?'':'s');
  const label=interval===1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  return `${label}${rule.until ? ' until '+rule.until : ''}`;
}

function fmtDate(d){ return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function fmtDay(d){ return d.toLocaleDateString(undefined,{weekday:'short'}); }
function fmtTime(hm){ const [rawH,m]=hm.split(':').map(Number); const h=((rawH%24)+24)%24; const suffix=h>=12?'pm':'am'; const hr=((h+11)%12)+1; return `${hr}:${String(m).padStart(2,'0')}${suffix}`; }
function uuid(){ return crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2); }
function defaultStudentGroupName(){ return 'Active Students'; }
function normalizeLessonMinutes(value){ const n=Number(value); return [30,60].includes(n) ? n : 30; }
function normalizeStudentList(list){
  const group=(list?.group || list?.semester || defaultStudentGroupName()).trim() || defaultStudentGroupName();
  const rawStudents=Array.isArray(list?.students) && list.students.length
    ? list.students
    : (Array.isArray(list?.names) ? list.names.map(name=>({ name, standard_lesson_minutes:30 })) : []);
  const seen=new Set();
  const students=[];
  for(const item of rawStudents){
    const name=String(item?.name ?? item?.student_name ?? item ?? '').trim();
    if(!name) continue;
    const key=name.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    students.push({ id:item?.id, name, standard_lesson_minutes: normalizeLessonMinutes(item?.standard_lesson_minutes ?? item?.lesson_minutes ?? item?.minutes ?? 30) });
  }
  students.sort((a,b)=>a.name.localeCompare(b.name));
  return { group, students, names: students.map(s=>s.name) };
}
function parseStudentLine(line){
  const raw=String(line||'').trim();
  if(!raw) return null;
  const parts=raw.split(/\s*[|,\t]\s*/).filter(Boolean);
  const name=(parts[0]||'').trim();
  const minutes=normalizeLessonMinutes(parts[1] || 30);
  return name ? { name, standard_lesson_minutes: minutes } : null;
}
function formatStudentLine(student){ return `${student.name} | ${normalizeLessonMinutes(student.standard_lesson_minutes)}`; }
function getStudentByName(name){ const key=String(name||'').toLowerCase(); return (state.studentList.students||[]).find(s=>s.name.toLowerCase()===key); }

async function init(){
  document.body.classList.add('zoom-compact');
  setupSupabase();
  setupControls();
  setupZoomGuards();
  setupSwipeNavigation();
  setupNoShowContextClose();
  setupAppResume();
  fillPersonSelect();
  await loadStudentList().catch(err=>showSyncError('Students could not load.',err));
  await loadEvents();
  await loadExceptions();
  focusTodayOnLaunch();
  render();
  appReady = true;
  forceTodayRailPosition();
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
    if(error){
      state.events = [];
      setSyncStatus('Supabase load failed — not showing private/local events.', 'error');
      showSyncError('Supabase could not load shared events. Check that the latest SQL has been run and RLS/policies allow access.', error);
      return;
    }
    PlannerStore.capture('tod_donna_calendar_events', data||[]);
    state.events=(data||[]).map(fromDb);
    return;
  }
  if(PlannerStore.restoreLocal()){
    state.events=PlannerStore.rows('tod_donna_calendar_events').map(fromDb); return;
  }
  const saved = localStorage.getItem('tod_donna_calendar_events_v1');
  if(saved){ state.events=JSON.parse(saved); PlannerStore.capture('tod_donna_calendar_events',state.events.map(toDb)); return; }
  state.events=[];
  await saveAllLocal();
}

async function loadExceptions(){
  if(state.storageMode==='supabase'){
    const { data, error } = await state.supabase.from('tod_donna_calendar_event_exceptions').select('*');
    if(error){
      state.exceptions=[];
      setSyncStatus('Recurring exceptions could not be loaded.', 'error');
      showSyncError('Recurring occurrence changes could not be loaded.', error);
      return;
    }
    state.exceptions=data||[]; PlannerStore.capture('tod_donna_calendar_event_exceptions',state.exceptions);
    return;
  }
  if(PlannerStore.restoreLocal()){state.exceptions=PlannerStore.rows('tod_donna_calendar_event_exceptions');return;}
  try{ state.exceptions=JSON.parse(localStorage.getItem('tod_donna_calendar_event_exceptions_v1')||'[]'); PlannerStore.capture('tod_donna_calendar_event_exceptions',state.exceptions); }
  catch{ state.exceptions=[]; }
}
function exceptionFor(parentId, originalDate){
  return state.exceptions.find(x=>x.parent_event_id===parentId && x.original_event_date===originalDate) || null;
}
function parentEventFor(e){
  const id=e?.parent_event_id || (e?.recurrence_rule?.enabled ? e.id : null);
  return id ? state.events.find(x=>x.id===id) || null : null;
}
function previousDate(dateStr){ return isoDate(addDays(new Date(dateStr+'T00:00'),-1)); }
async function saveException(ex){
  const old=exceptionFor(ex.parent_event_id,ex.original_event_date);
  const id=old?.id||ex.id||uuid();
  const patch={...ex,id};
  if(!old) Object.assign(patch,{exception_status:ex.exception_status||'modified'});
  await PlannerStore.commit([PlannerStore.change('tod_donna_calendar_event_exceptions',id,patch)]);
  state.exceptions=PlannerStore.rows('tod_donna_calendar_event_exceptions');
}
function isSeriesOccurrence(e){ return !!(e?.recurring_instance || e?.recurrence_rule?.enabled); }
function handleEditDetails(){
  const e=state.detailsEvent;if(!e)return;
  $('eventDetailsDialog').close();
  if(isSeriesOccurrence(e)){
    const parent=parentEventFor(e);
    if(!parent){alert('Series could not be found.');return;}
    openDialog(e,{type:'occurrence',parentId:parent.id,originalDate:e.original_event_date||e.date});
  }else openDialog(e);
}

async function loadStudentList(){
  state.studentsLoaded=false;
  const fallback = () => {
    const saved = localStorage.getItem('tod_donna_calendar_active_students_v1') || localStorage.getItem('tod_donna_calendar_student_list_v1');
    if(saved){
      try { state.studentList = normalizeStudentList(JSON.parse(saved)); }
      catch { state.studentList = normalizeStudentList({ group: defaultStudentGroupName(), students: [] }); }
    } else {
      state.studentList = normalizeStudentList({group:defaultStudentGroupName(),students:[]});
      saveStudentListLocal();
    }
    fillStudentQuickAddSelect();
  };
  if(state.storageMode==='supabase'){
    const { data, error } = await state.supabase
      .from('tod_donna_calendar_active_students')
      .select('*')
      .order('sort_order');
    if(!error){
      PlannerStore.capture('tod_donna_calendar_active_students',data||[]);
      state.studentList = normalizeStudentList({
        group: data.find(r=>r.is_active)?.student_group || defaultStudentGroupName(),
        students: data.filter(r=>r.is_active).map(r => ({ id:r.id,name:r.student_name, standard_lesson_minutes:r.standard_lesson_minutes }))
      });
      saveStudentListLocal();
      fillStudentQuickAddSelect();state.studentsLoaded=true;
      return;
    }
    if(error){state.studentList=normalizeStudentList({students:[]});fillStudentQuickAddSelect();throw new Error('Student list could not load. '+error.message);}
  }
  if(PlannerStore.restoreLocal()){const rows=PlannerStore.rows('tod_donna_calendar_active_students').filter(r=>r.is_active);state.studentList=normalizeStudentList({group:rows[0]?.student_group,students:rows.map(r=>({id:r.id,name:r.student_name,standard_lesson_minutes:r.standard_lesson_minutes}))});fillStudentQuickAddSelect();state.studentsLoaded=true;return;}
  fallback();state.studentsLoaded=true;
  PlannerStore.capture('tod_donna_calendar_active_students',state.studentList.students.map((r,i)=>({id:r.id||uuid(),student_group:state.studentList.group,student_name:r.name,standard_lesson_minutes:r.standard_lesson_minutes,sort_order:i,is_active:true})));
}
function buildStudentListFromEvents(events){
  const excluded = new Set(['tod','dad','frank','showcase','opening night','9 to 5','schedule theory','vocal ensemble']);
  const names = [...new Set(events
    .filter(e => e.person_key === 'donna' && (e.preset_name === 'Lesson' || e.preset_name === 'No-show'))
    .map(e => String(e.title || '').replace(/^No\s+/i,'').trim())
    .filter(x => x && !excluded.has(x.toLowerCase())))]
    .sort((a,b)=>a.localeCompare(b));
  return { group: defaultStudentGroupName(), students: names.map(name=>({ name, standard_lesson_minutes:30 })), names };
}
function saveStudentListLocal(){state.studentList=normalizeStudentList(state.studentList);localStorage.setItem(state.storageMode==='supabase'?'tod_donna_calendar_shared_students_cache_v2':'tod_donna_calendar_active_students_v1',JSON.stringify(state.studentList));}
async function saveStudentList(){
  if(!state.studentsLoaded)throw new Error('Student list did not load. Refresh before editing it.');
  const group=($('semesterNameInput').value||defaultStudentGroupName()).trim();
  const rows=[...document.querySelectorAll('.student-row')].map(row=>({id:row.dataset.studentId||uuid(),name:row.querySelector('.student-name-input').value.trim(),minutes:normalizeLessonMinutes(row.querySelector('.student-minutes-select').value)})).filter(r=>r.name);
  if(new Set(rows.map(r=>r.name.toLowerCase())).size!==rows.length)throw new Error('Student names must be unique.');
  const old=PlannerStore.rows('tod_donna_calendar_active_students');
  for(const r of rows){if(!old.some(x=>x.id===r.id)){const inactive=old.find(x=>!x.is_active&&x.student_group===group&&x.student_name.toLowerCase()===r.name.toLowerCase());if(inactive)r.id=inactive.id;}}
  const changes=rows.map((r,i)=>PlannerStore.change('tod_donna_calendar_active_students',r.id,{id:r.id,student_group:group,student_name:r.name,standard_lesson_minutes:r.minutes,sort_order:i,is_active:true}));
  for(const r of old.filter(r=>r.is_active&&!rows.some(x=>x.id===r.id)))changes.push(PlannerStore.change('tod_donna_calendar_active_students',r.id,{is_active:false}));
  if(changes.length)await PlannerStore.commit(changes);
  await loadStudentList();
}
function addStudentEditorRow(student={name:'', standard_lesson_minutes:30}){
  const wrap=$('studentRows');
  if(!wrap) return;
  const row=document.createElement('div');
  row.className='student-row';row.dataset.studentId=student.id||uuid();
  row.innerHTML=`<input class="student-name-input" placeholder="Student name" value="${escapeHtml(student.name||'')}" />
    <select class="student-minutes-select" aria-label="Standard lesson time">
      <option value="30" ${normalizeLessonMinutes(student.standard_lesson_minutes)===30?'selected':''}>30 min</option>
      <option value="60" ${normalizeLessonMinutes(student.standard_lesson_minutes)===60?'selected':''}>60 min</option>
    </select>
    <button type="button" class="remove-student-row" aria-label="Remove student">×</button>`;
  row.querySelector('.remove-student-row').onclick=()=>row.remove();
  wrap.appendChild(row);
}
function renderStudentEditorRows(){
  const wrap=$('studentRows');
  if(!wrap) return;
  wrap.innerHTML='';
  const students=(state.studentList.students||[]);
  if(!students.length) addStudentEditorRow({name:'', standard_lesson_minutes:30});
  students.forEach(addStudentEditorRow);
}
function fillStudentQuickAddSelect(){
  const sel = $('studentQuickAddSelect');
  if(!sel) return;
  const label = state.studentList?.group ? `Choose student… (${state.studentList.group})` : 'Choose student…';
  sel.innerHTML = `<option value="">${escapeHtml(label)}</option>` + (state.studentList.students || []).map(s=>`<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} · ${normalizeLessonMinutes(s.standard_lesson_minutes)} min</option>`).join('');
}

function fromDb(r){
  return {...r,date:r.event_date,start_time:(r.start_time||'00:00').slice(0,5),end_time:(r.end_time||'23:59').slice(0,5),is_all_day:!!r.is_all_day,notes:r.notes??'',color:r.color_hex,source:r.imported_source,imported:!!r.imported_source};
}
function toDb(e){
  return { id:e.id, title:e.title, person_key:e.person_key, preset_name:e.preset_name, status:e.status, event_date:e.date, start_time:e.is_all_day ? '00:00' : e.start_time, end_time:e.is_all_day ? '23:59' : e.end_time, is_all_day:!!e.is_all_day, notes:e.notes, color_hex:e.color, recurrence_rule:e.recurrence_rule, imported_source:e.source||null };
}
async function saveEvent(e){
  const patch={...toDb(e)};
  if(e.archived_from!==undefined)patch.archived_from=e.archived_from;
  if(e.cancellation_from!==undefined)patch.cancellation_from=e.cancellation_from;
  await PlannerStore.commit([PlannerStore.change('tod_donna_calendar_events',e.id,patch)]);
  state.events=PlannerStore.rows('tod_donna_calendar_events').map(fromDb);
  if(state.storageMode!=='supabase') await saveAllLocal();
  setSyncStatus(state.storageMode==='supabase'?'Saved to shared calendar':'Saved on this device only');
}
async function saveAllLocal(){ localStorage.setItem('tod_donna_calendar_events_v1', JSON.stringify(state.events)); }
function showSyncError(message, error){
  const detail = error?.message || error?.details || error?.hint || String(error || '');
  console.error(message, error || '');
  const full = detail ? `${message}\n\n${detail}` : message;
  alert(full);
}
function setSyncStatus(message, tone='ok'){
  let el=document.getElementById('syncStatus');
  if(!el){
    el=document.createElement('div');
    el.id='syncStatus';
    el.className='sync-status';
    document.body.appendChild(el);
  }
  el.textContent=message;
  el.dataset.tone=tone;
  el.classList.remove('hidden');
  clearTimeout(setSyncStatus._t);
  setSyncStatus._t=setTimeout(()=>el.classList.add('hidden'), tone==='error'?9000:2400);
}

function setupZoomGuards(){
  // Phone web-app behavior: do not let two-finger pinch zoom wreck the 3-day rail.
  ['gesturestart','gesturechange','gestureend'].forEach(name=>{
    document.addEventListener(name, ev=>ev.preventDefault(), { passive:false });
  });
  document.addEventListener('touchmove', ev=>{
    if(ev.touches && ev.touches.length > 1) ev.preventDefault();
  }, { passive:false });
}

function setupControls(){
  $('prevWeekBtn').onclick=()=>{ shiftVisibleRange(-1); closeToolbarMenu(); render(); };
  $('nextWeekBtn').onclick=()=>{ shiftVisibleRange(1); closeToolbarMenu(); render(); };
  $('todayBtn').onclick=()=>{ state.weekStart=startOfWeek(new Date()); closeToolbarMenu(); render(); };
  $('menuTodayBtn').onclick=()=>{ state.weekStart=startOfWeek(new Date()); state.viewMode='week'; document.body.classList.remove('month-view-active'); closeToolbarMenu(); render(); };
  $('monthViewBtn').onclick=()=>toggleMonthView();
  if($('monthToggleBtn')) $('monthToggleBtn').onclick=()=>toggleMonthView();
  $('weekRangeBtn').onclick=()=>toggleToolbarMenu();
  $('navMenuBtn').onclick=()=>toggleToolbarMenu();
  $('weekPicker').onchange=e=>{ if(e.target.value){ state.weekStart=startOfWeek(new Date(e.target.value+'T00:00')); state.viewMode='week'; document.body.classList.remove('month-view-active'); closeToolbarMenu(); render(); } };
  if($('eventDateButton')) $('eventDateButton').onclick=openEventDatePicker;
  if($('eventDate')) $('eventDate').addEventListener('change', updateEventDateButton);
  $('zoomSelect').onchange=e=>{ document.body.classList.remove('zoom-compact','zoom-detailed'); document.body.classList.add('zoom-'+e.target.value); };
  $('calendarSelect').onchange=e=>{ state.filter=e.target.value; state.focusDate=null; document.body.classList.remove('focus-day'); closeToolbarMenu(); render(); };
  $('addEventBtn').onclick=()=>openDialog({date: firstVisibleRailDate ? firstVisibleRailDate() : isoDate(new Date()), start_time:'09:00', end_time:'09:30', person_key:defaultPerson()});
  if($('studentsHeaderBtn')) $('studentsHeaderBtn').onclick=openStudentListDialog;
  const defaultPersonSetting = $('defaultPersonSetting');
  if(defaultPersonSetting){
    defaultPersonSetting.value=defaultPerson();
    defaultPersonSetting.dataset.ready='true';
    window.addEventListener('storage',event=>{
      if(event.key==='planner_default_person'){
        defaultPersonSetting.value=PEOPLE[event.newValue]?event.newValue:'tod';
      }
    });
    defaultPersonSetting.onchange=()=>{
      const selected=defaultPersonSetting.value;
      if(!PEOPLE[selected]){ defaultPersonSetting.value=defaultPerson(); return; }
      try{
        localStorage.setItem('planner_default_person',selected);
        setSyncStatus('Default Person on this device: '+PEOPLE[selected].label);
      }catch(error){
        defaultPersonSetting.value=defaultPerson();
        showSyncError('Could not save the Default Person setting on this device.',error);
      }
    };
  }
  $('personSelect').onchange=()=>{fillPresetSelect();$('presetSelect').value=defaultPreset($('personSelect').value);state.selectedColor=PEOPLE[$('personSelect').value].palette[PRESET_DEFAULT[$('presetSelect').value]??0];fillPalette();updateQuickAddVisibility();};
  $('presetSelect').onchange=()=>{ const p=$('personSelect').value, preset=$('presetSelect').value; const idx=PRESET_DEFAULT[preset] ?? 0; state.selectedColor=PEOPLE[p].palette[idx]; fillPalette(); if(preset==='No-show') $('statusSelect').value='no_show'; updateQuickAddVisibility(); };
  $('repeatToggle').onchange=e=>$('repeatControls').classList.toggle('hidden', !e.target.checked);
  if($('allDayCheck')) $('allDayCheck').onchange=updateAllDayControls;
  ['eventTitle','eventDate','startTime','endTime','personSelect','allDayCheck'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('input', updateDuplicateWarning); if(el) el.addEventListener('change', updateDuplicateWarning); });
  $('eventForm').onsubmit=async ev=>{ev.preventDefault();await submitForm();};
  $('saveEventBtn').onclick=async ev=>{ev.preventDefault();await submitForm();};
  $('deleteEventBtn').onclick=()=>handleDeleteEditor().catch(err=>alert(err.message));
  $('cancelEventBtn').onclick=()=>{$('eventDialog').close();};
  $('studentQuickAddSelect').onchange=e=>applyStudentQuickAdd(e.target.value);
  $('manageStudentsBtn').onclick=openStudentListDialog;
  if($('manageStudentsMenuBtn')) $('manageStudentsMenuBtn').onclick=()=>{ closeToolbarMenu(); openStudentListDialog(); };
  $('closeStudentsBtn').onclick=()=>$('studentListDialog').close();
  $('cancelStudentsBtn').onclick=()=>$('studentListDialog').close();
  $('addStudentRowBtn').onclick=()=>addStudentEditorRow({name:'', standard_lesson_minutes:30});
  $('saveStudentsBtn').onclick=async()=>{const b=$('saveStudentsBtn');b.disabled=true;try{await saveStudentList();$('studentListDialog').close();}catch(err){alert(err.message);}finally{b.disabled=false;}};
  $('closeDetailsBtn').onclick=()=>$('eventDetailsDialog').close();
  $('editDetailsBtn').onclick=()=>handleEditDetails();
  $('deleteDetailsBtn').onclick=()=>handleDeleteDetails().catch(err=>alert(err.message));
  document.addEventListener('click', ev=>{ if(!ev.target.closest('.toolbar')) closeToolbarMenu(); });
}
function toggleToolbarMenu(){ const tb=document.querySelector('.toolbar'); const open=!tb.classList.contains('menu-open'); tb.classList.toggle('menu-open', open); $('navMenuBtn').setAttribute('aria-expanded', String(open)); }
function closeToolbarMenu(){ const tb=document.querySelector('.toolbar'); if(tb){ tb.classList.remove('menu-open'); } if($('navMenuBtn')) $('navMenuBtn').setAttribute('aria-expanded','false'); }
function toggleMonthView(){ state.viewMode = state.viewMode==='month' ? 'week' : 'month'; document.body.classList.toggle('month-view-active', state.viewMode==='month'); closeToolbarMenu(); render(); }
function visibleRangeStart(){ return isScrollableDayRail() ? new Date((firstVisibleRailDate() || isoDate(state.weekStart))+'T00:00') : state.weekStart; }
function monthTitle(d){ return d.toLocaleDateString(undefined,{month:'long',year:'numeric'}); }
function dialogDateText(dateStr){
  if(!dateStr) return 'Pick date';
  const d=new Date(dateStr+'T00:00');
  if(Number.isNaN(d.getTime())) return 'Pick date';
  return d.toLocaleDateString(undefined,{weekday:'short', month:'short', day:'numeric'});
}
function updateEventDateButton(){
  const btn=$('eventDateButton');
  const input=$('eventDate');
  if(btn && input) btn.textContent=dialogDateText(input.value);
}
function openEventDatePicker(){
  const input=$('eventDate');
  if(!input) return;
  input.removeAttribute('aria-hidden');
  if(typeof input.showPicker === 'function'){
    try { input.showPicker(); return; } catch(err) {}
  }
  input.focus({preventScroll:true});
  input.click();
}
function shiftVisibleRange(direction){
  if(state.viewMode==='month'){ const d=new Date(state.weekStart); d.setDate(1); d.setMonth(d.getMonth()+direction); state.weekStart=startOfWeek(d); return; }
  state.weekStart=addDays(state.weekStart, direction*7);
}
function weekRangeText(startOverride=null){ if(state.viewMode==='month') return monthTitle(addDays(state.weekStart,3)); const days=visibleDayCount(); const start=startOverride || visibleRangeStart(); const end=addDays(start, days-1); return `${fmtDate(start)} – ${fmtDate(end)}`; }
function updateVisibleRangeUI(){
  if(state.viewMode==='month') return;
  const start=visibleRangeStart();
  const days=visibleDayCount();
  $('weekRangeBtn').textContent=weekRangeText(start);
  const events=expandEventsForRange(start, days);
  renderPrint(events, start, days);
}
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
    updateVisibleRangeUI();
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
  setTimeout(()=>{ state.adjustingScroll=false; updateVisibleRangeUI(); }, 120);
}

function focusTodayOnLaunch(){
  const today = isoDate(new Date());
  state.weekStart = startOfWeek(new Date(today + 'T00:00'));
  state.focusDate = null;
  state.viewMode = 'week';
  state.pendingScrollDate = today;
  document.body.classList.remove('month-view-active','focus-day');
}
function setupAppResume(){
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden) refreshTodayAfterResume();
  });
  window.addEventListener('pageshow', ()=>refreshTodayAfterResume());
  window.addEventListener('focus', ()=>refreshTodayAfterResume());
}
function refreshTodayAfterResume(){
  if(!appReady || document.hidden) return;
  clearTimeout(resumeRefreshTimer);
  resumeRefreshTimer=setTimeout(()=>{
    focusTodayOnLaunch();
    render();
    forceTodayRailPosition();
  }, 50);
}
function forceTodayRailPosition(){
  const today=isoDate(new Date());
  const place=()=>{
    state.pendingScrollDate=today;
    scrollRailToDate(today);
  };
  requestAnimationFrame(()=>{
    place();
    requestAnimationFrame(place);
  });
  [120,300,700,1200].forEach(ms=>setTimeout(place,ms));
}
function slotTimeFromPointer(ev, timeline){
  const rect = timeline.getBoundingClientRect();
  const styles = getComputedStyle(timeline);
  const gutter = parseFloat(styles.getPropertyValue('--time-label-gutter')) || 0;
  const hourHeight = parseFloat(styles.getPropertyValue('--hour-height')) || 64;
  const rawY = ev.clientY - rect.top - gutter;
  const rawMinutes = START_HOUR * 60 + (rawY / hourHeight) * 60;
  const snapped = Math.round(rawMinutes / 30) * 30;
  const min = START_HOUR * 60;
  const max = Math.min(END_HOUR * 60 - 30, 23 * 60);
  return minToHm(Math.max(min, Math.min(max, snapped)));
}
function openAddFromTimeline(ev, dateStr, timeline){
  if(ev.target.closest('.event-block') || ev.target.closest('button')) return;
  ev.preventDefault();
  ev.stopPropagation();
  const start = slotTimeFromPointer(ev, timeline);
  const end = minToHm(Math.min(END_HOUR * 60, hmToMin(start) + 30));
  openDialog({date:dateStr,start_time:start,end_time:end,person_key:defaultPerson()});
}
function firstVisibleRailDate(){
  const grid=$('calendarGrid');
  if(!grid) return isoDate(state.weekStart);
  const gridRect=grid.getBoundingClientRect();
  let best=null;
  let bestOverlap=-1;
  for(const col of grid.children){
    const r=col.getBoundingClientRect();
    const overlap=Math.min(r.right, gridRect.right)-Math.max(r.left, gridRect.left);
    if(overlap>bestOverlap){ bestOverlap=overlap; best=col; }
    if(overlap > r.width * 0.52 && r.left >= gridRect.left - 8){
      return col.dataset.date || isoDate(state.weekStart);
    }
  }
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


function setupNoShowContextClose(){
  document.addEventListener('click', closeNoShowContext);
  document.addEventListener('keydown', ev=>{ if(ev.key==='Escape') closeNoShowContext(); });
  window.addEventListener('scroll', closeNoShowContext, true);
}
function closeNoShowContext(){
  const menu=$('noShowContextMenu');
  if(menu){ menu.remove(); }
}
function canToggleNoShow(e){ return !!e; }
async function toggleNoShowForEvent(e){
  await changeOccurrenceStatus(e,e.status==='no_show'?'scheduled':'no_show');
  closeNoShowContext();render();
}
function showNoShowContext(e, x, y){
  closeNoShowContext();
  const menu=document.createElement('div');
  menu.id='noShowContextMenu';
  menu.className='no-show-context-menu';
  const isNoShow=e.status==='no_show';
  const allowed=canToggleNoShow(e);
  menu.innerHTML=`<button type="button" ${allowed?'':'disabled'}>${isNoShow?'Remove no-show slash':'Mark no-show'}</button><small>${allowed?'Mark this event as missed/no-show':'No-show unavailable'}</small>`;
  menu.querySelector('button').onclick=async ev=>{ev.stopPropagation();try{await toggleNoShowForEvent(e);}catch(err){alert(err.message);}};
  document.body.appendChild(menu);
  const rect=menu.getBoundingClientRect();
  menu.style.left=Math.min(x, window.innerWidth-rect.width-8)+'px';
  menu.style.top=Math.min(y, window.innerHeight-rect.height-8)+'px';
}
function attachNoShowGestures(div,e){
  div.addEventListener('contextmenu', ev=>{
    ev.preventDefault(); ev.stopPropagation();
    showNoShowContext(e, ev.clientX, ev.clientY);
  });
  let pressTimer=null;
  div.addEventListener('touchstart', ev=>{
    if(ev.touches.length!==1) return;
    const t=ev.touches[0];
    pressTimer=setTimeout(()=>showNoShowContext(e, t.clientX, t.clientY), 620);
  }, {passive:true});
  ['touchend','touchmove','touchcancel','pointercancel'].forEach(name=>div.addEventListener(name,()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; } }, {passive:true}));
}


function normalizeTitleForDuplicate(title){
  return String(title||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function titlesSimilar(a,b){
  const x=normalizeTitleForDuplicate(a), y=normalizeTitleForDuplicate(b);
  if(!x || !y) return false;
  if(x===y) return true;
  return x.length>=4 && y.length>=4 && (x.includes(y) || y.includes(x));
}
function eventsOverlap(a,b){
  if(a.is_all_day || b.is_all_day) return !!a.is_all_day && !!b.is_all_day;
  return hmToMin(a.start_time) < hmToMin(b.end_time) && hmToMin(a.end_time) > hmToMin(b.start_time);
}
function findDuplicateEvents(candidate){
  if(!candidate?.date || !candidate?.person_key) return [];
  if(!candidate.is_all_day && (!candidate.start_time || !candidate.end_time || hmToMin(candidate.end_time) <= hmToMin(candidate.start_time))) return [];
  return state.events.filter(e=>
    e.id !== candidate.id &&
    e.date === candidate.date &&
    e.person_key === candidate.person_key &&
    e.status !== 'cancelled' &&
    eventsOverlap(candidate,e) &&
    titlesSimilar(candidate.title, e.title)
  ).slice(0,3);
}
function formCandidateEvent(){
  return {
    id:$('eventId')?.value || '',
    title:$('eventTitle')?.value || '',
    person_key:$('personSelect')?.value || 'donna',
    date:$('eventDate')?.value || '',
    start_time:$('startTime')?.value || '09:00',
    end_time:$('endTime')?.value || '09:30',
    is_all_day:!!$('allDayCheck')?.checked
  };
}
function updateDuplicateWarning(){
  const box=$('duplicateWarning');
  if(!box) return;
  const matches=findDuplicateEvents(formCandidateEvent());
  if(!matches.length){ box.classList.add('hidden'); box.innerHTML=''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<strong>Possible duplicate</strong><br>${matches.map(e=>`${escapeHtml(e.title)} · ${e.is_all_day ? 'All day' : fmtTime(e.start_time)+'–'+fmtTime(e.end_time)}`).join('<br>')}<br><small>You can still save if this is intentional.</small>`;
}


function updateAllDayControls(){
  const checked=!!$('allDayCheck')?.checked;
  const row=$('timeRow');
  if(row) row.classList.toggle('hidden', checked);
  ['startTime','endTime'].forEach(id=>{ const el=$(id); if(el) el.required=!checked; });
  updateDuplicateWarning();
}

function fillPersonSelect(){ $('personSelect').innerHTML=Object.entries(PEOPLE).map(([k,p])=>`<option value="${k}">${p.label}</option>`).join(''); fillPresetSelect(); fillPalette(); }
function fillPresetSelect(){ const p=$('personSelect').value||'donna'; $('presetSelect').innerHTML=PEOPLE[p].presets.map(x=>{ const c=PEOPLE[p].palette[PRESET_DEFAULT[x] ?? 0]; return `<option style="background:${c}">${x}</option>`; }).join(''); }
function updateQuickAddVisibility(){ const row=$('studentQuickAddRow'); const hint=$('studentQuickAddHint'); if(!row) return; const show=$('personSelect').value==='donna'; row.classList.toggle('hidden', !show); if(hint) hint.classList.toggle('hidden', !show); }
function applyStudentQuickAdd(name){ if(!name) return; const student=getStudentByName(name); $('eventTitle').value=name; $('personSelect').value='donna'; fillPresetSelect(); $('presetSelect').value='Lesson'; $('statusSelect').value='scheduled'; if(student){ const start=hmToMin($('startTime').value || '09:00'); $('endTime').value=minToHm(start + normalizeLessonMinutes(student.standard_lesson_minutes)); } state.selectedColor=PEOPLE.donna.palette[PRESET_DEFAULT.Lesson]; fillPalette(); updateQuickAddVisibility(); updateDuplicateWarning(); }
function openStudentListDialog(){ if(!state.studentsLoaded){alert('Student list did not load. Refresh before editing it.');return;} state.studentList=normalizeStudentList(state.studentList); $('semesterNameInput').value=state.studentList.group || defaultStudentGroupName(); renderStudentEditorRows(); $('studentListDialog').showModal(); }
function fillPalette(){ const p=$('personSelect').value||'donna'; $('colorPalette').innerHTML=''; PEOPLE[p].palette.forEach(c=>{ const b=document.createElement('button'); b.type='button'; b.disabled=state.editScope?.type==='occurrence'; b.className='color-swatch'+(c===state.selectedColor?' selected':''); b.style.background=c; b.title=c; b.onclick=()=>{ state.selectedColor=c; fillPalette(); }; $('colorPalette').appendChild(b); }); }

function materializeSeriesOccurrence(parent,originalDate){
  const ex=exceptionFor(parent.id,originalDate);
  if((parent.archived_from && originalDate>=parent.archived_from)||ex?.hidden||ex?.new_notes===DELETED_OCCURRENCE_SENTINEL)return null;
  const legacy=ex?.exception_status==='cancelled'?'cancelled':(originalDate===parent.date?parent.status:'scheduled');
  const status=ex?.occurrence_status ?? ((parent.cancellation_from && originalDate>=parent.cancellation_from && legacy!=='no_show')?'cancelled':legacy);
  return {...parent,id:parent.id+'__'+originalDate,parent_event_id:parent.id,original_event_date:originalDate,recurring_instance:true,recurrence_exception_id:ex?.id||null,date:ex?.new_event_date||originalDate,start_time:(ex?.new_start_time||parent.start_time).slice(0,5),end_time:(ex?.new_end_time||parent.end_time).slice(0,5),title:ex?.new_title??parent.title,notes:ex?.new_notes??parent.notes,status};
}
function expandEventsForRange(rangeStart, rangeDays){
  const start=isoDate(rangeStart), end=isoDate(addDays(rangeStart,rangeDays));
  let out=[];
  for(const e of state.events){
    if(!e.recurrence_rule?.enabled){
      if(!e.archived_from && e.date>=start && e.date<end) out.push(e);
      continue;
    }
    for(let i=0;i<rangeDays;i++){
      const d=addDays(rangeStart,i);
      const ds=isoDate(d);
      if(ds===e.date || recurringEventOccursOn(e,d)){
        const item=materializeSeriesOccurrence(e,ds);
        if(item && item.date>=start && item.date<end) out.push(item);
      }
    }
    for(const ex of state.exceptions.filter(x=>x.parent_event_id===e.id && x.new_event_date && x.new_event_date>=start && x.new_event_date<end && (x.original_event_date<start || x.original_event_date>=end))){
      const item=materializeSeriesOccurrence(e,ex.original_event_date);
      if(item) out.push(item);
    }
  }
  out=[...new Map(out.map(e=>[e.id+'|'+e.date,e])).values()];
  if(state.filter!=='all') out=out.filter(e=>e.person_key===state.filter);
  return out;
}
function render(){
  $('weekPicker').value=isoDate(state.weekStart);
  $('weekRangeBtn').textContent=weekRangeText();
  document.body.classList.toggle('month-view-active', state.viewMode==='month');
  if($('monthViewBtn')) $('monthViewBtn').textContent = state.viewMode==='month' ? 'Week view' : 'Month view';
  if($('monthToggleBtn')) $('monthToggleBtn').textContent = state.viewMode==='month' ? '▤' : '▦';
  if(state.viewMode==='month'){
    const monthDate=addDays(state.weekStart,3);
    const events=expandEventsForRange(monthStartGrid(monthDate), 42);
    renderMonthView(events, monthDate);
    return;
  }
  $('monthView').classList.add('hidden');
  const range=renderRange();
  const events=expandEventsForRange(range.start, range.days);
  renderDensity(events); renderGrid(events); renderPrint(events, visibleRangeStart(), visibleDayCount());
}

function monthStartGrid(d){
  const first=new Date(d.getFullYear(), d.getMonth(), 1);
  const dow=first.getDay();
  const mondayOffset=(dow+6)%7;
  return addDays(first, -mondayOffset);
}
function renderMonthView(events, monthDate){
  const monthBox=$('monthView');
  monthBox.classList.remove('hidden');
  $('calendarGrid').innerHTML='';
  $('densityPanel').innerHTML='';
  $('printList').innerHTML='';
  const start=monthStartGrid(monthDate);
  const currentMonth=monthDate.getMonth();
  const weekdayLabels=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  monthBox.innerHTML = `<div class="month-header-row">${weekdayLabels.map(x=>`<div>${x}</div>`).join('')}</div><div class="month-grid"></div>`;
  const grid=monthBox.querySelector('.month-grid');
  for(let i=0;i<42;i++){
    const d=addDays(start,i);
    const ds=isoDate(d);
    const dayEvents=events.filter(e=>e.date===ds && e.status!=='cancelled');
    const cell=document.createElement('button');
    cell.type='button';
    cell.className='month-day'+(d.getMonth()!==currentMonth?' outside-month':'')+(ds<isoDate(new Date())?' past-month':'')+(ds===isoDate(new Date())?' today-month':'');
    const dots=dayEvents.slice(0,6).map(e=>{
      const label=(PEOPLE[e.person_key]?.label || '?').charAt(0);
      return `<span class="month-dot" style="background:${escapeHtml(e.color||'#ddd')}">${escapeHtml(label)}</span>`;
    }).join('');
    const extra=dayEvents.length>6 ? `<span class="month-extra">+${dayEvents.length-6}</span>` : '';
    cell.innerHTML=`<span class="month-date">${d.getDate()}</span><span class="month-dots">${dots}${extra}</span>`;
    cell.onclick=()=>{
      state.weekStart=startOfWeek(d);
      state.viewMode='week';
      state.focusDate=null;
      state.pendingScrollDate=ds;
      document.body.classList.remove('month-view-active','focus-day');
      closeToolbarMenu();
      render();
    };
    grid.appendChild(cell);
  }
}
function renderDensity(events){
  const panel=$('densityPanel'); panel.innerHTML='';
  for(let i=0;i<7;i++){ const d=addDays(state.weekStart,i); const ds=isoDate(d); const dayEvents=events.filter(e=>e.date===ds && e.status!=='cancelled'); const timedEvents=dayEvents.filter(e=>!e.is_all_day); const total=timedEvents.reduce((s,e)=>s+Math.max(0,hmToMin(e.end_time)-hmToMin(e.start_time)),0);
    const lunchFree=hasGap(timedEvents, 11*60, 14*60, 45);
    const level= total>=360 ? 'heavy' : total>=210 ? 'busy' : 'easy';
    const div=document.createElement('div'); div.className=`density-card density-level-${level}${ds<isoDate(new Date())?' past-density':''}`;
    div.innerHTML=`<div class="density-title">${fmtDay(d)} ${fmtDate(d)} · ${Math.round(total/60*10)/10} hrs</div><div class="density-note">${lunchFree?'Lunch window OK':'Lunch risk: no 45-min gap 11–2'}</div>`;
    panel.appendChild(div);
  }
}
function hasGap(events, start, end, need){
  const busy=events.filter(e=>!e.is_all_day).map(e=>[Math.max(start,hmToMin(e.start_time)), Math.min(end,hmToMin(e.end_time))]).filter(x=>x[1]>x[0]).sort((a,b)=>a[0]-b[0]);
  let cursor=start; for(const [a,b] of busy){ if(a-cursor>=need) return true; cursor=Math.max(cursor,b); } return end-cursor>=need;
}
function renderGrid(events){
  const grid=$('calendarGrid'); grid.innerHTML=''; const today=isoDate(new Date());
  grid.classList.remove('is-dragging','is-snapping');
  const phoneCarousel = isScrollableDayRail();
  const range=renderRange();
  grid.classList.toggle('phone-carousel', phoneCarousel);
  for(let i=0;i<range.days;i++){ const d=addDays(range.start,i); const ds=isoDate(d); const col=document.createElement('section'); col.className='day-column'+(ds===today?' current-day':'')+(ds<today?' past-day':''); col.dataset.date=ds;
    if(state.focusDate===ds) col.classList.add('focused');
    col.innerHTML=`<div class="day-header" title="Double-click to zoom this day"><div><strong>${fmtDay(d)}</strong><small>${fmtDate(d)}</small></div><button class="add-day" aria-label="Add event">+</button></div><div class="all-day-row" aria-label="All-day events"></div><div class="day-timeline"><div class="half-lines"></div></div>`;
    col.querySelector('.day-header').ondblclick=(ev)=>{ if(ev.target.closest('button')) return; state.focusDate = state.focusDate===ds ? null : ds; document.body.classList.toggle('focus-day', !!state.focusDate); render(); };
    col.querySelector('.add-day').onclick=()=>openDialog({date:ds,start_time:'09:00',end_time:'09:30',person_key:defaultPerson()});
    const tl=col.querySelector('.day-timeline');
    tl.addEventListener('click', ev=>openAddFromTimeline(ev, ds, tl));
    for(let h=START_HOUR; h<=END_HOUR; h++){ const lab=document.createElement('div'); lab.className='time-label'; lab.style.top = `calc(var(--time-label-gutter) + ${h-START_HOUR} * var(--hour-height))`; lab.textContent=fmtTime(String(h).padStart(2,'0')+':00'); tl.appendChild(lab); }
    const allDayWrap=col.querySelector('.all-day-row');
    const allDayEvents=events.filter(e=>e.date===ds && e.is_all_day).sort((a,b)=>String(a.title||'').localeCompare(String(b.title||'')));
    allDayWrap.classList.toggle('empty', allDayEvents.length===0);
    allDayEvents.forEach(e=>allDayWrap.appendChild(allDayEventEl(e)));
    const dayEvents=events.filter(e=>e.date===ds && !e.is_all_day).sort((a,b)=>hmToMin(a.start_time)-hmToMin(b.start_time)); assignOverlapLanes(dayEvents).forEach(e=>tl.appendChild(eventEl(e)));
    grid.appendChild(col);
  }
  requestAnimationFrame(resetCarouselPosition);
}
function assignOverlapLanes(list){
  const sorted=[...list].sort((a,b)=>hmToMin(a.start_time)-hmToMin(b.start_time)||hmToMin(a.end_time)-hmToMin(b.end_time)||String(a.title||'').localeCompare(String(b.title||'')));
  const groups=[];
  let current=[];
  let currentEnd=-1;
  for(const e of sorted){
    const start=hmToMin(e.start_time);
    const end=hmToMin(e.end_time);
    if(!current.length || start < currentEnd){
      current.push(e);
      currentEnd=Math.max(currentEnd,end);
    } else {
      groups.push(current);
      current=[e];
      currentEnd=end;
    }
  }
  if(current.length) groups.push(current);

  const positioned=[];
  for(const group of groups){
    const laneEnds=[];
    const placed=[];
    for(const e of group){
      const start=hmToMin(e.start_time);
      const end=hmToMin(e.end_time);
      let lane=laneEnds.findIndex(x=>x<=start);
      if(lane<0){ lane=laneEnds.length; laneEnds.push(end); }
      else laneEnds[lane]=end;
      placed.push({...e, lane, lanes:0});
    }
    const lanes=Math.max(1,laneEnds.length);
    if(lanes>2){
      // Too many true overlaps make unreadable toothpick blocks. Keep them full-width and cascade
      // slightly so every title remains readable and duplicate accidental entries stand out.
      placed.forEach((e,idx)=>positioned.push({...e, lane:0, lanes:1, overlap:false, overlapStack:true, stackIndex:idx}));
    } else {
      placed.forEach(e=>positioned.push({...e, lanes, overlap:lanes>1, overlapStack:false, stackIndex:0}));
    }
  }
  return positioned;
}

function allDayEventEl(e){
  const div=document.createElement('article');
  div.className='all-day-event '+(e.status==='no_show'?'no-show ':'')+(e.status==='cancelled'?'cancelled ':'');
  div.style.background=e.color||'#ddd';
  div.innerHTML=`<span class="event-title">${escapeHtml(e.title)}</span>${statusBadge(e)}`;
  attachNoShowGestures(div,e);
  div.addEventListener('pointerdown', ev=>ev.stopPropagation());
  div.onclick=(ev)=>{ ev.stopPropagation(); ev.preventDefault(); openDetails(e); };
  return div;
}

function eventEl(e){
  const div=document.createElement('article'); div.className='event-block '+(e.status==='no_show'?'no-show ':'')+(canToggleNoShow(e)?'can-no-show ':'')+(e.status==='cancelled'?'cancelled ':'')+(e.overlap?'overlap-lane ':'')+(e.overlapStack?'overlap-stack ':'');
  const startOffset=(hmToMin(e.start_time)-START_HOUR*60)/60;
  const duration=(hmToMin(e.end_time)-hmToMin(e.start_time))/60;
  div.style.top=`calc(var(--time-label-gutter) + ${startOffset} * var(--hour-height))`;
  div.style.height=`calc(${duration} * var(--hour-height))`;
  div.style.setProperty('--event-lane', String(e.lane || 0));
  div.style.setProperty('--event-lanes', String(e.lanes || 1));
  div.style.setProperty('--event-stack-index', String(e.stackIndex || 0));
  if(e.overlapStack){ div.style.transform = `translateY(calc(${e.stackIndex || 0} * .42rem))`; div.style.zIndex = String(10 + (e.stackIndex || 0)); }
  div.style.background=e.color||'#ddd';
  const meta = e.notes ? e.notes : `${PEOPLE[e.person_key]?.label||e.person_key} · ${e.preset_name}`;
  div.innerHTML=`<div><div class="event-title">${escapeHtml(e.title)}</div>${statusBadge(e)}<div class="event-meta">${escapeHtml(meta)}</div></div>`;
  attachNoShowGestures(div,e);
  div.addEventListener('pointerdown', ev=>ev.stopPropagation()); div.addEventListener('dblclick', ev=>ev.stopPropagation()); div.onclick=(ev)=>{ ev.stopPropagation(); ev.preventDefault(); openDetails(e); };
  return div;
}
function renderPrint(events, startArg=null, daysArg=null){
  const box=$('printList'); box.innerHTML='';
  const days = daysArg || visibleDayCount();
  const start = startArg || visibleRangeStart();
  const end = addDays(start, days-1);
  const heading = document.querySelector('.print-card h2');
  if(heading) heading.textContent = days===7 ? 'Weekly overview' : `${days}-day overview`;
  for(let i=0;i<days;i++){
    const d=addDays(start,i);
    const ds=isoDate(d);
    const dayEvents=events.filter(e=>e.date===ds).sort((a,b)=>(a.is_all_day?0:1)-(b.is_all_day?0:1) || hmToMin(a.start_time||'00:00')-hmToMin(b.start_time||'00:00'));
    const wrap=document.createElement('div');
    wrap.className='print-day'+(ds<isoDate(new Date())?' past-print':'');
    wrap.innerHTML=`<h3>${fmtDay(d)} ${fmtDate(d)}</h3>` + (dayEvents.length?`<ul>${dayEvents.map(e=>`<li>${e.is_all_day ? 'All day' : fmtTime(e.start_time)+'–'+fmtTime(e.end_time)} · ${escapeHtml(e.title)} · ${PEOPLE[e.person_key]?.label} · ${e.preset_name}${e.status==='no_show'?' · NO-SHOW':e.status==='cancelled'?' · CANCELLED':''}</li>`).join('')}</ul>`:'<p>No blocks.</p>');
    box.appendChild(wrap);
  }
}


async function setDetailsStatusFlag(flag,checked){
  const e=state.detailsEvent;if(!e)return;
  try{
    if(flag==='cancelled'&&checked&&isSeriesOccurrence(e)) await cancelRecurring(e);
    else await changeOccurrenceStatus(e,checked?flag:'scheduled');
    $('eventDetailsDialog').close();render();
  }catch(err){alert(err.message);openDetails(e);}
}

function openDetails(e){
  state.detailsEvent=e;
  const person=PEOPLE[e.person_key]?.label||e.person_key;
  const status=e.status==='no_show'?'No-show':(e.status==='cancelled'?'Cancelled':'Scheduled');
  const recurrence=recurrenceLabel(e.recurrence_rule);
  $('deleteDetailsBtn').classList.remove('hidden');
  $('eventDetailsContent').innerHTML=`
    <div class="detail-main-title"><span class="detail-dot" style="background:${escapeHtml(e.color||'#ddd')}"></span>${escapeHtml(e.title)}</div>
    <div class="detail-status-toggles">
      <label class="detail-check"><input id="detailNoShowCheck" type="checkbox" ${e.status==='no_show'?'checked':''} /> No-show</label>
      <label class="detail-check cancel-check"><input id="detailCancelCheck" type="checkbox" ${e.status==='cancelled'?'checked':''} /> Cancelled</label>
    </div>
    <div class="detail-row"><span class="detail-label">Person</span><span>${escapeHtml(person)}</span></div>
    <div class="detail-row"><span class="detail-label">Preset</span><span><span class="detail-chip" style="background:${escapeHtml(e.color||'#ddd')}">${escapeHtml(e.preset_name||'')}</span></span></div>
    <div class="detail-row"><span class="detail-label">Date</span><span>${escapeHtml(e.date)}</span></div>
    <div class="detail-row"><span class="detail-label">Time</span><span>${e.is_all_day ? 'All day' : fmtTime(e.start_time)+'–'+fmtTime(e.end_time)}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span>${escapeHtml(status)}</span></div>
    <div class="detail-row"><span class="detail-label">Repeat</span><span>${escapeHtml(recurrence)}</span></div>
    <div class="detail-row"><span class="detail-label">Notes</span><span>${escapeHtml(e.notes||'')}</span></div>`;
  if(!$('eventDetailsDialog').open)$('eventDetailsDialog').showModal();
  const ns=$('detailNoShowCheck');
  const cc=$('detailCancelCheck');
  if(ns) ns.onchange=ev=>setDetailsStatusFlag('no_show', ev.target.checked);
  if(cc) cc.onchange=ev=>setDetailsStatusFlag('cancelled', ev.target.checked);
}
function openDialog(e, editScope=null){
  state.editScope=editScope; state.editOriginal={...e};
  $('dialogTitle').textContent=e.id?'Edit':'+ Add'; $('eventId').value=e.id||''; $('eventTitle').value=e.title||''; $('personSelect').value=e.person_key||defaultPerson(); fillPresetSelect(); $('presetSelect').value=e.preset_name||defaultPreset($('personSelect').value);
  $('eventDate').value=e.date||isoDate(state.weekStart); $('startTime').value=e.start_time||'09:00'; $('endTime').value=e.end_time||'09:30'; if($('allDayCheck')) $('allDayCheck').checked=!!e.is_all_day; updateAllDayControls(); $('statusSelect').value=e.status||'scheduled'; $('eventNotes').value=e.notes||''; state.selectedColor=e.color||PEOPLE[$('personSelect').value].palette[0]; fillPalette(); fillStudentQuickAddSelect(); if($('studentQuickAddSelect')) $('studentQuickAddSelect').value=''; updateQuickAddVisibility();
  $('repeatToggle').checked=!!e.recurrence_rule?.enabled; $('repeatControls').classList.toggle('hidden',!$('repeatToggle').checked); const repeatParts=getRepeatParts(e.recurrence_rule||{frequency:'weekly'}); $('repeatInterval').value=repeatParts.interval; $('repeatUnit').value=repeatParts.unit; $('repeatUntil').value=e.recurrence_rule?.until||''; document.querySelectorAll('.weekday-picker input').forEach(ch=>ch.checked=e.recurrence_rule?.days?.map(String).includes(ch.value)||false);
  const occurrenceOnly=state.editScope?.type==='occurrence';
  ['personSelect','presetSelect','allDayCheck','repeatToggle','repeatInterval','repeatUnit','repeatUntil'].forEach(id=>{ const el=$(id); if(el) el.disabled=occurrenceOnly; });
  document.querySelectorAll('.weekday-picker input').forEach(el=>el.disabled=occurrenceOnly);
  $('deleteEventBtn').classList.toggle('hidden',!e.id || occurrenceOnly || e.recurring_instance); updateEventDateButton(); updateDuplicateWarning(); $('eventDialog').showModal(); setTimeout(()=>(e.id?$('eventDialog'):$('personSelect')).focus({preventScroll:true}),0);
}
async function submitForm(){
  if(!$('eventForm').reportValidity()||!$('eventTitle').value.trim())return;
  if(state.saving)return;
  const repeatUnit=normalizeRepeatUnit($('repeatUnit').value);
  const rec=$('repeatToggle').checked ? { enabled:true, unit:repeatUnit, interval:normalizeRepeatInterval($('repeatInterval').value), frequency:repeatUnit==='day'?'daily':repeatUnit==='week'?'weekly':repeatUnit==='month'?'monthly':'yearly', until:$('repeatUntil').value||null, days:[...document.querySelectorAll('.weekday-picker input:checked')].map(x=>Number(x.value)) } : null;
  const isAllDay=!!$('allDayCheck')?.checked;
  const e={ id:$('eventId').value||uuid(), title:$('eventTitle').value.trim(), person_key:$('personSelect').value, preset_name:$('presetSelect').value, date:$('eventDate').value, start_time:isAllDay?'00:00':$('startTime').value, end_time:isAllDay?'23:59':$('endTime').value, is_all_day:isAllDay, status:$('statusSelect').value, color:state.selectedColor, notes:$('eventNotes').value.trim(), recurrence_rule:rec };
  if(rec?.until&&rec.until<e.date){alert('Repeat end date must be on or after the event date.');return;}
  if(!e.is_all_day && hmToMin(e.end_time)<=hmToMin(e.start_time)){ alert('End time has to be after start time. Time goblin denied.'); return; }
  const scope=state.editScope;
  state.saving=true;$('saveEventBtn').disabled=true;
  try{
    if(scope?.type==='occurrence'){
      const moved=e.date!==scope.originalDate;
      await saveException({
        parent_event_id:scope.parentId,
        original_event_date:scope.originalDate,
        exception_status:exceptionFor(scope.parentId,scope.originalDate)?.exception_status || (moved?'moved':'modified'),
        occurrence_status:e.status,
        new_event_date:moved?e.date:null,
        new_start_time:e.start_time,
        new_end_time:e.end_time,
        new_title:e.title,
        new_notes:e.notes
      });
      state.editScope=null;
      $('eventDialog').close(); render(); return;
    }
    await saveEvent({...state.editOriginal,...e});
  }catch(err){alert(err.message);return;}finally{state.saving=false;$('saveEventBtn').disabled=false;}
  $('eventDialog').close();render();
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
init();
