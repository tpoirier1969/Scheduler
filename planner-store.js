/* Shared persistence for events, exceptions, students and tasks. */
const PlannerStore = (()=>{
 const records=new Map();
 let lastChange=null, busy=false;
 const key=(table,id)=>`${table}:${id}`;
 const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
 function capture(table,rows){for(const k of records.keys())if(k.startsWith(table+':'))records.delete(k);for(const row of rows) records.set(key(table,row.id),clone(row));}
 function change(table,id,patch){
  const expected=clone(records.get(key(table,id))||null);
  const change={table,id,patch,expected};
  if(table==='tod_donna_calendar_event_exceptions'){
   const parentId=patch.parent_event_id||expected?.parent_event_id;
   change.parent_expected=clone(records.get(key('tod_donna_calendar_events',parentId))||null);
  }
  return change;
 }
 async function commit(changes,{undo=false}={}){
  if(busy) throw new Error('A save is already in progress.');
  busy=true;
  try{
   let result;
   if(state.storageMode==='supabase'){
    const response=await state.supabase.rpc('tod_donna_calendar_write',{p_changes:changes});
    if(response.error) throw new Error(response.error.message+' Changes were not saved.');
    result=response.data;
   }else{
    // Write the complete local store in one atomic localStorage assignment first.
    const saved=JSON.parse(localStorage.getItem('tod_donna_calendar_safe_store_v2')||'null');
    const next=new Map(saved||records);
    result=changes.map(c=>{
     if(c.parent_expected){const parentId=c.patch.parent_event_id||c.expected?.parent_event_id;if(JSON.stringify(next.get(key('tod_donna_calendar_events',parentId))||null)!==JSON.stringify(c.parent_expected))throw new Error('Series changed. Refresh before saving.');}
     if(c.expected_children){const children=[...next.entries()].filter(([k,r])=>k.startsWith('tod_donna_calendar_event_exceptions:')&&r.parent_event_id===c.id).map(([,r])=>r).sort((a,b)=>a.id.localeCompare(b.id));if(JSON.stringify(children)!==JSON.stringify(c.expected_children))throw new Error('An occurrence changed. Refresh before saving.');}
     if(c.operation==='remove_new'&&c.table==='tod_donna_calendar_events'&&[...next.entries()].some(([k,r])=>k.startsWith('tod_donna_calendar_event_exceptions:')&&r.parent_event_id===c.id))throw new Error('Cannot undo creation: this series now has occurrence changes.');
     const before=clone(next.get(key(c.table,c.id))||null);
     if(JSON.stringify(before)!==JSON.stringify(c.expected)) throw new Error('Record changed. Reopen the editor.');
     const after=c.operation==='remove_new'?null:c.operation==='restore'?{...c.patch,id:c.id}:{...before,...c.patch,id:c.id};
     if(after) next.set(key(c.table,c.id),after); else next.delete(key(c.table,c.id));
     return {table:c.table,before,after};
    });
    localStorage.setItem('tod_donna_calendar_safe_store_v2',JSON.stringify([...next]));
   }
   for(const r of result){const id=r.after?.id||r.before.id;if(r.after) records.set(key(r.table,id),clone(r.after));else records.delete(key(r.table,id));}
   if(!undo) lastChange=clone(result);
   updateUndo();
   return result;
  }finally{busy=false;}
 }
 async function undo(){
  if(!lastChange) return;
  const changes=lastChange.slice().reverse().map(r=>({table:r.table,id:r.after?.id||r.before.id,expected:r.after,patch:r.before||{},operation:r.before?'restore':'remove_new'}));
  await commit(changes,{undo:true}); lastChange=null;updateUndo();await refresh();
 }
 function rows(table){return [...records.entries()].filter(([k])=>k.startsWith(table+':')).map(([,r])=>clone(r));}
 async function refresh(){await loadEvents();await loadExceptions();await loadStudentList();if(window.PoirierPlannerTasks) await window.PoirierPlannerTasks.refresh();render();}
 function updateUndo(){
  let b=document.getElementById('undoPlannerBtn');
  if(!b){b=document.createElement('button');b.id='undoPlannerBtn';b.type='button';b.textContent='Undo last change';document.getElementById('toolbarMenu').appendChild(b);b.onclick=()=>undo().catch(e=>alert(e.message));}
  b.hidden=!lastChange;
 }
 function restoreLocal(){try{const saved=JSON.parse(localStorage.getItem('tod_donna_calendar_safe_store_v2')||'null');if(saved) for(const [k,v] of saved)records.set(k,v);return !!saved;}catch{return false;}}
 return {capture,change,commit,rows,refresh,restoreLocal};
})();
