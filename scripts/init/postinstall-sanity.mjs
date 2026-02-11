import { spawnSync } from "node:child_process";

function hasExecutable(cmd, args = ["--version"]) {
  const res = spawnSync(cmd, args, { stdio: "ignore" });
  if (res?.error?.code === "ENOENT") return false;
  if (typeof res?.status === "number" && res.status !== 0) return false;
  return true;
}

const hasDockerComposePlugin = hasExecutable("docker", ["compose", "version"]);
const hasLegacyCompose = hasExecutable("docker-compose", ["--version"]);

if (!hasDockerComposePlugin && !hasLegacyCompose) {
  // eslint-disable-next-line no-console
  console.warn(
    "[settld] warning: docker compose is not installed. `settld dev up` requires Docker to run the local stack."
  );
}
