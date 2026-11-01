"use strict";
(() => {
  const root=document.querySelector('[data-security-job]');if(!root)return;
  const fingerprint=root.dataset.version;
  if(['completed','failed','interrupted','cancelled'].includes(root.dataset.state))return;
  async function update(){
    try{
      const response=await fetch('/api/jobs/'+encodeURIComponent(root.dataset.securityJob),{credentials:'same-origin',cache:'no-store'});
      if(response.status===401){location.assign('/?return='+encodeURIComponent(location.pathname));return;}
      if(response.ok){const job=await response.json(),current=JSON.stringify([job.state,job.usage.calls||0,job.usage.tokens||0,job.events.length]);
        if(current!==fingerprint&&!document.activeElement?.closest('form')){location.reload();return;}
      }
    }catch{}
    if(!document.hidden)setTimeout(update,3000);else setTimeout(update,10000);
  }
  setTimeout(update,2000);
})();
