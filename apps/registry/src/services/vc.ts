import nacl from "tweetnacl";
import bs58 from "bs58";

export type Vc = Record<string, any>;

export function parseIssuerKeyMap(env: string | undefined): Record<string, Uint8Array> {
  if (!env) return {};
  return env
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce<Record<string, Uint8Array>>((acc, pair) => {
      const [did, key] = pair.split(":");
      if (did && key) {
        try {
          acc[did] = bs58.decode(key);
        } catch {
          /* ignore malformed */
        }
      }
      return acc;
    }, {});
}

function verifyEd25519(vc: Vc, issuerKeys: Record<string, Uint8Array>): boolean {
  const issuer = (vc?.issuer as string) || (vc as any)?.iss;
  if (!issuer || !issuerKeys[issuer]) return false;
  const proof = (vc as any)?.proof;
  const sigBase64 = proof?.signatureValue;
  if (!sigBase64) return false;
  let payload: Uint8Array;
  try {
    // Basic, deterministic payload: VC without proof
    const clone = { ...vc };
    delete (clone as any).proof;
    payload = Buffer.from(JSON.stringify(clone));
  } catch {
    return false;
  }
  let sig: Uint8Array;
  try {
    sig = Buffer.from(sigBase64, "base64");
  } catch {
    return false;
  }
  const pub = issuerKeys[issuer];
  return nacl.sign.detached.verify(new Uint8Array(payload), new Uint8Array(sig), pub);
}

export function filterAndVerifyVcs(
  vcs: Vc[],
  allowlist: string[],
  issuerKeys: Record<string, Uint8Array>
): Vc[] {
  const out: Vc[] = [];
  for (const vc of vcs) {
    const issuer = (vc?.issuer as string) || (vc as any)?.iss;
    if (allowlist.length && (!issuer || !allowlist.includes(issuer))) {
      continue;
    }
    if (issuer && issuerKeys[issuer]) {
      if (!verifyEd25519(vc, issuerKeys)) continue;
    }
    out.push(vc);
  }
  return out;
}
