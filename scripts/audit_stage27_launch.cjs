const {audit}=require('./audit_stage22_launch.cjs');
audit('artifacts/stage27-launch-readiness.json').catch(error=>{
  console.error(/^[A-Z_0-9]+$/.test(error.message)?error.message:'STAGE27_AUDIT_FAILED_DETAILS_WITHHELD');process.exitCode=2;
});
