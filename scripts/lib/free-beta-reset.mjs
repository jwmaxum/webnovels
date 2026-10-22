// Explicit one-time test-data cleanup. This is never an application/API capability.
// Preserve all administrator records and Auth identities; never TRUNCATE ... CASCADE.
import assert from 'node:assert/strict';
export const clearedTables = Object.freeze([
 'authoring.author_identity_accounts','authoring.author_identity_attempts','authoring.author_rights_consents',
 'authoring.cancelled_episode_schedules','authoring.draft_revisions','authoring.draft_save_requests','authoring.drafts',
 'authoring.files','authoring.legacy_episode_scope','authoring.legacy_work_scope','authoring.new_serial_works',
 'authoring.publication_heads','authoring.publication_rights_consents','authoring.publication_versions',
 'authoring.publish_requests','authoring.revision_files','authoring.schedules','authoring.signup_attempts',
 'authoring.verified_author_persons','authoring.work_create_requests','authoring.work_state',
 'launch_recovery.author_bank_attempts','launch_recovery.author_dashboard_audit','launch_recovery.author_payout_details',
 'launch_recovery.reconciliation_history','launch_recovery.virtual_accounts','launch_recovery.work_curation_audit',
 'launch_recovery.work_curation_versions',
 ...['ad_events','ad_units','author_earnings','author_private_profiles','author_settlement_accounts','author_settlements',
 'author_subscriptions','authors','comment_likes','comments','content_reviews','creator_comment_blocks','creator_supports',
 'earning_ledger','episode_contents','episode_draft_revisions','episode_drafts','episode_panels','episode_unlocks',
 'episodes','events','fan_meeting_tickets','fan_meetings','favorites','golden_best_snapshots','goods','goods_orders',
 'platform_stats','point_accounts','point_transactions','reader_events','readers','reading_history','reports',
 'revenue_events','revenue_ledger','revenue_periods','secure_episode_contents','work_comment_policies','works'].map(t=>'public.'+t)
]);
const preservedTables = Object.freeze(['public.admin_users','public.audit_logs','public.system_config',
 'authoring.enrollment_documents','authoring.enrollment_settings','authoring.migrations','authoring.new_serial_service',
 'authoring.retention_policy','authoring.identity_evidence','launch_recovery.account_links','launch_recovery.account_service',
 'launch_recovery.account_audit','launch_recovery.admin_permission_audit','launch_recovery.author_workspace_service']);
const rows=(s,name)=>s.tables.find(t=>t.schema+'.'+t.name===name)?.rows.map(JSON.parse)||[];
export function resetInventory(snapshot){
 const inventory=snapshot.tables.filter(t=>['public','authoring','launch_recovery','commerce','growth'].includes(t.schema)).map(t=>t.schema+'.'+t.name).sort();
 assert.deepEqual(inventory,[...clearedTables,...preservedTables].sort(),'BETA_RESET_SCHEMA_REVIEW_REQUIRED');
 assert.equal(rows(snapshot,'storage.objects').length,0,'BETA_RESET_STORAGE_REVIEW_REQUIRED');
 const admins=rows(snapshot,'public.admin_users'),users=rows(snapshot,'auth.users');
 assert.ok(admins.length&&admins.some(a=>a.is_active&&a.role==='SUPER_ADMIN'&&a.auth_user_id),'BETA_RESET_ACTIVE_ADMIN_REQUIRED');
 const retained=users.filter(u=>admins.some(a=>a.auth_user_id===u.id||a.email&&a.email.toLowerCase()===u.email?.toLowerCase()));
 assert.ok(retained.length,'BETA_RESET_ADMIN_AUTH_REQUIRED');
 const retainedIds=new Set(retained.map(u=>u.id));
 // Admin audit/retention foreign keys may refer to an operator outside admin_users. Preserve that identity too.
 for(const name of ['launch_recovery.account_audit','launch_recovery.admin_permission_audit'])
  for(const row of rows(snapshot,name))if(row.actor_id)retainedIds.add(row.actor_id);
 for(const row of rows(snapshot,'authoring.retention_policy'))if(row.approved_by)retainedIds.add(row.approved_by);
 return {adminProfiles:admins.length,retainedAuthIds:[...retainedIds],deleteAuthIds:users.filter(u=>!retainedIds.has(u.id)).map(u=>u.id),clearedTables:[...clearedTables]};
}
export function resetSql(snapshot){
 resetInventory(snapshot);
 return `
 do $$ begin
  if current_setting('webnovels.beta_test_data_reset',true) is distinct from '2026-10-22-authorized'
   or coalesce(current_setting('webnovels.workspace_backup_sha256',true),'') !~ '^[a-f0-9]{64}$'
   or exists(select 1 from authoring.new_serial_service where enabled)
   or exists(select 1 from authoring.enrollment_settings where enabled)
   or exists(select 1 from storage.objects) then raise exception 'BETA_RESET_PRECONDITION_FAILED'; end if;
 end $$;
 -- All FK-related content tables are named. RESTRICT is intentional; schema drift must abort.
 truncate table ${clearedTables.join(',')} continue identity restrict;
 alter table launch_recovery.account_links disable trigger account_links_immutable;
 delete from launch_recovery.account_links where kind<>'admin';
 alter table launch_recovery.account_links enable trigger account_links_immutable;
 alter table authoring.identity_evidence disable trigger immutable_record;
 delete from authoring.identity_evidence where profile_kind<>'admin';
 alter table authoring.identity_evidence enable trigger immutable_record;
 -- Legacy test provider values must not become working credentials after cleanup.
 update public.system_config set toss_client_key=null,toss_secret_key=null,toss_mid=null,
  kcp_site_key=null,kcp_site_code=null,reward_ad_enabled=false;
 `;
}
