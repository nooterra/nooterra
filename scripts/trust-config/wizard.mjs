#!/usr/bin/env node
import fs from "node:fs/promises";

import {
  SLA_POLICY_TEMPLATE_CATALOG_VERSION,
  getSlaPolicyTemplate,
  listSlaPolicyTemplates,
  renderSlaPolicyTemplate
} from "../../src/core/sla-policy-templates.js";

function usage() {
  const text = [
    "usage:",
    "  node scripts/trust-config/wizard.mjs list [--vertical delivery|security] [--format json|text]",
    "  node scripts/trust-config/wizard.mjs show --template <templateId> [--format json|text]",
    "  node scripts/trust-config/wizard.mjs render --template <templateId> [--overrides-json <json>] [--out <path>] [--format json|text]",
    "  node scripts/trust-config/wizard.mjs validate --template <templateId> [--overrides-json <json>] [--format json|text]"
  ].join("\n");
  process.stderr.write(text + "\n");
}

function parseArgs(argv) {
  const out = {
    command: argv[0] ?? null,
    templateId: null,
    vertical: null,
    overridesJson: null,
    outPath: null,
    format: "json"
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--template") {
      out.templateId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--vertical") {
      out.vertical = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--overrides-json") {
      out.overridesJson = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--format") {
      out.format = String(argv[i + 1] ?? "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.command) throw new Error("command is required");
  if (out.format !== "json" && out.format !== "text") throw new Error("format must be json or text");
  return out;
}

function parseOverrides(overridesJson) {
  if (!overridesJson || !String(overridesJson).trim()) return null;
  try {
    return JSON.parse(String(overridesJson));
  } catch (err) {
    throw new Error(`invalid --overrides-json: ${err?.message ?? "parse failed"}`);
  }
}

function renderTextList(templates) {
  const lines = [];
  for (const template of templates) {
    lines.push(`${template.templateId}\t${template.vertical}\t${template.name}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function renderTextShow(template) {
  return [
    `templateId: ${template.templateId}`,
    `vertical: ${template.vertical}`,
    `name: ${template.name}`,
    `description: ${template.description}`
  ].join("\n") + "\n";
}

async function output({ format, payload, text, outPath }) {
  const body = format === "json" ? JSON.stringify(payload, null, 2) + "\n" : text;
  if (outPath) {
    await fs.writeFile(outPath, body, "utf8");
    return;
  }
  process.stdout.write(body);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage();
    process.stderr.write(`${err?.message ?? "invalid arguments"}\n`);
    process.exit(2);
  }

  const overrides = parseOverrides(parsed.overridesJson);

  if (parsed.command === "list") {
    const templates = listSlaPolicyTemplates({ vertical: parsed.vertical });
    const payload = { schemaVersion: SLA_POLICY_TEMPLATE_CATALOG_VERSION, templates };
    await output({ format: parsed.format, payload, text: renderTextList(templates), outPath: parsed.outPath });
    return;
  }

  if (parsed.command === "show") {
    if (!parsed.templateId) throw new Error("--template is required for show");
    const template = getSlaPolicyTemplate({ templateId: parsed.templateId });
    if (!template) throw new Error("template not found");
    await output({ format: parsed.format, payload: template, text: renderTextShow(template), outPath: parsed.outPath });
    return;
  }

  if (parsed.command === "render") {
    if (!parsed.templateId) throw new Error("--template is required for render");
    const rendered = renderSlaPolicyTemplate({ templateId: parsed.templateId, overrides });
    if (!rendered) throw new Error("template not found");
    const payload = {
      schemaVersion: "SettldTrustWizardOutput.v1",
      templateId: rendered.templateId,
      config: rendered.defaults
    };
    const text = JSON.stringify(payload.config, null, 2) + "\n";
    await output({ format: parsed.format, payload, text, outPath: parsed.outPath });
    return;
  }

  if (parsed.command === "validate") {
    if (!parsed.templateId) throw new Error("--template is required for validate");
    const rendered = renderSlaPolicyTemplate({ templateId: parsed.templateId, overrides });
    if (!rendered) throw new Error("template not found");
    const payload = { ok: true, templateId: rendered.templateId };
    const text = "ok\n";
    await output({ format: parsed.format, payload, text, outPath: parsed.outPath });
    return;
  }

  throw new Error(`unsupported command: ${parsed.command}`);
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? "error"}\n`);
  process.exit(1);
});
