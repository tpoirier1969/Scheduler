/* Poirier's Planner task layer
 * Keeps task behavior separate from the calendar event engine.
 */
(function(){
  const TASK_TABLE='tod_donna_calendar_tasks';
  const TASK_STORAGE='tod_donna_calendar_tasks_v1';
  const MODES={ TIMELESS:'timeless', FROM_DATE:'from_date', SPECIFIC_DATE:'specific_date' };
  let tasks=[];
  let taskFeatureReady=false;
  let observer=null;

  function byId(id){ return document.getElementById(id); }
  function esc(value){ return String(value ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function todayIso(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function personLabel(key){ return (typeof PEOPLE!=='undefined' && PEOPLE[key]?.label) || ({donna:'Donna',tod:'Tod',frank:'Frank',shared:'Shared'}[key]) || key; }

  function normalizeTask(row){
    return {
      id:row.id,
      title:String(row.title||'').trim(),
      notes:row.notes||'',
      person_key:row.person_key||'shared',
      task_mode:row.task_mode||MODES.TIMELESS,
      assigned_date:row.assigned_date||null,
      priority:row.priority||'normal',
      completed:!!row.completed,
      completed_at:row.completed_at||null,
      sort_order:Number(row.sort_order||0),
      created_at:row.created_at||null,
      updated_at:row.updated_at||null
    };
  }

  function visibleOnDate(task,dateStr){
    if(!task || task.completed) return false;
    if(task.task_mode===MODES.TIMELESS) return true;
    if(task.task_mode===MODES.FROM_DATE) return !!task.assigned_date && dateStr>=task.assigned_date;
    if(task.task_mode===MODES.SPECIFIC_DATE) return task.assigned_date===dateStr;
    return false;
  }

  function matchesCalendarFilter(task){
    if(typeof state==='undefined') return true;
    if(!state.filter || state.filter==='all') return true;
    if(state.filter==='shared') return task.person_key==='shared';
    return task.person_key===state.filter || task.person_key==='shared';
  }

  function tasksForDate(dateStr){
    return tasks.filter(t=>visibleOnDate(t,dateStr) && matchesCalendarFilter(t))
      .sort((a,b)=>{
        if(a.priority!==b.priority) return a.priority==='important' ? -1 : 1;
        return (a.sort_order-b.sort_order)
          || String(a.assigned_date||'').localeCompare(String(b.assigned_date||''))
          || a.title.localeCompare(b.title);
      });
  }

  async function loadTasks(){
    if(typeof state!=='undefined' && state.storageMode==='supabase' && state.supabase){
      const {data,error}=await state.supabase.from(TASK_TABLE).select('*').order('sort_order').order('created_at');
      if(error){
        console.error('Poirier Planner task load failed',error);
        tasks=[];
        taskFeatureReady=false;
        renderTaskSetupNeeded();
        return false;
      }
      tasks=(data||[]).map(normalizeTask);
      localStorage.removeItem(TASK_STORAGE);
      taskFeatureReady=true;
      refreshTaskPanels();
      return true;
    }
    try{ tasks=JSON.parse(localStorage.getItem(TASK_STORAGE)||'[]').map(normalizeTask); }
    catch{ tasks=[]; }
    taskFeatureReady=true;
    refreshTaskPanels();
    return true;
  }

  async function persistTask(task){
    const row={
      id:task.id,
      title:task.title,
      notes:task.notes||null,
      person_key:task.person_key,
      task_mode:task.task_mode,
      assigned_date:task.task_mode===MODES.TIMELESS?null:task.assigned_date,
      priority:task.priority||'normal',
      completed:!!task.completed,
      completed_at:task.completed_at||null,
      sort_order:Number(task.sort_order||0)
    };
    if(typeof state!=='undefined' && state.storageMode==='supabase' && state.supabase){
      const {data,error}=await state.supabase.from(TASK_TABLE).upsert(row).select().single();
      if(error) throw error;
      return normalizeTask(data);
    }
    const idx=tasks.findIndex(t=>t.id===task.id);
    if(idx>=0) tasks[idx]=normalizeTask(task); else tasks.push(normalizeTask(task));
    localStorage.setItem(TASK_STORAGE,JSON.stringify(tasks));
    return normalizeTask(task);
  }

  async function removeTask(id){
    if(typeof state!=='undefined' && state.storageMode==='supabase' && state.supabase){
      const {error}=await state.supabase.from(TASK_TABLE).delete().eq('id',id);
      if(error) throw error;
    }
    tasks=tasks.filter(t=>t.id!==id);
    if(typeof state==='undefined' || state.storageMode!=='supabase') localStorage.setItem(TASK_STORAGE,JSON.stringify(tasks));
  }

  function installDialog(){
    if(byId('taskDialog')) return;
    const dialog=document.createElement('dialog');
    dialog.id='taskDialog';
    dialog.className='task-dialog';
    dialog.innerHTML=`
      <form method="dialog" id="taskForm" class="task-form">
        <div class="dialog-title-row"><h2 id="taskDialogTitle">New Task</h2><button id="closeTaskBtn" type="button" aria-label="Close task editor">×</button></div>
        <input id="taskId" type="hidden" />
        <label>Task <input id="taskTitle" maxlength="240" required autocomplete="off" /></label>
        <label>For <select id="taskPerson"></select></label>
        <label class="task-important"><input id="taskImportant" type="checkbox" /> Important</label>
        <fieldset class="task-when-fieldset">
          <legend>When should it show?</legend>
          <label><input type="radio" name="taskMode" value="timeless" checked /> Keep showing until done</label>
          <label><input type="radio" name="taskMode" value="from_date" /> Start on this date and keep showing</label>
          <label><input type="radio" name="taskMode" value="specific_date" /> This date only</label>
        </fieldset>
        <label id="taskDateLabel" class="hidden">Date <input id="taskDate" type="date" /></label>
        <label>Notes <textarea id="taskNotes" rows="3"></textarea></label>
        <menu>
          <button type="button" id="deleteTaskBtn" class="danger hidden">Delete</button>
          <button type="button" id="cancelTaskBtn">Cancel</button>
          <button type="submit" id="saveTaskBtn" class="primary">Save Task</button>
        </menu>
      </form>`;
    document.body.appendChild(dialog);
    byId('taskPerson').innerHTML=['shared','donna','tod','frank'].map(k=>`<option value="${k}">${esc(personLabel(k))}</option>`).join('');
    dialog.querySelectorAll('input[name="taskMode"]').forEach(r=>r.addEventListener('change',updateTaskDateVisibility));
    byId('closeTaskBtn').onclick=()=>dialog.close();
    byId('cancelTaskBtn').onclick=()=>dialog.close();
    byId('deleteTaskBtn').onclick=deleteCurrentTask;
    byId('taskForm').addEventListener('submit',saveTaskFromDialog);
  }

  function updateTaskDateVisibility(){
    const mode=document.querySelector('input[name="taskMode"]:checked')?.value || MODES.TIMELESS;
    const needsDate=mode!==MODES.TIMELESS;
    byId('taskDateLabel')?.classList.toggle('hidden',!needsDate);
    if(byId('taskDate')) byId('taskDate').required=needsDate;
  }

  function openTaskDialog(dateStr=null,task=null){
    installDialog();
    const dialog=byId('taskDialog');
    const edit=!!task;
    byId('taskDialogTitle').textContent=edit?'Edit Task':'New Task';
    byId('taskId').value=task?.id||'';
    byId('taskTitle').value=task?.title||'';
    byId('taskNotes').value=task?.notes||'';
    byId('taskPerson').value=task?.person_key||'shared';
    byId('taskImportant').checked=(task?.priority||'normal')==='important';
    const mode=task?.task_mode || (dateStr?MODES.FROM_DATE:MODES.TIMELESS);
    const radio=dialog.querySelector(`input[name="taskMode"][value="${mode}"]`);
    if(radio) radio.checked=true;
    byId('taskDate').value=task?.assigned_date || dateStr || todayIso();
    byId('deleteTaskBtn').classList.toggle('hidden',!edit);
    updateTaskDateVisibility();
    dialog.showModal();
    setTimeout(()=>byId('taskTitle').focus(),0);
  }

  async function saveTaskFromDialog(ev){
    ev.preventDefault();
    const title=byId('taskTitle').value.trim();
    if(!title){ byId('taskTitle').focus(); return; }
    const id=byId('taskId').value || (crypto.randomUUID?crypto.randomUUID():'task-'+Date.now());
    const existing=tasks.find(t=>t.id===id);
    const mode=document.querySelector('input[name="taskMode"]:checked')?.value || MODES.TIMELESS;
    const task=normalizeTask({
      ...(existing||{}), id, title,
      notes:byId('taskNotes').value.trim(),
      person_key:byId('taskPerson').value||'shared',
      task_mode:mode,
      assigned_date:mode===MODES.TIMELESS?null:byId('taskDate').value,
      priority:byId('taskImportant').checked?'important':'normal',
      completed:existing?.completed||false,
      completed_at:existing?.completed_at||null,
      sort_order:existing?.sort_order||0
    });
    try{
      const saved=await persistTask(task);
      const idx=tasks.findIndex(t=>t.id===saved.id);
      if(idx>=0) tasks[idx]=saved; else tasks.push(saved);
      byId('taskDialog').close();
      refreshTaskPanels();
      if(typeof setSyncStatus==='function') setSyncStatus('Task saved to Poirier\'s Planner');
    }catch(error){
      console.error(error);
      alert(`Task was not saved.\n\n${error?.message||error}`);
    }
  }

  async function deleteCurrentTask(){
    const id=byId('taskId').value;
    const task=tasks.find(t=>t.id===id);
    if(!task || !confirm(`Delete “${task.title}”?`)) return;
    try{ await removeTask(id); byId('taskDialog').close(); refreshTaskPanels(); }
    catch(error){ alert(`Task was not deleted.\n\n${error?.message||error}`); }
  }

  async function setTaskCompleted(id,completed){
    const current=tasks.find(t=>t.id===id);
    if(!current) return;
    const changed={...current,completed,completed_at:completed?new Date().toISOString():null};
    try{
      const saved=await persistTask(changed);
      const idx=tasks.findIndex(t=>t.id===id);
      if(idx>=0) tasks[idx]=saved;
      refreshTaskPanels();
      if(typeof setSyncStatus==='function') setSyncStatus(completed?'Task completed':'Task reopened');
    }catch(error){
      alert(`Task was not updated.\n\n${error?.message||error}`);
      refreshTaskPanels();
    }
  }

  function taskRow(task){
    const row=document.createElement('div');
    row.className='planner-task-row'+(task.priority==='important'?' important':'');
    row.innerHTML=`<label class="planner-task-check"><input type="checkbox" aria-label="Complete ${esc(task.title)}" /><span></span></label>
      <button type="button" class="planner-task-edit"><strong>${task.priority==='important'?'! ':''}${esc(task.title)}</strong><small>${esc(personLabel(task.person_key))}${task.notes?' · '+esc(task.notes):''}</small></button>`;
    row.querySelector('input').addEventListener('change',ev=>setTaskCompleted(task.id,ev.target.checked));
    row.querySelector('.planner-task-edit').onclick=()=>openTaskDialog(task.assigned_date||todayIso(),task);
    return row;
  }

  function buildPanel(col){
    const dateStr=col.dataset.date;
    if(!dateStr || col.querySelector('.planner-task-panel')) return;
    const panel=document.createElement('div');
    panel.className='planner-task-panel';
    panel.dataset.taskDate=dateStr;
    const list=tasksForDate(dateStr);
    panel.innerHTML=`<button type="button" class="planner-task-toggle" aria-expanded="false"><span>Tasks</span><span class="planner-task-count">${list.length}</span><span class="planner-task-chevron">▸</span></button><div class="planner-task-body hidden"></div>`;
    const anchor=col.querySelector('.all-day-row') || col.querySelector('.day-timeline');
    col.insertBefore(panel,anchor);
    const body=panel.querySelector('.planner-task-body');
    list.forEach(t=>body.appendChild(taskRow(t)));
    const add=document.createElement('button');
    add.type='button'; add.className='planner-task-add'; add.textContent='+ New Task'; add.onclick=()=>openTaskDialog(dateStr,null); body.appendChild(add);
    panel.querySelector('.planner-task-toggle').onclick=()=>{
      const hidden=body.classList.toggle('hidden');
      panel.querySelector('.planner-task-toggle').setAttribute('aria-expanded',String(!hidden));
      panel.querySelector('.planner-task-chevron').textContent=hidden?'▸':'▾';
    };
  }

  function refreshTaskPanels(){
    document.querySelectorAll('.planner-task-panel').forEach(p=>p.remove());
    document.querySelectorAll('#calendarGrid .day-column').forEach(buildPanel);
    updateHeaderTaskCount();
  }

  function updateHeaderTaskCount(){
    const btn=byId('addTaskBtn');
    if(!btn) return;
    const count=tasks.filter(t=>!t.completed && matchesCalendarFilter(t)).length;
    btn.textContent=count?`Tasks (${count})`:'Tasks';
  }

  function installHeaderButton(){
    if(byId('addTaskBtn')) return;
    const actions=document.querySelector('.header-actions');
    const addEvent=byId('addEventBtn');
    if(!actions) return;
    const btn=document.createElement('button');
    btn.id='addTaskBtn'; btn.type='button'; btn.className='secondary compact-add'; btn.textContent='Tasks';
    btn.onclick=()=>openTaskDialog(null,null);
    actions.insertBefore(btn,addEvent||null);
  }

  function renderTaskSetupNeeded(){
    document.querySelectorAll('.planner-task-panel').forEach(p=>p.remove());
    document.querySelectorAll('#calendarGrid .day-column').forEach(col=>{
      const panel=document.createElement('div');
      panel.className='planner-task-panel planner-task-unavailable';
      panel.innerHTML='<span>Tasks unavailable until the Poirier Planner task SQL is installed.</span>';
      const anchor=col.querySelector('.all-day-row') || col.querySelector('.day-timeline');
      col.insertBefore(panel,anchor);
    });
    const btn=byId('addTaskBtn');
    if(btn){ btn.textContent='Tasks setup needed'; btn.disabled=true; }
  }

  function watchCalendar(){
    const grid=byId('calendarGrid');
    if(!grid || observer) return;
    observer=new MutationObserver(()=>{
      if(!grid.querySelector('.day-column')) return;
      if(taskFeatureReady) refreshTaskPanels(); else renderTaskSetupNeeded();
    });
    observer.observe(grid,{childList:true});
  }

  async function initPlannerTasks(){
    installDialog();
    installHeaderButton();
    watchCalendar();
    await loadTasks();
  }

  window.PoirierPlannerTasks={visibleOnDate,tasksForDate,refresh:loadTasks,open:openTaskDialog,MODES};

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(initPlannerTasks,0));
  else setTimeout(initPlannerTasks,0);
})();