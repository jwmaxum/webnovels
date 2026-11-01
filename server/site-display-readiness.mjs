// Old application versions may run during an incremental schema rollout.
// Missing RPC means the former write path still owns the data. New-schema database
// triggers independently reject legacy writes even if an availability check fails.
export async function siteDisplayInstalled(rpc){
  try{return await rpc('site_display_ready',{})===true;}
  catch(error){if(['ACCOUNT_SERVICE_NOT_ACTIVATED','DISPLAY_NOT_INSTALLED'].includes(error?.code))return false;throw error;}
}
