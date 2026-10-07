import { evaluateAgent } from "./evaluate-agent.mjs";
const report = await evaluateAgent(process.argv[2] ?? "http://127.0.0.1:3001", {
  outputFile: process.argv[3] ?? ".local/pi-live/evaluation.json",
  suite: process.argv[4] ?? "smoke",
});
if (!report.passed) process.exitCode = 1;
