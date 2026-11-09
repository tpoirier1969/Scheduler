// Disposable local Supabase HTTP contract test. No remote project references.
import assert from 'node:assert/strict';
const origin=process.env.API_URL||'http://127.0.0.1:54321';
const key=process.env.ANON_KEY;
if(!key || !origin.includes('127.0.0.1')) throw new Error('Refusing tests without an isolated localhost Supabase stack');
const base=origin+'/rest/v1/';
async function call(path,method='GET',body){
 const res=await fetch(base+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json','Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 const txt=await res.text();let data;try{data=txt?JSON.parse(txt):null;}catch{data=txt;}
 if(!res.ok)throw new Error('HTTP '+res.status+' '+JSON.stringify(data));
 return data;
}
const table='tod_donna_calendar_events',xt='tod_donna_calendar_event_exceptions',st='tod_donna_calendar_active_students',tt='tod_donna_calendar_tasks';
const [id1,id2,xid,sid,tid]=[2,3,4,5,6].map(n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'));
const one=async(t,id)=>(await call(t+'?id=eq.'+id+'&select=*'))[0];
const rpc=changes=>call('rpc/tod_donna_calendar_write','POST',{p_changes:changes});
const patch=(t,id,expected,value)=>({table:t,id,expected,patch:value});
async function expectFailure(promise,pattern){
 let error;try{await promise;}catch(e){error=e;}
 assert(error, 'Expected write to fail');
 assert.match(error.message,pattern);
}
const people=await call('tod_donna_calendar_people?select=person_key');
assert(people.some(p=>p.person_key==='donna'),'Initial schema not loaded');
const e={title:'Isolated lesson',person_key:'donna',preset_name:'Lesson',status:'scheduled',event_date:'2026-11-09',start_time:'09:00',end_time:'09:30',is_all_day:false,color_hex:'#c8dff0',notes:'Original notes',imported_source:'original-import',recurrence_rule:{enabled:true,unit:'week',interval:1,days:[1]}};
await call(table,'POST',[{...e,id:id1},{...e,id:id2,title:'Second fixture'}]);
let old=await one(table,id1);
assert.equal(old.imported_source,'original-import');
let out=await rpc([patch(table,id1,old,{title:'Edited through anon RPC'})]);
assert.equal(out[0].after.title,'Edited through anon RPC');
assert.equal(out[0].after.imported_source,'original-import');
await expectFailure(rpc([patch(table,id1,old,{title:'Overwrite from stale tab'})]),/changed on another device/);
let current=await one(table,id1),second=await one(table,id2);
await expectFailure(rpc([patch(table,id1,current,{notes:'This must roll back'}),patch(table,id2,second,{status:'invalid_status'})]),/check constraint|violates|invalid/);
assert.equal((await one(table,id1)).notes,'Original notes');
await call(xt,'POST',{id:xid,parent_event_id:id1,original_event_date:'2026-11-09',exception_status:'moved',new_event_date:'2026-11-10',new_title:'Moved title',new_notes:'Preserve moved notes'});
let x=await one(xt,xid);
await rpc([patch(xt,xid,x,{occurrence_status:'no_show'})]);
x=await one(xt,xid);
assert.equal(x.occurrence_status,'no_show');assert.equal(x.new_notes,'Preserve moved notes');assert.equal(x.new_event_date,'2026-11-10');
assert.equal((await one(table,id1)).status,'scheduled');
current=await one(table,id1);
await expectFailure(rpc([{...patch(table,id1,current,{cancellation_from:'2026-11-09'}),expected_children:[]}]),/occurrence changed/);
current=await one(table,id1);
await rpc([{...patch(table,id1,current,{cancellation_from:'2026-11-09'}),expected_children:[x]}]);
assert.equal((await one(table,id1)).cancellation_from,'2026-11-09');
assert.equal((await one(xt,xid)).occurrence_status,'no_show');
await call(st,'POST',{id:sid,student_group:'Active Students',student_name:'Sample student',standard_lesson_minutes:30,sort_order:0,is_active:true});
let s=await one(st,sid);
await rpc([patch(st,sid,s,{student_name:'Renamed student',standard_lesson_minutes:60})]);
s=await one(st,sid);assert.equal(s.id,sid);assert.equal(s.standard_lesson_minutes,60);
await rpc([patch(st,sid,s,{is_active:false})]);s=await one(st,sid);assert.equal(s.is_active,false);
await rpc([patch(st,sid,s,{is_active:true})]);assert.equal((await one(st,sid)).student_name,'Renamed student');
await call(tt,'POST',{id:tid,title:'Sample task',person_key:'tod',task_mode:'timeless',priority:'normal',completed:false,sort_order:0});
let t=await one(tt,tid);
await rpc([patch(tt,tid,t,{completed:true,completed_at:'2026-11-09T15:00:00Z'})]);t=await one(tt,tid);assert.equal(t.completed,true);
await rpc([patch(tt,tid,t,{archived:true})]);t=await one(tt,tid);assert.equal(t.archived,true);
await rpc([patch(tt,tid,t,{archived:false,completed:false,completed_at:null})]);
assert.equal((await one(tt,tid)).completed,false);
await expectFailure(rpc([{table:'tod_donna_calendar_people',id:sid,expected:null,patch:{display_name:'No'}}]),/Unsupported table/);
await expectFailure(rpc([{table:table,id:id1,expected:await one(table,id1),operation:'remove_new'}]),/Cannot undo creation/);
assert.equal((await one(xt,xid)).new_notes,'Preserve moved notes');
console.log('PASS actual PostgREST + anon RLS: bootstrap; CRUD; RPC; metadata; stale writes; atomic rollback; moved No-show; series snapshot; students; tasks; blocked privileged writes and destructive parent removal.');
