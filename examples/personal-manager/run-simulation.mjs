import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDeterministicSimulation } from "../../src/services/simulation/harness.js";
import { HUMAN_APPROVAL_DECISION_SCHEMA_VERSION } from "../../src/services/human-approval/gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    outPath: path.join(__dirname, "output", "latest", "simulation-run.json")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out") out.outPath = path.resolve(argv[i + 1] ?? out.outPath);
  }
  return out;
}

async function main() {
  const { outPath } = parseArgs(process.argv.slice(2));
  const scenario = {
    scenarioId: "s8_personal_manager_flow",
    seed: "NOO-244-S8-DEMO-SEED-1",
    startedAt: "2026-02-01T00:00:00.000Z",
    approvalPolicy: {
      requireApprovalAboveCents: 100_000,
      strictEvidenceRefs: true
    },
    actions: [
      {
        actionId: "act_calendar_sync_1",
        actorId: "agent.calendar",
        managerId: "manager.personal.alex",
        ecosystemId: "ecosystem.default",
        actionType: "calendar_sync",
        riskTier: "low",
        amountCents: 0
      },
      {
        actionId: "act_transfer_1",
        actorId: "agent.wallet",
        managerId: "manager.personal.alex",
        ecosystemId: "ecosystem.default",
        actionType: "funds_transfer",
        riskTier: "high",
        amountCents: 275_000
      }
    ]
  };

  const firstPass = runDeterministicSimulation(scenario);
  const transferRow = firstPass.actionResults.find((row) => row.actionId === "act_transfer_1");
  const secondPass = runDeterministicSimulation({
    ...scenario,
    approvalsByActionId: {
      [transferRow.actionId]: {
        schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
        decisionId: "dec_transfer_1",
        actionId: transferRow.actionId,
        actionSha256: transferRow.actionSha256,
        decidedBy: "human.finance",
        decidedAt: "2026-02-01T00:10:00.000Z",
        approved: true,
        evidenceRefs: ["ticket:NOO-244", "policy:personal-agent/high-risk-transfer"]
      }
    }
  });

  const artifact = {
    schemaVersion: "NooterraPersonalManagerWorkflowResult.v1",
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    startedAt: scenario.startedAt,
    previewRun: firstPass,
    approvedRun: secondPass
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  process.stdout.write(`Wrote simulation artifact: ${outPath}\n`);
  process.stdout.write(`Preview blocked actions: ${firstPass.summary.blockedActions}\n`);
  process.stdout.write(`Approved blocked actions: ${secondPass.summary.blockedActions}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? String(err)}\n`);
  process.exitCode = 1;
});

