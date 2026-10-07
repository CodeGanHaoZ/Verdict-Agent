import { loadDataset } from "./agent-dataset.mjs";
const { manifest, cases, caseHash } = loadDataset();
console.log(
  JSON.stringify(
    {
      datasetVersion: manifest.datasetVersion,
      cases: cases.length,
      smokeCases: cases.filter((c) => c.suite === "smoke").length,
      snapshotFiles: manifest.sources.length,
      accountBlockPairs: manifest.sources.reduce(
        (n, s) => n + s.accounts.length,
        0,
      ),
      caseHash,
      status: "VALIDATED_OFFLINE",
    },
    null,
    2,
  ),
);
