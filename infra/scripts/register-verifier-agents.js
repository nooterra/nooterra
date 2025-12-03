#!/usr/bin/env node
/**
 * Register verification agents with Nooterra.
 *
 * For now we add a summarization verifier that uses the HuggingFace
 * bart-large-mnli model as an NLI-based checker.
 *
 * Capability:
 *   cap.verify.summary.nli.v1
 * Input schema:
 *   { source: string; summary: string }
 * Output (contract, not enforced here):
 *   { ok: boolean; label: string; scores?: any }
 */

import fetch from "node-fetch";

const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.nooterra.ai";
const REGISTRY_API_KEY = process.env.REGISTRY_API_KEY || "Zoroluffy444!";

const VERIFIER_AGENTS = [
  {
    did: "did:noot:hf:bart_mnli_summary_verifier",
    name: "Summary Verifier (BART-MNLI)",
    endpoint: "https://api-inference.huggingface.co/models/facebook/bart-large-mnli",
    capabilityId: "cap.verify.summary.nli.v1",
    description: "Verify whether a summary is entailed by the source text using BART-MNLI.",
    tags: ["verify", "summarization", "nli", "huggingface"],
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Original source text" },
        summary: { type: "string", description: "Candidate summary to verify" },
      },
      required: ["source", "summary"],
    },
  },
  {
    did: "did:noot:hf:xlmr_translate_verifier",
    name: "Translation Verifier (XLM-R XNLI)",
    endpoint: "https://api-inference.huggingface.co/models/joeddav/xlm-roberta-large-xnli",
    capabilityId: "cap.verify.translate.nli.v1",
    description: "Check whether a translation is semantically entailed by the source text using multilingual XLM-R XNLI.",
    tags: ["verify", "translation", "nli", "huggingface", "multilingual"],
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Original source text" },
        translation: { type: "string", description: "Candidate translation to verify" },
        source_lang: {
          type: "string",
          description: "Optional source language code (e.g. 'de', 'fr')",
        },
        target_lang: {
          type: "string",
          description: "Optional target language code (e.g. 'en')",
        },
      },
      required: ["source", "translation"],
    },
  },
  {
    did: "did:noot:nooterra:code_tests_verifier",
    name: "Code Tests Verifier",
    endpoint: process.env.CODE_VERIFY_ENDPOINT || "http://localhost:4005/verify",
    capabilityId: "cap.verify.code.tests.v1",
    description: "Verify generated code by running or simulating tests and static analysis.",
    tags: ["verify", "code", "tests", "quality"],
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "Programming language of the code (e.g. 'typescript', 'python')",
        },
        code: {
          type: "string",
          description: "Full source code or patch to verify",
        },
        tests: {
          type: "string",
          description: "Optional tests or instructions describing expected behavior",
        },
        context: {
          type: "string",
          description: "Optional additional context such as error messages or stack traces",
        },
      },
      required: ["language", "code"],
    },
  },
];

async function registerVerifier(agent) {
  console.log(`\n🛡️ Registering verifier: ${agent.name} (${agent.did})`);

  const payload = {
    did: agent.did,
    name: agent.name,
    endpoint: agent.endpoint,
    capabilities: [
      {
        capabilityId: agent.capabilityId,
        description: agent.description,
        tags: agent.tags,
        input_schema: agent.inputSchema,
        output_schema: undefined,
      },
    ],
  };

  const res = await fetch(`${REGISTRY_URL}/v1/agent/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": REGISTRY_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`   ❌ Failed: ${res.status} ${text}`);
    return false;
  }
  console.log("   ✅ Registered:", text.trim());
  return true;
}

async function main() {
  console.log("🚀 Registering verifier agents");
  console.log("=========================================");
  console.log(`Registry: ${REGISTRY_URL}`);
  let ok = 0;
  let fail = 0;
  for (const agent of VERIFIER_AGENTS) {
    const res = await registerVerifier(agent);
    if (res) ok++;
    else fail++;
  }
  console.log("=========================================");
  console.log(`✅ Registered: ${ok}`);
  console.log(`❌ Failed    : ${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
