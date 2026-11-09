import {PGlite} from '@electric-sql/pglite';
import {restore} from '../scripts/restore-rehearsal.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
let db,snapshot;
if(process.argv[2]){
 const restored=await restore(process.argv[2]);db=restored.db;snapshot=restored.snapshot;
 console.log('Backup restoration verified:',Object.values(restored.hashes).reduce((n,t)=>n+t.count,0),'rows');
}else{
 db=new PGlite();await db.exec('create role anon; create role authenticated;');
 await db.exec(fs.readFileSync('supabase-schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(fs.readFileSync('poiriers-planner-tasks.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`insert into tod_donna_calendar_events(id,title,person_key,preset_name,event_date,start_time,end_time,notes,imported_source) values ('00000000-0000-4000-8000-000000000002','Test','donna','Lesson','2026-11-09','09:00','09:30','Preserve me','import');insert into tod_donna_calendar_event_exceptions(parent_event_id,original_event_date,exception_status,new_notes) values ('00000000-0000-4000-8000-000000000002','2026-11-16','modified','Exception notes');insert into tod_donna_calendar_tasks(title,person_key) values ('Task','tod');`);
 snapshot={data:{}};
 for(const t of ['tod_donna_calendar_events','tod_donna_calendar_event_exceptions','tod_donna_calendar_tasks'])snapshot.data[t]=(await db.query(`select * from ${t}`)).rows;
}

await db.exec(fs.readFileSync('db/planner-safe-writes.sql','utf8'));
await db.exec(fs.readFileSync('db/planner-safe-writes.sql','utf8')); // repeat deployment is safe
const table='tod_donna_calendar_events';
const id=snapshot.data[table][0].id;
const get=async(t,id)=>(await db.query(`select to_jsonb(t) as row from ${t} t where id=$1`,[id])).rows[0]?.row;
const write=async c=>(await db.query('select tod_donna_calendar_write($1::jsonb) as result',[JSON.stringify(c)])).rows[0].result;
let before=await get(table,id);
const result=await write([{table,id,expected:before,patch:{title:'isolated test'}}]);
assert.equal(result[0].after.title,'isolated test');
assert.equal(result[0].after.imported_source,before.imported_source);
await assert.rejects(()=>write([{table,id,expected:before,patch:{title:'stale overwrite'}}]),/changed on another device/);
let now=await get(table,id);
await assert.rejects(()=>write([{table,id,expected:now,patch:{title:'must rollback'}},{table,id,expected:now,patch:{status:'invalid'}}]));
assert.equal((await get(table,id)).title,'isolated test');
// Invalid second record must roll back the first operation.
await assert.rejects(async()=>write([{table,id,expected:now,patch:{title:'must rollback'}},{table:'tod_donna_calendar_tasks',id:snapshot.data.tod_donna_calendar_tasks[0].id,expected:await get('tod_donna_calendar_tasks',snapshot.data.tod_donna_calendar_tasks[0].id),patch:{task_mode:'invalid'}}]),/check constraint/);
assert.equal((await get(table,id)).title,'isolated test');
const ex=snapshot.data.tod_donna_calendar_event_exceptions[0];
const exBefore=await get('tod_donna_calendar_event_exceptions',ex.id);
await write([{table:'tod_donna_calendar_event_exceptions',id:ex.id,expected:exBefore,patch:{occurrence_status:'no_show'}}]);
const exAfter=await get('tod_donna_calendar_event_exceptions',ex.id);
assert.equal(exAfter.new_notes,exBefore.new_notes);assert.equal(exAfter.new_event_date,exBefore.new_event_date);
const newId='00000000-0000-4000-8000-000000000001';
const created=await write([{table:'tod_donna_calendar_event_exceptions',id:newId,expected:null,patch:{parent_event_id:id,original_event_date:'2099-01-01',exception_status:'modified',occurrence_status:'no_show'}}]);
assert.equal(created[0].after.hidden,false);
await write([{table:'tod_donna_calendar_event_exceptions',id:newId,expected:created[0].after,operation:'remove_new'}]);
assert.equal(await get('tod_donna_calendar_event_exceptions',newId),undefined);
const parentNow=await get(table,id);
await assert.rejects(()=>write([{table:'tod_donna_calendar_event_exceptions',id:ex.id,expected:exAfter,parent_expected:before,patch:{occurrence_status:'cancelled'}}]),/series changed/);
await assert.rejects(async()=>write([{table,id:ex.parent_event_id,expected:await get(table,ex.parent_event_id),expected_children:[],patch:{cancellation_from:'2026-11-09'}}]),/occurrence changed/);
assert.equal((await get(table,id)).cancellation_from,null);
// Test the granted client role under the restored RLS policies.
await db.exec('grant usage on schema public to anon; grant select,insert,update,delete on all tables in schema public to anon; set role anon;');
now=await get(table,id);
await write([{table,id,expected:now,patch:{notes:'RLS client test'}}]);
await db.exec('reset role');
assert.equal((await get(table,id)).notes,'RLS client test');
console.log('PASS: additive migration twice; metadata preservation; stale-write rejection; transactional rollback; occurrence status; creation/undo; client-role RLS.');
await db.close();
