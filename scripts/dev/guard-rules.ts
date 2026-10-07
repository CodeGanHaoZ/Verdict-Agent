import { load_server_config } from '../../apps/server/src/config.js';
import { Store } from '../../apps/server/src/store.js';
import { GuardReports } from '../../apps/server/src/guard-reports.js';
const [file,action,id]=process.argv.slice(2);
if(!file||!['list','test','enable','revoke'].includes(action??''))throw new Error('Usage: npm run guard:rules -- CONFIG list|test|enable|revoke [RULE_ID]. Stop the instance first; maintenance requires its exclusive SQLite writer lock.');
const config=load_server_config(file),store=new Store(config.dataDir);
try{const reports=new GuardReports(store,config);console.log(JSON.stringify(action==='list'?reports.rules():reports.maintain(id,action as 'test'|'enable'|'revoke'),null,2));}finally{store.close();}
