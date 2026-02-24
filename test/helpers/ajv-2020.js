import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export function createAjv2020(options = {}) {
  const ajv = new Ajv({ allErrors: true, strict: false, ...options });
  addFormats(ajv);
  return ajv;
}
