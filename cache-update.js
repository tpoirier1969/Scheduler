// Revalidate the release marker on launch/resume. Never reload an open editor.
async function checkPlannerUpdate(){
 try{
  const response=await fetch('version.json',{cache:'no-store'});if(!response.ok)return;
  const remote=await response.json();
  if(remote.build===window.PLANNER_BUILD||document.getElementById('plannerUpdateBtn'))return;
  const b=document.createElement('button');b.id='plannerUpdateBtn';b.type='button';b.textContent='Update available';
  b.onclick=()=>{if(document.querySelector('dialog[open]')){alert('Close or save the open editor before updating.');return;}location.reload();};
  document.querySelector('.header-actions').appendChild(b);
 }catch{ /* Offline use keeps the current app and its data. */ }
}
document.addEventListener('DOMContentLoaded',checkPlannerUpdate);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkPlannerUpdate();});
window.addEventListener('pageshow',checkPlannerUpdate);
