import {readFile} from 'node:fs/promises';
import {setup as foundation,operator} from './op13-db.mjs';
export {admin,reader,reviewer,operator,env} from './op13-db.mjs';
export async function setup(options={}){
 const f=await foundation(options);
 try{
  await f.db.exec("set webnovels.commerce_operations_apply_verified='true'");
  await f.db.exec(await readFile(new URL('../../database/launch/027_commerce_operations.sql',import.meta.url),'utf8'));
  const ops=async(action,data={},user=operator)=>(await f.db.query('select public.op14_commerce_operations($1,$2,$3) r',[user,action,JSON.stringify(data)])).rows[0].r;
  const opwrite=(action,data={},user)=>ops(action,{requestId:crypto.randomUUID(),...data},user);
  const deposit=async(amount=10000)=>{
   const order=await f.write('reader','order',{destinationHash:'d'.repeat(64)}),bankRefHash=crypto.randomUUID().replaceAll('-','').repeat(2);
   const evidence=await f.evidence(),record=await f.write('admin','deposit',{orderId:order.id,destinationHash:'d'.repeat(64),amount,bankRefHash,occurredAt:new Date().toISOString(),evidence});
   return {order,record,evidence,bankRefHash};
  };
  return {...f,ops,opwrite,deposit};
 }catch(e){await f.db.close();throw e;}
}
