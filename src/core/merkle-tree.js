import { sha256Hex } from "./crypto.js";

export const MERKLE_PROOF_POSITION = Object.freeze({
  LEFT: "left",
  RIGHT: "right"
});

const MERKLE_PROOF_POSITIONS = new Set(Object.values(MERKLE_PROOF_POSITION));

function assertSha256Hex(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be a sha256 hex string`);
  return normalized;
}

function assertNonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
}

export function computeMerkleLeafHash(leafHash) {
  const normalizedLeafHash = assertSha256Hex(leafHash, "leafHash");
  return sha256Hex(`nooterra.merkle.leaf.v1:${normalizedLeafHash}`);
}

export function computeMerkleParentHash(leftHash, rightHash) {
  const left = assertSha256Hex(leftHash, "leftHash");
  const right = assertSha256Hex(rightHash, "rightHash");
  return sha256Hex(`nooterra.merkle.node.v1:${left}:${right}`);
}

function normalizeLeafHashArray(leafHashes) {
  if (!Array.isArray(leafHashes)) throw new TypeError("leafHashes must be an array");
  return leafHashes.map((leafHash, index) => computeMerkleLeafHash(assertSha256Hex(leafHash, `leafHashes[${index}]`)));
}

function buildNextLevel(currentLevel) {
  const nextLevel = [];
  for (let index = 0; index < currentLevel.length; index += 2) {
    const left = currentLevel[index];
    const right = index + 1 < currentLevel.length ? currentLevel[index + 1] : currentLevel[index];
    nextLevel.push(computeMerkleParentHash(left, right));
  }
  return nextLevel;
}

export function computeMerkleRoot({ leafHashes } = {}) {
  const leafLevel = normalizeLeafHashArray(leafHashes);
  if (!leafLevel.length) return null;
  let level = leafLevel;
  while (level.length > 1) {
    level = buildNextLevel(level);
  }
  return level[0];
}

export function buildMerkleProof({ leafHashes, index } = {}) {
  const leafLevel = normalizeLeafHashArray(leafHashes);
  if (!leafLevel.length) throw new TypeError("leafHashes must be a non-empty array");
  const leafIndex = assertNonNegativeSafeInteger(index, "index");
  if (leafIndex >= leafLevel.length) throw new TypeError("index is out of bounds");

  const siblings = [];
  let currentIndex = leafIndex;
  let level = leafLevel;
  while (level.length > 1) {
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    const siblingHash = siblingIndex < level.length ? level[siblingIndex] : level[currentIndex];
    siblings.push({
      position: currentIndex % 2 === 0 ? MERKLE_PROOF_POSITION.RIGHT : MERKLE_PROOF_POSITION.LEFT,
      hash: siblingHash
    });
    level = buildNextLevel(level);
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    treeSize: leafLevel.length,
    leafIndex,
    leafHash: leafLevel[leafIndex],
    rootHash: level[0],
    siblings
  };
}

function normalizeProofSiblings(siblings) {
  if (!Array.isArray(siblings)) throw new TypeError("siblings must be an array");
  return siblings.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError(`siblings[${index}] must be an object`);
    const position = typeof row.position === "string" ? row.position.trim().toLowerCase() : "";
    if (!MERKLE_PROOF_POSITIONS.has(position)) {
      throw new TypeError(`siblings[${index}].position must be left|right`);
    }
    return {
      position,
      hash: assertSha256Hex(row.hash, `siblings[${index}].hash`)
    };
  });
}

export function verifyMerkleProof({ leafHash, leafIndex, treeSize, siblings, rootHash } = {}) {
  const normalizedLeafHash = assertSha256Hex(leafHash, "leafHash");
  const normalizedLeafIndex = assertNonNegativeSafeInteger(leafIndex, "leafIndex");
  const normalizedTreeSize = assertNonNegativeSafeInteger(treeSize, "treeSize");
  if (normalizedTreeSize <= 0) throw new TypeError("treeSize must be >= 1");
  if (normalizedLeafIndex >= normalizedTreeSize) throw new TypeError("leafIndex must be < treeSize");
  const normalizedRootHash = assertSha256Hex(rootHash, "rootHash");
  const normalizedSiblings = normalizeProofSiblings(siblings);

  let cursorHash = computeMerkleLeafHash(normalizedLeafHash);
  for (const sibling of normalizedSiblings) {
    if (sibling.position === MERKLE_PROOF_POSITION.LEFT) {
      cursorHash = computeMerkleParentHash(sibling.hash, cursorHash);
    } else {
      cursorHash = computeMerkleParentHash(cursorHash, sibling.hash);
    }
  }

  return cursorHash === normalizedRootHash;
}
