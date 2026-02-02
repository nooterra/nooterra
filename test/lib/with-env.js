export async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars ?? {})) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars ?? {})) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
