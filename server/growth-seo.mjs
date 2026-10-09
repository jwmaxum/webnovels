import {createSecureApi} from './secure-api.mjs';
import {growthEnabled,measurementEnabled,publicGrowthCover,sitemapBucket} from './growth-api.mjs';
import {SECURITY_HEADERS} from './security-headers.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function origin(env){
 try{const u=new URL(env.GROWTH_CANONICAL_ORIGIN);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash)return u.origin;}catch{}
 return null;
}
function publicCover(value,env,canonical){
 const safe=publicGrowthCover(value,env);return safe?new URL(safe,canonical).href:null;
}
export async function growthSeo(request,env,{workId=null,bucket=null,fetchImpl=fetch}={}){
 const canonical=origin(env),headers={...SECURITY_HEADERS,'Cache-Control':'no-store','X-Robots-Tag':'noindex, follow'};
 const error=status=>new Response('Public metadata unavailable',{status,headers});
 if(!growthEnabled(env)||!canonical)return error(503);
 if(request.method!=='GET')return error(405);
 if(workId!==null&&(!/^[1-9]\d{0,18}$/.test(workId)||BigInt(workId)>9223372036854775807n))return error(404);
 if(bucket!==null&&(!sitemapBucket(bucket)||workId!==null))return error(404);
 const u=new URL('/api/v2/growth/seo',request.url);if(workId)u.searchParams.set('workId',workId);
 if(bucket!==null)u.searchParams.set('bucket',bucket);
 const response=await createSecureApi({fetchImpl})(new Request(u),env);
 if(!response.ok)return error(response.status);
 const {items,partitions}=await response.json();
 if(workId===null&&bucket===null){
  if(!Array.isArray(partitions))return error(503);
  const xml='<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
   partitions.map(p=>'<sitemap><loc>'+esc(canonical+'/sitemaps/'+p+'/index.xml')+'</loc></sitemap>').join('')+'</sitemapindex>';
  return new Response(xml,{headers:{...headers,'Content-Type':'application/xml; charset=utf-8'}});
 }
 if(!Array.isArray(items))return error(503);
 if(workId){
  const w=items.find(x=>x.id===workId);if(!w)return error(404);
  const url=canonical+'/works/'+w.id,image=publicCover(w.cover,env,canonical);
  return new Response('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<title>'+esc(w.title)+' · webnovels</title><meta name="description" content="'+esc(w.description)+'">'+
   '<link rel="canonical" href="'+esc(url)+'"><meta property="og:type" content="book">'+
   '<meta property="og:title" content="'+esc(w.title)+'"><meta property="og:description" content="'+esc(w.description)+'">'+
   '<meta property="og:url" content="'+esc(url)+'">'+(image?'<meta property="og:image" content="'+esc(image)+'">':'')+
   '</head><body><main><h1>'+esc(w.title)+'</h1><p>'+esc(w.description)+'</p><a href="'+esc(url+(measurementEnabled(env)?'?source=share':''))+'">작품 읽기</a></main></body></html>',
   {headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 }
 if(!items.length)return error(404);
 const xml='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
  items.map(w=>'<url><loc>'+esc(canonical+'/works/'+w.id)+'</loc>'+
   (Number.isFinite(Date.parse(w.lastModified))?'<lastmod>'+esc(new Date(w.lastModified).toISOString())+'</lastmod>':'')+'</url>').join('')+'</urlset>';
 return new Response(xml,{headers:{...headers,'Content-Type':'application/xml; charset=utf-8'}});
}
