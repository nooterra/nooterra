import {
  buildSessionMemoryContractHooksV1,
  verifySessionMemoryContractImportV1
} from "../services/memory/contract-hooks.js";

export function buildSessionMemoryExportResponseV1(args = {}) {
  const { memoryExport, memoryExportRef } = buildSessionMemoryContractHooksV1(args);
  return {
    ok: true,
    memoryExport,
    memoryExportRef
  };
}

export function verifySessionMemoryImportRequestV1(args = {}) {
  return verifySessionMemoryContractImportV1(args);
}
