const {audit}=require('./audit_stage22_launch.cjs');
audit('artifacts/stage25-launch-readiness.json').catch(e=>{
 console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'STAGE25_AUDIT_FAILED_DETAILS_WITHHELD');process.exitCode=2;
});
