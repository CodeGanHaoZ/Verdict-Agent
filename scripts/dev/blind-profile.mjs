import { createHash } from "node:crypto";
export function blindProfile(scenario, seed) {
  const key = (s) => createHash("sha256").update(`${seed}:${s}`).digest("hex");
  const ids = ["svc-amber", "svc-cedar", "svc-cobalt"].sort((a, b) =>
    key(a).localeCompare(key(b)),
  );
  const probeId = ids[0],
    validId = ids[1];
  const variant = ["unknown-cost", "unsupported-block"].includes(
    scenario.profile,
  )
    ? "valid"
    : ["repaired-service", "evidence-injection"].includes(scenario.profile)
      ? "repair-after-first"
      : scenario.profile;
  const slots = [
    { id: probeId, variant, role: "probe" },
    ...(scenario.fallback
      ? [{ id: validId, variant: "valid", role: "control" }]
      : []),
  ];
  return {
    seed,
    probeId,
    validId,
    slots: slots.sort((a, b) =>
      key("catalog:" + a.id).localeCompare(key("catalog:" + b.id)),
    ),
    scenario,
  };
}
