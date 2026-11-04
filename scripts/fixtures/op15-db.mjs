import {readFile} from 'node:fs/promises';
import {setup as foundation,operator} from './op14-db.mjs';
export {admin,reader,reviewer,operator,env} from './op14-db.mjs';
export async function setup(options={}){
 const f=await foundation(options);
 try{
  await f.db.exec("set webnovels.commerce_allocations_apply_verified='true'");
  await f.db.exec(await readFile(new URL('../../database/launch/028_commerce_allocations.sql',import.meta.url),'utf8'));
  const allocate=async(action,data={},user=operator)=>(await f.db.query('select public.op15_commerce_allocations($1,$2,$3) r',[user,action,JSON.stringify(data)])).rows[0].r;
  const awrite=(action,data={},user)=>allocate(action,{requestId:crypto.randomUUID(),...data},user);
  return {...f,allocate,awrite};
 }catch(e){await f.db.close();throw e;}
}
