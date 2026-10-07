import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd(),base=resolve(root,'.local/observability'),source=resolve(base,'upstream');
const spec=JSON.parse(readFileSync('integrations/pi-observability/upstream.json','utf8'));
mkdirSync(base,{recursive:true,mode:0o700});
const run=(cmd,args,cwd=root)=>execFileSync(cmd,args,{cwd,stdio:'inherit'});
if(!existsSync(source)){
 run('git',['clone','--no-checkout',spec.repository,source]);
 run('git',['checkout','--detach',spec.commit],source);
}
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
if(sha!==spec.commit)throw new Error('Upstream checkout differs; preserve it and choose a separate installation directory.');
const patch=resolve(root,'integrations/pi-observability/upstream.patch');
if(existsSync(patch)){
 const already=()=>{try{execFileSync('git',['apply','--reverse','--check',patch],{cwd:source,stdio:'ignore'});return true;}catch{return false;}};
 if(!already()){run('git',['apply','--check',patch],source);run('git',['apply',patch],source);}
}
if(!process.env.VERDICT_BUN_BIN){
 if(!['linux','darwin','win32'].includes(process.platform)||!['x64','arm64'].includes(process.arch))throw new Error('Set VERDICT_BUN_BIN to an explicitly installed Bun runtime.');
 const platform=process.platform==='win32'?'windows':process.platform;
 const runtime=resolve(base,'runtime');mkdirSync(runtime,{recursive:true});
 const packageName=`@oven/bun-${platform}-${process.arch}`;
 if(!existsSync(resolve(runtime,'package.json')))writeFileSync(resolve(runtime,'package.json'),JSON.stringify({private:true,dependencies:{[packageName]:spec.bunVersion}},null,2));
 run(process.platform==='win32'?'npm.cmd':'npm',['install','--ignore-scripts','--no-audit','--no-fund'],runtime);
 const bin=resolve(runtime,'node_modules',packageName,'bin',process.platform==='win32'?'bun.exe':'bun');
 run(bin,['--version']);writeFileSync(resolve(base,'runtime.json'),JSON.stringify({bin,version:spec.bunVersion},null,2));
}
console.log('Pinned Pi Observability installed locally. Upstream extension and auto-install commands were not loaded.');
