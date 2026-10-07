import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const [fileArg, network = "bot-testnet"] = process.argv.slice(2);
if (!fileArg || network !== "bot-testnet")
  throw new Error("Usage: npm run wallet:configure-network -- .local/<dir>/local-one.json bot-testnet");
const root = process.cwd();
const file = resolve(root, fileArg);
const local = resolve(root, ".local");
const rel = relative(local, file);
if (!existsSync(file) || rel.startsWith("..") || isAbsolute(rel))
  throw new Error("Config must be an existing file inside .local");
const config = JSON.parse(readFileSync(file, "utf8"));
config.wallet = {
  networks: [{
    chainId: "0x3c8",
    name: "BOT Chain Testnet",
    rpcUrlEnv: "VERDICT_WALLET_RPC_URL",
    maxValueWei: "100000000000000",
    maxTotalFeeWei: "1000000000000000",
  }],
  rpcTimeoutMs: 8000,
  reviewTimeoutMs: 90000,
  permitTtlMs: 60000,
};
writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ configured: true, file, network: "BOT Chain Testnet", chainId: 968, rpcUrlEnv: "VERDICT_WALLET_RPC_URL", secretRead: false }));
