import { resolve } from "node:path";
import { createLocalStack } from "./local-stack.mjs";

const stack = createLocalStack();
try {
  const { bases } = await stack.start();
  await stack.command("scripts/dev/verify.mjs", [
    ...bases,
    resolve(stack.directory, "verification.json"),
  ]);
  await stack.command("examples/consumer/dist/tools-main.js", bases);
  console.log(
    `Five-process verification passed. Local evidence retained at ${stack.directory}`,
  );
} finally {
  await stack.close();
}
