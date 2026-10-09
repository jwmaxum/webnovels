// Reuse the same free-launch gates; preserve stage 22's historical evidence.
const {audit}=require('./audit_stage22_launch.cjs');
audit('artifacts/stage23-launch-readiness.json').catch(e=>{
  console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'STAGE23_AUDIT_FAILED_DETAILS_WITHHELD');process.exitCode=2;
});
