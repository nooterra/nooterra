/**
 * Validate ACARD JSON against the canonical schema and sample vectors.
 *
 * Usage:
 *   pnpm run validate:acard
 */
import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

async function loadJson(path) {
  const data = await readFile(path, "utf-8");
  return JSON.parse(data);
}

async function main() {
  const schemaPath = resolve(root, "docs/docs/protocol/nips/schemas/acard.schema.json");
  const vectorPath = resolve(root, "docs/docs/protocol/nips/vectors/acard.profile3.json");

  const schema = await loadJson(schemaPath);
  const vector = await loadJson(vectorPath);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(vector);

  if (!ok) {
    console.error("ACARD vector failed validation:");
    console.error(validate.errors);
    process.exit(1);
  }

  console.log("ACARD schema and vector validation: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
