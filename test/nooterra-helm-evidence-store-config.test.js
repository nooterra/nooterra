import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Ajv from "ajv";

const REPO_ROOT = process.cwd();
const SCHEMA_PATH = path.join(REPO_ROOT, "deploy/helm/nooterra/values.schema.json");
const API_TEMPLATE_PATH = path.join(REPO_ROOT, "deploy/helm/nooterra/templates/api-deployment.yaml");
const RECEIVER_TEMPLATE_PATH = path.join(REPO_ROOT, "deploy/helm/nooterra/templates/receiver-deployment.yaml");

function makeBaseConfig() {
  return {
    image: {
      repository: "ghcr.io/nooterra/nooterra",
      tag: "0.0.0",
      pullPolicy: "IfNotPresent"
    },
    store: {
      mode: "pg",
      pgSchema: "public",
      migrateOnStartup: true,
      databaseUrlSecret: {
        name: "nooterra-db",
        key: "DATABASE_URL"
      }
    },
    evidenceStore: {
      mode: "fs",
      s3: {
        endpoint: "",
        region: "us-east-1",
        bucket: "",
        forcePathStyle: true,
        accessKeyIdSecret: {
          key: "ACCESS_KEY_ID"
        },
        secretAccessKeySecret: {
          key: "SECRET_ACCESS_KEY"
        }
      }
    },
    maintenance: {
      enabled: true
    },
    receiver: {
      enabled: false,
      tenantId: "tenant_default",
      destinationId: "receiver_v1",
      dedupeDbPath: "/data/receiver-dedupe.jsonl",
      allowInlineSecrets: false,
      hmacSecretRef: "",
      s3: {}
    }
  };
}

test("nooterra helm values schema: allows fs evidence store mode", async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const config = makeBaseConfig();
  const valid = validate(config);
  assert.equal(valid, true, `expected fs mode config to validate: ${JSON.stringify(validate.errors)}`);
});

test("nooterra helm values schema: fails closed when s3 mode misses required secret names", async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const config = makeBaseConfig();
  config.evidenceStore.mode = "s3";
  config.evidenceStore.s3.endpoint = "http://minio:9000";
  config.evidenceStore.s3.bucket = "proxy-evidence";
  const valid = validate(config);
  assert.equal(valid, false);
  const errorText = JSON.stringify(validate.errors ?? []);
  assert.match(errorText, /accessKeyIdSecret/i);
  assert.match(errorText, /secretAccessKeySecret/i);
  assert.match(errorText, /name/i);
});

test("nooterra helm values schema: allows s3 mode with complete credential refs", async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const config = makeBaseConfig();
  config.evidenceStore.mode = "s3";
  config.evidenceStore.s3.endpoint = "http://minio:9000";
  config.evidenceStore.s3.bucket = "proxy-evidence";
  config.evidenceStore.s3.accessKeyIdSecret.name = "nooterra-evidence-s3";
  config.evidenceStore.s3.secretAccessKeySecret.name = "nooterra-evidence-s3";
  const valid = validate(config);
  assert.equal(valid, true, `expected complete s3 mode config to validate: ${JSON.stringify(validate.errors)}`);
});

test("nooterra helm values schema: allows explicit api and receiver probe settings", async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const config = makeBaseConfig();
  config.api = {
    readinessProbe: {
      path: "/healthz",
      initialDelaySeconds: 1,
      periodSeconds: 4,
      timeoutSeconds: 2,
      failureThreshold: 4,
      successThreshold: 1
    },
    livenessProbe: {
      path: "/health",
      initialDelaySeconds: 3,
      periodSeconds: 8,
      timeoutSeconds: 2,
      failureThreshold: 3
    },
    startupProbe: {
      path: "/health",
      initialDelaySeconds: 0,
      periodSeconds: 5,
      timeoutSeconds: 2,
      failureThreshold: 30
    }
  };
  config.receiver.readinessProbe = {
    path: "/ready",
    initialDelaySeconds: 2,
    periodSeconds: 5,
    timeoutSeconds: 2,
    failureThreshold: 3,
    successThreshold: 1
  };
  config.receiver.livenessProbe = {
    path: "/health",
    initialDelaySeconds: 5,
    periodSeconds: 10,
    timeoutSeconds: 2,
    failureThreshold: 3
  };
  config.receiver.startupProbe = {
    path: "/health",
    initialDelaySeconds: 0,
    periodSeconds: 6,
    timeoutSeconds: 2,
    failureThreshold: 20
  };
  const valid = validate(config);
  assert.equal(valid, true, `expected probe-configured values to validate: ${JSON.stringify(validate.errors)}`);
});

test("nooterra helm values schema: fails closed for invalid startup probe period", async () => {
  const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const config = makeBaseConfig();
  config.api = {
    startupProbe: {
      path: "/health",
      initialDelaySeconds: 0,
      periodSeconds: 0,
      timeoutSeconds: 2,
      failureThreshold: 30
    }
  };
  const valid = validate(config);
  assert.equal(valid, false);
  const errorText = JSON.stringify(validate.errors ?? []);
  assert.match(errorText, /startupProbe/i);
  assert.match(errorText, /periodSeconds/i);
});

test("nooterra api deployment template wires explicit evidence store envs", async () => {
  const text = await fs.readFile(API_TEMPLATE_PATH, "utf8");
  assert.match(text, /PROXY_EVIDENCE_STORE/);
  assert.match(text, /PROXY_EVIDENCE_S3_ENDPOINT/);
  assert.match(text, /PROXY_EVIDENCE_S3_BUCKET/);
  assert.match(text, /PROXY_EVIDENCE_S3_ACCESS_KEY_ID/);
  assert.match(text, /PROXY_EVIDENCE_S3_SECRET_ACCESS_KEY/);
  assert.match(text, /evidenceStore\.s3\.accessKeyIdSecret\.name is required when evidenceStore\.mode=s3/);
  assert.match(text, /evidenceStore\.s3\.secretAccessKeySecret\.name is required when evidenceStore\.mode=s3/);
});

test("nooterra deployment templates wire api and receiver startup/readiness/liveness probes from values", async () => {
  const apiTemplate = await fs.readFile(API_TEMPLATE_PATH, "utf8");
  const receiverTemplate = await fs.readFile(RECEIVER_TEMPLATE_PATH, "utf8");

  assert.match(apiTemplate, /readinessProbe:/);
  assert.match(apiTemplate, /path: \{\{ \.Values\.api\.readinessProbe\.path \| quote \}\}/);
  assert.match(apiTemplate, /initialDelaySeconds: \{\{ \.Values\.api\.readinessProbe\.initialDelaySeconds \}\}/);
  assert.match(apiTemplate, /livenessProbe:/);
  assert.match(apiTemplate, /path: \{\{ \.Values\.api\.livenessProbe\.path \| quote \}\}/);
  assert.match(apiTemplate, /startupProbe:/);
  assert.match(apiTemplate, /path: \{\{ \.Values\.api\.startupProbe\.path \| quote \}\}/);

  assert.match(receiverTemplate, /readinessProbe:/);
  assert.match(receiverTemplate, /path: \{\{ \.Values\.receiver\.readinessProbe\.path \| quote \}\}/);
  assert.match(receiverTemplate, /livenessProbe:/);
  assert.match(receiverTemplate, /path: \{\{ \.Values\.receiver\.livenessProbe\.path \| quote \}\}/);
  assert.match(receiverTemplate, /startupProbe:/);
  assert.match(receiverTemplate, /path: \{\{ \.Values\.receiver\.startupProbe\.path \| quote \}\}/);
});
