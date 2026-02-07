import test from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/api/store.js";

test("memory store: listArtifacts filters by jobIds in one call", async () => {
  const store = createStore({ persistenceDir: null });

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

  const filtered = await store.listArtifacts({ tenantId: "tenant_default", jobIds: ["job_1", "job_3"] });
  assert.deepEqual(
    filtered.map((item) => item.artifactId),
    ["art_job_1", "art_job_3"]
  );
});
