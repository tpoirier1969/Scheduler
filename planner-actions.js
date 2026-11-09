const DELETED_OCCURRENCE_SENTINEL='__TOD_DONNA_DELETE_OCCURRENCE__';
function defaultPerson(){try{const p=localStorage.getItem('planner_default_person');return ['tod','donna','frank','shared'].includes(p)?p:'tod';}catch{return 'tod';}}
function defaultPreset(person){return person==='donna'?'Lesson':person==='tod'?'Meeting':PEOPLE[person].presets[0];}
function statusBadge(e){return e.status==='scheduled'?'':`<span class="status-badge">${e.status==='no_show'?'NO-SHOW':'CANCELLED'}</span>`;}
function exceptionChange(parent,original,patch){
 const old=exceptionFor(parent.id,original),id=old?.id||uuid();
 return PlannerStore.change('tod_donna_calendar_event_exceptions',id,{...(old?{}:{id,parent_event_id:parent.id,original_event_date:original,exception_status:'modified'}),...patch});
}
async function changeOccurrenceStatus(e,status){
 if(isSeriesOccurrence(e)){
  const parent=parentEventFor(e);if(!parent)throw new Error('Series could not be found.');
  await PlannerStore.commit([exceptionChange(parent,e.original_event_date||e.date,{occurrence_status:status})]);
  state.exceptions=PlannerStore.rows('tod_donna_calendar_event_exceptions');
 }else await saveEvent({...e,status});
}
// Enumerate source occurrence dates; never count calendar days as appointments.
function nextOccurrences(parent,original,count){
 const dates=[],base=new Date(parent.date+'T00:00'),start=new Date(original+'T00:00');
 const {unit,interval}=getRepeatParts(parent.recurrence_rule);
 let cursor=new Date(start);
 let steps=0;
 while(dates.length<count && steps++<800000){
  const ds=isoDate(cursor);
  if(parent.recurrence_rule.until&&ds>parent.recurrence_rule.until)break;
  if(parent.archived_from&&ds>=parent.archived_from)break;
  if(ds===parent.date||recurringEventOccursOn(parent,cursor)){
   const item=materializeSeriesOccurrence(parent,ds);
   // Count visible, not already-cancelled appointments, starting with the clicked one.
   if(item&&item.status!=='cancelled')dates.push(ds);
  }
  if(unit==='month'){
   const target=new Date(cursor.getFullYear(),cursor.getMonth()+interval,1);
   cursor=new Date(target.getFullYear(),target.getMonth(),Math.min(base.getDate(),daysInMonth(target.getFullYear(),target.getMonth())));
  }else if(unit==='year'){
   const year=cursor.getFullYear()+interval;
   cursor=new Date(year,base.getMonth(),Math.min(base.getDate(),daysInMonth(year,base.getMonth())));
  }else cursor=addDays(cursor,1);
  if(cursor.getFullYear()>9999)break;
 }
 if(dates.length<count)throw new Error(`Only ${dates.length} remaining appointments were found. Nothing was changed.`);
 return dates;
}
function chooseCancellationScope(e){
 return new Promise(resolve=>{
  const d=document.createElement('dialog');d.className='scope-dialog';
  d.innerHTML='<form method="dialog"><h2>Cancel recurring event</h2><label><input type="radio" name="scope" value="one" checked> Cancel this event only</label><label><input type="radio" name="scope" value="number"> Cancel a number of events</label><label>Number <input name="count" type="number" min="1" max="999" value="2" step="1"></label><label><input type="radio" name="scope" value="all"> Cancel all events in this series</label><menu><button value="back">Go back</button><button value="continue">Continue</button></menu></form>';
  document.body.appendChild(d);
  d.addEventListener('close',()=>{const scope=d.querySelector('input[name="scope"]:checked').value;const count=Number(d.querySelector('input[name="count"]').value);const answer=d.returnValue==='continue'?{scope,count}:null;d.remove();resolve(answer);},{once:true});
  d.showModal();
 });
}
async function cancelRecurring(e){
 const choice=await chooseCancellationScope(e);if(!choice)return;
 const parent=parentEventFor(e);if(!parent)throw new Error('Series could not be found.');
 const original=e.original_event_date||e.date;
 let changes;
 if(choice.scope==='all'){
  if(!confirm(`Cancel all appointments in “${parent.title}”, including past appointments? Existing No-show history will be retained. Other series will not change.`))return;
  changes=[PlannerStore.change('tod_donna_calendar_events',parent.id,{cancellation_from:parent.date})];
  changes[0].expected_children=PlannerStore.rows('tod_donna_calendar_event_exceptions').filter(x=>x.parent_event_id===parent.id).sort((a,b)=>a.id.localeCompare(b.id));
  // An explicit per-occurrence override must not silently defeat cancel-all.
  for(const ex of state.exceptions.filter(x=>x.parent_event_id===parent.id&&x.occurrence_status&&x.occurrence_status!=='no_show'))changes.push(exceptionChange(parent,ex.original_event_date,{occurrence_status:'cancelled'}));
 }else{
  const count=choice.scope==='one'?1:choice.count;
  if(!Number.isInteger(count)||count<1||count>999)throw new Error('Enter a whole number from 1 to 999.');
  const dates=choice.scope==='one'?[original]:nextOccurrences(parent,original,count);
  if(!confirm(`Cancel ${dates.length} appointment${dates.length===1?'':'s'} in “${parent.title}”?\n${dates.slice(0,12).join('\n')}${dates.length>12?'\n… through '+dates.at(-1):''}\nAppointments remain visible as Cancelled.`))return;
  changes=dates.map(ds=>exceptionChange(parent,ds,{occurrence_status:'cancelled'}));
 }
 if(choice.scope==='all')for(const c of changes.slice(1))delete c.parent_expected;
 await PlannerStore.commit(changes);state.events=PlannerStore.rows('tod_donna_calendar_events').map(fromDb);state.exceptions=PlannerStore.rows('tod_donna_calendar_event_exceptions');
}
async function archiveEvent(e){
 if(!e)return;
 if(!isSeriesOccurrence(e)){
  if(!confirm(`Remove “${e.title}” from the calendar? It can be restored from History.`))return false;
  await saveEvent({...e,archived_from:e.date});return true;
 }
 const parent=parentEventFor(e);if(!parent)throw new Error('Series could not be found.');
 const scope=prompt('Remove recurring event:\n1 = This event only\n2 = This and future events\n3 = Entire series\n\nRemoved events can be restored from History.','1');
 if(scope===null)return false;
 if(!['1','2','3'].includes(scope.trim()))throw new Error('Choose 1, 2, or 3.');
 const original=e.original_event_date||e.date;
 if(scope.trim()==='1')await PlannerStore.commit([exceptionChange(parent,original,{hidden:true})]);
 else{
  const from=scope.trim()==='3'?parent.date:original;
  if(!confirm(`Remove ${scope.trim()==='3'?'the entire series':'this and future appointments'} for “${parent.title}”? History and occurrence edits will be preserved.`))return false;
  await PlannerStore.commit([PlannerStore.change('tod_donna_calendar_events',parent.id,{archived_from:parent.archived_from&&parent.archived_from<from?parent.archived_from:from})]);
 }
 state.events=PlannerStore.rows('tod_donna_calendar_events').map(fromDb);state.exceptions=PlannerStore.rows('tod_donna_calendar_event_exceptions');return true;
}
async function handleDeleteDetails(){if(await archiveEvent(state.detailsEvent)){$('eventDetailsDialog').close();render();}}
async function handleDeleteEditor(){const e=state.editOriginal;if(e?.id&&await archiveEvent(e)){$('eventDialog').close();render();}}
function showPlannerHistory(){
 const d=document.createElement('dialog');d.className='scope-dialog';
 d.innerHTML='<h2>History</h2><div class="history-list"></div><button type="button">Close</button>';
 d.lastElementChild.onclick=()=>d.close();d.onclose=()=>d.remove();document.body.appendChild(d);
 const list=d.querySelector('.history-list');let total=0;
 function row(label,action){total++;const r=document.createElement('div');r.className='history-item';const text=document.createElement('span');text.textContent=label;const b=document.createElement('button');b.textContent='Restore';b.onclick=async()=>{b.disabled=true;try{await action();await PlannerStore.refresh();d.close();showPlannerHistory();}catch(err){alert(err.message);b.disabled=false;}};r.append(text,b);list.appendChild(r);}
 for(const e of state.events.filter(x=>x.archived_from))row(`${e.title} · removed from ${e.archived_from}`,()=>PlannerStore.commit([PlannerStore.change('tod_donna_calendar_events',e.id,{archived_from:null})]));
 for(const ex of state.exceptions.filter(x=>x.hidden||x.new_notes===DELETED_OCCURRENCE_SENTINEL)){
  const parent=state.events.find(x=>x.id===ex.parent_event_id);if(!parent)continue;
  row(`${parent.title} · removed ${ex.original_event_date}`,()=>PlannerStore.commit([exceptionChange(parent,ex.original_event_date,{hidden:false,...(ex.new_notes===DELETED_OCCURRENCE_SENTINEL?{new_notes:null,occurrence_status:'scheduled'}:{})})]));
 }
 for(const t of PlannerStore.rows('tod_donna_calendar_tasks').filter(x=>x.archived||x.completed))row(`${t.title} · ${t.archived?'removed task':'completed task'}`,()=>PlannerStore.commit([PlannerStore.change('tod_donna_calendar_tasks',t.id,{archived:false,completed:false,completed_at:null})]));
 if(!total)list.textContent='No removed events or completed tasks.';
 d.showModal();
}
document.addEventListener('DOMContentLoaded',()=>{
 const b=document.createElement('button');b.id='plannerHistoryBtn';b.type='button';b.textContent='History';b.onclick=showPlannerHistory;document.getElementById('toolbarMenu').appendChild(b);
});
