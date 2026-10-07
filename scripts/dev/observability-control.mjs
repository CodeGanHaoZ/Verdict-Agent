import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
const base=resolve('.local/observability'),registry=resolve(base,'process.json'),envFile=resolve(base,'observer.env');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
mkdirSync(base,{recursive:true,mode:0o700});
if(!existsSync(envFile))writeFileSync(envFile,`VERDICT_OBS_TOKEN=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
const key=readFileSync(envFile,'utf8').trim().split('=')[1];
const command=process.argv[2],port=Number(process.env.VERDICT_OBS_PORT??43190);
const old=existsSync(registry)?JSON.parse(readFileSync(registry,'utf8')):null;
const owned=()=>{try{return old&&readFileSync(`/proc/${old.pid}/cmdline`,'utf8').split('\0').includes(old.launchId);}catch{return false;}};
if(command==='stop'){
 if(owned())process.kill(old.pid,'SIGTERM');
 for(let i=0;i<50&&owned();i++)await wait(100);
 if(owned())throw new Error('Observer still running; no other process was killed.');
 if(existsSync(registry))unlinkSync(registry);console.log('Observer stopped; database and pending backend events preserved.');
}else if(command==='start'){
 if(owned())throw new Error('Observer already running.');
 const bun=process.env.VERDICT_BUN_BIN??JSON.parse(readFileSync(resolve(base,'runtime.json'),'utf8')).bin;
 const launchId=randomUUID(),file=resolve(base,'upstream/apps/observability/server.ts');
 const log=openSync(resolve(base,'server.log'),'a',0o600);
 const child=spawn(bun,[file,'--launch-id',launchId],{detached:true,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,OBS_PORT:String(port),OBS_AUTH_TOKEN:key,OBS_LOCAL_READONLY:'1',OBS_DB_PATH:resolve(base,'events.sqlite')}});
 closeSync(log);child.unref();writeFileSync(registry,JSON.stringify({pid:child.pid,launchId,port,file}),{mode:0o600});
 let ready=false;
 for(let i=0;i<60;i++){await wait(100);try{const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(300)});if(r.ok&&(await r.json()).launchId===launchId){ready=true;break;}}catch{}}
 if(!ready){try{process.kill(child.pid,'SIGTERM');}catch{}throw new Error('Observer did not start; see local server.log. Existing unrelated listeners were not stopped.');}
 console.log(`Pi Observability: http://127.0.0.1:${port}/ (local read-only; ingest token stays server-side)`);
}else if(command==='configure'){
 for(const file of process.argv.slice(3)){
  const config=JSON.parse(readFileSync(file,'utf8'));config.observability={endpoint:`http://127.0.0.1:${port}`,tokenEnv:'VERDICT_OBS_TOKEN'};
  writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600});
 }
 console.log('Observer configuration saved. Load .local/observability/observer.env when starting the backend.');
}else throw new Error('Usage: observability-control.mjs start | stop | configure CONFIG...');
