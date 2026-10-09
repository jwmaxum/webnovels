// Direct installed-version advisories only; does not calculate npm meta-vulnerabilities.
const fs=require('node:fs');
const semver=require('semver');
function dependencyVersions(lock, vendors=[]){
  const versions={};
  for(const [file,entry] of Object.entries(lock.packages||{})){
    if(!file.includes('node_modules/')||entry.link)continue;
    const name=file.slice(file.lastIndexOf('node_modules/')+13);
    if(!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)||!semver.valid(entry.version))throw Error('DEPENDENCY_VERSION_INVALID');
    (versions[name]||=new Set()).add(entry.version);
  }
  for(const vendor of vendors){if(!semver.valid(vendor.version))throw Error('DEPENDENCY_VERSION_INVALID');(versions[vendor.name]||=new Set()).add(vendor.version);}
  return Object.fromEntries(Object.entries(versions).sort(([a],[b])=>a.localeCompare(b)).map(([name,values])=>[name,[...values].sort()]));
}
function findingsFromAdvisories(versions,response){
  if(!response||typeof response!=='object'||Array.isArray(response))throw Error('DEPENDENCY_AUDIT_INVALID');
  const findings=[];
  for(const [name,advisories] of Object.entries(response)){
    if(!versions[name]||!Array.isArray(advisories))throw Error('DEPENDENCY_AUDIT_INVALID');
    for(const advisory of advisories){
      if(!['low','moderate','high','critical'].includes(advisory.severity)||!semver.validRange(advisory.vulnerable_versions)||
         typeof advisory.url!=='string'||!/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9-]+$/.test(advisory.url))throw Error('DEPENDENCY_AUDIT_INVALID');
      const affected=versions[name].filter(version=>semver.satisfies(version,advisory.vulnerable_versions,{includePrerelease:true}));
      if(affected.length)findings.push({name,versions:affected,severity:advisory.severity,url:advisory.url});
    }
  }
  return findings;
}
async function main(){
  const versions=dependencyVersions(JSON.parse(fs.readFileSync('package-lock.json','utf8')),JSON.parse(fs.readFileSync('public/vendor/manifest.json','utf8')).assets);
  const response=await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(versions),redirect:'error',signal:AbortSignal.timeout(20000)
  });
  if(!response.ok)throw Error('DEPENDENCY_AUDIT_UNAVAILABLE');
  const body=await response.text();if(body.length>4000000)throw Error('DEPENDENCY_AUDIT_TOO_LARGE');
  const findings=findingsFromAdvisories(versions,JSON.parse(body));
  const report={checkedAt:new Date().toISOString(),scope:'Direct advisory ranges for package-lock versions and pinned browser vendors; excludes npm meta-vulnerability calculation',
    packages:Object.keys(versions).length,findings,pass:findings.length===0};
  fs.mkdirSync('scratch/stage19',{recursive:true});fs.writeFileSync('scratch/stage19/dependency-advisories.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=2;
}
if(require.main===module)main().catch(()=>{console.error('DEPENDENCY_AUDIT_INCOMPLETE_DETAILS_WITHHELD');process.exitCode=2;});
module.exports={dependencyVersions,findingsFromAdvisories};
