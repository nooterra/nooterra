import { NooterraClient } from "../../packages/api-sdk/src/index.js";

// Minimal smoke check: ensures the SDK can be imported and instantiated.
const client = new NooterraClient({ baseUrl: "http://127.0.0.1:0", tenantId: "tenant_default" });
if (
  !client ||
  typeof client.firstVerifiedRun !== "function" ||
  typeof client.getTenantAnalytics !== "function" ||
  typeof client.getTenantTrustGraph !== "function" ||
  typeof client.listTenantTrustGraphSnapshots !== "function" ||
  typeof client.createTenantTrustGraphSnapshot !== "function" ||
  typeof client.diffTenantTrustGraph !== "function"
) {
  process.exit(1);
}
process.stdout.write("ok\n");
