import {readFileSync,writeFileSync} from 'node:fs';
const [file,baseURL,modelId,apiKeyEnv]=process.argv.slice(2);
if(!file||!baseURL||!modelId||!apiKeyEnv)throw new Error('Usage: npm run guard:configure -- CONFIG BASE_URL MODEL_ID KEY_ENV_NAME. Never pass a secret value.');
const {AgentConfigSchema}=await import('../../apps/server/dist/config.js');
const cfg=JSON.parse(readFileSync(file,'utf8'));
cfg.guard=AgentConfigSchema.parse({baseURL,modelId,apiKeyEnv,source:'LIVE',compatibility:cfg.agent?.compatibility??'openai',runRequests:8,outputTokens:1024,maxDurationMs:180000});
writeFileSync(file,JSON.stringify(cfg,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({configured:true,modelId,apiKeyEnv,secretRead:false,requiresRestart:true}));
