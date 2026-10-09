const test=require('node:test'),assert=require('node:assert/strict');
const {dependencyVersions,findingsFromAdvisories}=require('./audit_dependency_versions.cjs');
test('direct advisory scan checks exact affected versions including nested scoped packages',()=>{
  const versions=dependencyVersions({packages:{'':{name:'private-project',version:'1.0.0'},'node_modules/package':{version:'1.2.0'},
    'node_modules/outer/node_modules/package':{version:'1.3.0'},'node_modules/@scope/tool':{version:'2.0.0'}}});
  assert.deepEqual(versions.package,['1.2.0','1.3.0']);assert.deepEqual(versions['@scope/tool'],['2.0.0']);assert.equal(versions['private-project'],undefined);
  const result=findingsFromAdvisories(versions,{package:[{severity:'high',vulnerable_versions:'<1.3.0',url:'https://github.com/advisories/GHSA-test-abcd-1234'}]});
  assert.deepEqual(result[0].versions,['1.2.0']);assert.equal(findingsFromAdvisories(versions,{}).length,0);
});
test('malformed advisory, unavailable ranges and unknown packages are incomplete rather than clean',()=>{
  for(const response of [[],null,{unknown:[]},{package:[{severity:'high',vulnerable_versions:'not-a-range',url:'https://github.com/advisories/GHSA-test'}]},
    {package:[{severity:'high',vulnerable_versions:'*',url:'https://example.test/?private=value'}]}])assert.throws(()=>findingsFromAdvisories({package:['1.2.0']},response),/DEPENDENCY_AUDIT_INVALID/);
});
test('bcrypt 6 native prebuild hashes and verifies Korean input while rejecting a wrong password',async()=>{
  const bcrypt=require('bcrypt');const password='테스트 전용 비밀번호 19';const encoded=await bcrypt.hash(password,4);
  assert.equal(await bcrypt.compare(password,encoded),true);assert.equal(await bcrypt.compare(password+'x',encoded),false);assert.match(encoded,/^\$2[ab]\$/);
});
