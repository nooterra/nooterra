import fsSync from "node:fs";

function writeStdout(s) {
  fsSync.writeFileSync(1, s);
}

function writeStderr(s) {
  fsSync.writeFileSync(2, s);
}

async function readStdinUtf8() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdinUtf8();
  let req;
  try {
    req = JSON.parse(raw || "null");
  } catch (e) {
    writeStderr(`invalid JSON: ${e?.message ?? String(e)}\n`);
    process.exit(2);
  }

  const url = typeof req?.url === "string" ? req.url : null;
  const op = typeof req?.op === "string" ? req.op : null;
  if (!url || !op) {
    writeStderr("missing url/op\n");
    process.exit(2);
  }

  try {
    if (op === "publicKey") {
      const keyId = typeof req?.keyId === "string" ? req.keyId : null;
      if (!keyId) throw new Error("missing keyId");
      const res = await fetch(`${url.replace(/\\/$/, "")}/v1/public-key?keyId=${encodeURIComponent(keyId)}`, { method: "GET" });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`remote signer publicKey failed (HTTP ${res.status})`);
        err.detail = text;
        throw err;
      }
      writeStdout(text);
      return;
    }
    if (op === "sign") {
      const body = req?.body ?? null;
      const res = await fetch(`${url.replace(/\\/$/, "")}/v1/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {})
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`remote signer sign failed (HTTP ${res.status})`);
        err.detail = text;
        throw err;
      }
      writeStdout(text);
      return;
    }
    throw new Error(`unknown op: ${op}`);
  } catch (e) {
    writeStderr(`remote signer error: ${e?.message ?? String(e)}\n`);
    process.exit(1);
  }
}

await main();

