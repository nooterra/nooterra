import test from "node:test";
import assert from "node:assert/strict";

import { createPgStore } from "../src/db/store-pg.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

(databaseUrl ? test : test.skip)("pg: listArtifacts filters by jobIds in one query path", async () => {
  const schema = `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });

  try {
    await store.putArtifact({
      tenantId: "tenant_default",
      artifact: { artifactId: "art_job_1", artifactHash: "hash_1", artifactType: "WorkCertificate.v1", jobId: "job_1" }
    });
    await store.putArtifact({
      tenantId: "tenant_default",
      artifact: { artifactId: "art_job_2", artifactHash: "hash_2", artifactType: "WorkCertificate.v1", jobId: "job_2" }
    });
    await store.putArtifact({
      tenantId: "tenant_default",
      artifact: { artifactId: "art_job_3", artifactHash: "hash_3", artifactType: "WorkCertificate.v1", jobId: "job_3" }
    });

    const filtered = await store.listArtifacts({
      tenantId: "tenant_default",
      jobIds: ["job_1", "job_3"],
      limit: 50,
      offset: 0
    });
    assert.deepEqual(
      filtered.map((item) => item.artifactId).sort(),
      ["art_job_1", "art_job_3"]
    );
  } finally {
    await store.close();
  }
});
