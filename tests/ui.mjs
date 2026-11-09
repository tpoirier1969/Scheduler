import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const root=process.cwd();fs.mkdirSync('test-results',{recursive:true});
const server=http.createServer((req,res)=>{const f=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!f.startsWith(root+'/')){res.writeHead(403).end();return;}fs.readFile(f,(e,data)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':f.endsWith('.png')?'image/png':'text/html');res.end(data);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
const context=await browser.newContext({timezoneId:'America/New_York'});const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);let errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message);});
await page.route('**/config.js*',r=>r.fulfill({body:'',contentType:'text/javascript'}));
await page.route('https://**/*',r=>r.abort());
const ids={event:'00000000-0000-4000-8000-000000000002',student:'00000000-0000-4000-8000-000000000003'};
await page.addInitScript(({ids})=>{
 const event={id:ids.event,title:'Test lesson',person_key:'donna',preset_name:'Lesson',status:'scheduled',event_date:'2026-11-09',start_time:'09:00',end_time:'09:30',color_hex:'#c8dff0',notes:'original notes',recurrence_rule:{enabled:true,unit:'week',interval:1,days:[1]},imported_source:'test-source'};
 const student={id:ids.student,student_group:'Active Students',student_name:'Test student',standard_lesson_minutes:30,sort_order:0,is_active:true};
 if(!localStorage.getItem('ui-seeded')){localStorage.setItem('tod_donna_calendar_safe_store_v2',JSON.stringify([['tod_donna_calendar_events:'+event.id,event],['tod_donna_calendar_active_students:'+student.id,student]]));localStorage.setItem('ui-seeded','yes');}
},{ids});
page.on('dialog',d=>d.accept());
await page.goto(url);await page.waitForFunction(()=>appReady,null,{timeout:15000});
await page.evaluate(()=>{state.weekStart=new Date('2026-11-09T00:00');render();});
await page.click('#addEventBtn');assert.equal(await page.inputValue('#personSelect'),'tod');assert.equal(await page.inputValue('#presetSelect'),'Meeting');assert.equal(await page.locator('#studentQuickAddRow').isVisible(),false);
assert(await page.locator('#personSelect').evaluate(el=>!!(el.compareDocumentPosition(document.getElementById('eventTitle'))&Node.DOCUMENT_POSITION_FOLLOWING)));
await page.selectOption('#personSelect','donna');assert.equal(await page.inputValue('#presetSelect'),'Lesson');assert(await page.locator('#studentQuickAddRow').isVisible());await page.click('#cancelEventBtn');
await page.evaluate(()=>openDialog({date:'2026-11-10'}));assert.equal(await page.inputValue('#personSelect'),'donna');await page.click('#cancelEventBtn');
// Per-occurrence no-show retains edited notes/date; next week's event stays scheduled.
await page.evaluate(async()=>{const parent=state.events[0];await saveException({parent_event_id:parent.id,original_event_date:'2026-11-09',exception_status:'modified',new_title:'Edited title',new_notes:'Edited notes'});openDetails(materializeSeriesOccurrence(parent,'2026-11-09'));});
await page.check('#detailNoShowCheck');await page.waitForFunction(()=>state.exceptions[0].occurrence_status==='no_show');
assert.equal(await page.evaluate(()=>materializeSeriesOccurrence(state.events[0],'2026-11-09').notes),'Edited notes');assert.equal(await page.evaluate(()=>materializeSeriesOccurrence(state.events[0],'2026-11-16').status),'scheduled');
assert(await page.locator('.status-badge').filter({hasText:'NO-SHOW'}).count());
assert(await page.locator('.event-block.no-show .status-badge').first().evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.event-block').getBoundingClientRect();return a.top>=b.top-1&&a.bottom<=b.bottom+1;}));
// Cancel the next two appointments, exact dates counted from recurrence.
await page.evaluate(()=>openDetails(materializeSeriesOccurrence(state.events[0],'2026-11-16')));await page.check('#detailCancelCheck');await page.screenshot({path:'test-results/cancellation-options-desktop.png',fullPage:true});await page.locator('.scope-dialog input[value="number"]').check();await page.locator('.scope-dialog input[name="count"]').fill('2');await page.locator('.scope-dialog button[value="continue"]').click();await page.waitForFunction(()=>state.exceptions.filter(x=>x.occurrence_status==='cancelled').length===2);
assert.deepEqual(await page.evaluate(()=>state.exceptions.filter(x=>x.occurrence_status==='cancelled').map(x=>x.original_event_date).sort()),['2026-11-16','2026-11-23']);
assert.equal(await page.evaluate(()=>materializeSeriesOccurrence(state.events[0],'2026-11-30').status),'scheduled');
// Editing cancellation retains status, and empty notes can clear an inherited note.
await page.evaluate(()=>{openDetails(materializeSeriesOccurrence(state.events[0],'2026-11-16'));handleEditDetails();});await page.fill('#eventNotes','');await page.fill('#eventTitle','Retained cancellation');await page.click('#saveEventBtn');await page.waitForFunction(()=>!document.getElementById('eventDialog').open);
assert.equal(await page.evaluate(()=>materializeSeriesOccurrence(state.events[0],'2026-11-16').status),'cancelled');assert.equal(await page.evaluate(()=>materializeSeriesOccurrence(state.events[0],'2026-11-16').notes),'');
// Student list uses stable IDs; removal deactivates instead of deleting.
await page.click('#studentsHeaderBtn');await page.fill('.student-name-input','Renamed student');await page.click('#saveStudentsBtn');await page.waitForFunction(()=>!document.getElementById('studentListDialog').open);assert.equal(await page.evaluate(()=>PlannerStore.rows('tod_donna_calendar_active_students')[0].id),ids.student);
await page.click('#studentsHeaderBtn');await page.click('.remove-student-row');await page.click('#saveStudentsBtn');await page.waitForFunction(()=>!document.getElementById('studentListDialog').open);assert.equal(await page.evaluate(()=>PlannerStore.rows('tod_donna_calendar_active_students')[0].is_active),false);
await page.click('#undoPlannerBtn');await page.waitForFunction(()=>state.studentList.students.length===1);
// Archive occurrence retains exception content; undo restores it.
await page.evaluate(async()=>{const e=materializeSeriesOccurrence(state.events[0],'2026-11-16');window.prompt=()=> '1';await archiveEvent(e);render();});assert.equal(await page.evaluate(()=>materializeSeriesOccurrence(state.events[0],'2026-11-16')),null);await page.click('#undoPlannerBtn');await page.waitForFunction(()=>!!materializeSeriesOccurrence(state.events[0],'2026-11-16'));assert.equal(await page.evaluate(()=>materializeSeriesOccurrence(state.events[0],'2026-11-16').title),'Retained cancellation');
// Task completion, reopening and archive retain records.
await page.evaluate(()=>window.PoirierPlannerTasks.open());await page.fill('#taskTitle','Test task');await page.click('#saveTaskBtn');await page.waitForFunction(()=>PlannerStore.rows('tod_donna_calendar_tasks').length===1);await page.locator('.planner-task-toggle').first().click();await page.locator('.planner-task-check input').first().click();await page.waitForFunction(()=>PlannerStore.rows('tod_donna_calendar_tasks')[0].completed);await page.click('#plannerHistoryBtn');await page.locator('.history-item').filter({hasText:'Test task'}).getByRole('button',{name:'Restore'}).click();assert.equal(await page.evaluate(()=>PlannerStore.rows('tod_donna_calendar_tasks')[0].completed),false);await page.locator('.scope-dialog').getByRole('button',{name:'Close',exact:true}).click();
// Month-end, leap-day, multi-week interval and DST dates.
const dates=await page.evaluate(()=>{
 const mk=(date,unit,interval=1,days=[])=>({id:'recurrence',date,start_time:'09:00',end_time:'09:30',status:'scheduled',recurrence_rule:{enabled:true,unit,interval,days}});
 return [nextOccurrences(mk('2026-01-31','month'),'2026-01-31',3),nextOccurrences(mk('2024-02-29','year'),'2024-02-29',3),nextOccurrences(mk('2026-10-26','week',2,[1,3]),'2026-10-26',4)];
});
assert.deepEqual(dates,[['2026-01-31','2026-02-28','2026-03-31'],['2024-02-29','2025-02-28','2026-02-28'],['2026-10-26','2026-10-28','2026-11-09','2026-11-11']]);
await page.setViewportSize({width:390,height:844});await page.click('#addEventBtn');fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/person-first-mobile.png',fullPage:true});await page.click('#cancelEventBtn');
assert.deepEqual(errors,[]);
console.log('PASS: person first/defaults; dropdown; occurrence no-show; next N cancellation; edited cancellation/empty notes; student identity and undo; archive/undo; task completion/history; recurrence/DST; mobile layout.');

const pc=await browser.newContext({timezoneId:'America/New_York'});
const pp=await pc.newPage();
const remoteRequests=[];
pp.on('request',r=>{if(r.url().includes('supabase.co'))remoteRequests.push(r.url());});
await pp.goto(url.replace('index.html','preview.html'));
await pp.waitForFunction(()=>appReady);
assert.equal(await pp.evaluate(()=>state.storageMode),'local');
assert.equal(await pp.evaluate(()=>state.events.length),2);
assert(await pp.getByText('ISOLATED PREVIEW',{exact:false}).isVisible());
await pp.click('#addEventBtn');
assert.equal(await pp.inputValue('#personSelect'),'tod');
assert.equal(await pp.inputValue('#presetSelect'),'Meeting');
assert.equal(await pp.locator('#studentQuickAddRow').isVisible(),false);
await pp.click('#cancelEventBtn');
assert.deepEqual(remoteRequests,[],'Preview must never request the live Supabase project');
await pc.close();
console.log('PASS isolated browser preview: synthetic-only data, no hosted API access, expected Person defaults.');
await browser.close();server.close();
