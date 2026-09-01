const TOD_DONNA_DELETED_OCCURRENCE_SENTINEL='__TOD_DONNA_DELETE_OCCURRENCE__';

materializeSeriesOccurrence = function(parent, originalDate){
  const ex=exceptionFor(parent.id,originalDate);
  if(ex?.exception_status==='cancelled' && ex?.new_notes===TOD_DONNA_DELETED_OCCURRENCE_SENTINEL) return null;
  return {
    ...parent,
    id:parent.id+'__'+originalDate,
    parent_event_id:parent.id,
    original_event_date:originalDate,
    recurring_instance:true,
    recurrence_exception_id:ex?.id||null,
    date:ex?.new_event_date||originalDate,
    start_time:(ex?.new_start_time||parent.start_time||'00:00').slice(0,5),
    end_time:(ex?.new_end_time||parent.end_time||'23:59').slice(0,5),
    title:ex?.new_title ?? parent.title,
    notes:ex?.new_notes===TOD_DONNA_DELETED_OCCURRENCE_SENTINEL ? parent.notes : (ex?.new_notes ?? parent.notes),
    status: ex?.exception_status==='cancelled' ? 'cancelled' : (originalDate===parent.date ? parent.status : 'scheduled')
  };
};

handleDeleteDetails = async function(){
  const e=state.detailsEvent;
  if(!e) return;
  if(!isSeriesOccurrence(e)){
    if(!confirm(`Delete “${e.title}”?`)) return;
    await deleteEvent(e.id);
    $('eventDetailsDialog').close(); render(); return;
  }
  const scope=chooseSeriesScope('Delete');
  if(!scope) return;
  const parent=parentEventFor(e);
  if(!parent){ alert('The recurring series could not be found.'); return; }
  const original=e.original_event_date || e.date;
  if(scope==='occurrence'){
    await saveException({parent_event_id:parent.id,original_event_date:original,exception_status:'cancelled',new_notes:TOD_DONNA_DELETED_OCCURRENCE_SENTINEL});
  }else if(scope==='future'){
    if(original<=parent.date){
      await deleteEvent(parent.id);
    }else{
      await saveEvent({...parent,recurrence_rule:{...parent.recurrence_rule,until:previousDate(original)}});
      await deleteExceptionsFrom(parent.id,original);
    }
  }else{
    await deleteEvent(parent.id);
  }
  $('eventDetailsDialog').close(); render();
};

handleEditDetails = function(){
  const e=state.detailsEvent;
  if(!e) return;
  if(!isSeriesOccurrence(e)){
    $('eventDetailsDialog').close(); openDialog(e); return;
  }
  const parent=parentEventFor(e);
  if(!parent){ alert('The recurring series could not be found.'); return; }
  const original=e.original_event_date || e.date;
  $('eventDetailsDialog').close();
  openDialog(e,{type:'occurrence',parentId:parent.id,originalDate:original});
};

// Re-render once the patch is loaded so already-cancelled recurring occurrences become visible.
if(typeof render==='function') render();
