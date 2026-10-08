// Account-scoped reader activity. No profile names or localStorage keys authorize writes.
(function() {
  'use strict';
  let owner=null, state=null, flight=null, generation=0, activitySequence=0;
  const active=()=>window.WEBNOVELS_CONFIG?.readerServiceEnabled===true;
  const actor=()=>window.WebNovelsAuth?.getActor();
  function ensure() {
    const id=actor()?.userId||null;
    if (id!==owner) {owner=id;state=null;flight=null;generation++;activitySequence++;}
    if (!id||!actor()?.reader) throw Error('READER_REQUIRED');
    return id;
  }
  async function api(action,{workId,episodeId}={},data) {
    const query=new URLSearchParams({action});
    if(workId!=null)query.set('workId',String(workId));
    if(episodeId!=null)query.set('episodeId',String(episodeId));
    if(action==='comments') {
      const response=await fetch('/api/v2/reader/hub?'+query,{credentials:'omit'});
      if(!response.ok)throw Error('COMMENTS_UNAVAILABLE');
      return response.json();
    }
    const user=ensure(), epoch=generation;
    const result=await window.WebNovelsAuth.api('/api/v2/reader/hub?'+query,
      data===undefined?undefined:{method:'POST',body:JSON.stringify(data)});
    if(epoch!==generation||owner!==user||actor()?.userId!==user)throw Error('SESSION_CHANGED');
    return result;
  }
  async function activity(force=false) {
    const user=ensure(), epoch=generation;
    if(state&&!force)return state;
    if(flight&&!force)return flight;
    const sequence=++activitySequence;
    const pending=api('activity').then(value=>{
      if(epoch!==generation||owner!==user||sequence!==activitySequence)throw Error('ACTIVITY_CHANGED');
      state=value;return value;
    });
    const current=pending.finally(()=>{if(flight===current)flight=null;});
    flight=current;
    return flight;
  }
  async function change(action,ids,data) {
    ensure();
    // Invalidate even if the outcome is unknown; an older GET must not restore stale activity.
    state=null;flight=null;activitySequence++;
    const result=await api(action,ids,data);
    if(['favorite','subscribe','preferences'].includes(action))await activity(true);
    else if(action==='progress'){state=null;flight=null;activitySequence++;}
    return result;
  }
  function reset(){owner=null;state=null;flight=null;generation++;activitySequence++;}
  window.ReaderHub=Object.freeze({active,activity,change,api,reset,
    get cached(){return owner===actor()?.userId?state:null;}});
})();
