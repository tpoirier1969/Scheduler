// Local embedded PostgreSQL only. Never connects to Supabase.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
export async function restore(snapshotPath){
 const s=JSON.parse(fs.readFileSync(snapshotPath));
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated;');
 for(const [t,rows] of Object.entries(s.data)){
  const cols=s.columns.filter(c=>c.table_name===t).sort((a,b)=>a.ordinal_position-b.ordinal_position);
  await db.exec(`create table public.${t} (${cols.map(c=>`"${c.column_name}" ${c.data_type==='USER-DEFINED'?c.udt_name:c.data_type}${c.column_default?' default '+c.column_default:''}${c.is_nullable==='NO'?' not null':''}`).join(',')})`);
  for(const row of rows) await db.query(`insert into public.${t} select * from jsonb_populate_record(null::public.${t},$1::jsonb)`,[JSON.stringify(row)]);
 }
 for(const c of s.constraints) await db.exec(`alter table public.${c.table} add constraint "${c.name}" ${c.definition}`);
 for(const i of s.indexes||[]){if(!s.constraints.some(c=>c.name===i.indexname))await db.exec(i.indexdef);}
 for(const f of s.functions||[]) await db.exec(f);
 for(const tr of s.triggers||[]) await db.exec(tr.definition);
 for(const p of s.policies||[]){await db.exec(`alter table public.${p.tablename} enable row level security`);await db.exec(`create policy "${p.policyname}" on public.${p.tablename} for ${p.cmd} to ${p.roles.join(',')} ${p.qual?'using ('+p.qual+')':''} ${p.with_check?'with check ('+p.with_check+')':''}`);}
 const hashes={};
 for(const [t,rows] of Object.entries(s.data)){
  const got=(await db.query(`select to_jsonb(t) as row from public.${t} t order by id`)).rows.map(x=>x.row);
  const canon=r=>JSON.stringify(r.map(x=>Object.fromEntries(Object.entries(x).sort())).sort((a,b)=>a.id.localeCompare(b.id)));
  assert.equal(canon(got),canon(rows),t);
  hashes[t]={count:rows.length,sha256:crypto.createHash('sha256').update(canon(got)).digest('hex')};
 }
 return {db,hashes,snapshot:s};
}
if(process.argv[1]?.endsWith('restore-rehearsal.mjs')){
 const {db,hashes}=await restore(process.argv[2]); console.log(JSON.stringify({restored:true,tables:hashes},null,2));await db.close();
}
