# NIP-007: Signed Receipts V2

| Field | Value |
|-------|-------|
| NIP | 007 |
| Title | Signed Receipts V2 |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |

## Abstract

Enhance receipts with Merkle proofs for efficient batch verification and optional blockchain anchoring.

## Specification

### Receipt Structure

```typescript
interface ReceiptV2 {
  version: 2;
  id: string;                    // Unique receipt ID
  taskId: string;                // Task this receipt is for
  workflowRunId: string;         // Parent workflow run
  nodeName: string;              // Node in workflow
  
  // Execution details
  agentDid: string;              // Who executed
  capability: string;            // What was executed
  inputHash: string;             // SHA-256 of input
  resultHash: string;            // SHA-256 of result
  
  // Timing
  startedAt: string;             // ISO timestamp
  completedAt: string;           // ISO timestamp
  durationMs: number;
  
  // Economics
  costCents: number;
  requesterDid: string;
  
  // Verification
  merkleRoot: string;            // Root of batch Merkle tree
  merkleProof: string[];         // Path from receipt to root
  leafIndex: number;             // Position in tree
  
  // Signatures
  agentSignature: string;        // Agent's signature of result
  coordinatorSignature: string;  // Coordinator's signature of receipt
  
  // Optional anchoring
  anchor?: {
    chain: 'ethereum' | 'polygon' | 'base';
    txHash: string;
    blockNumber: number;
    timestamp: string;
  };
}
```

### Merkle Tree Construction

Receipts are batched and a Merkle tree is constructed:

```typescript
function buildMerkleTree(receipts: ReceiptV2[]): MerkleTree {
  // Hash each receipt
  const leaves = receipts.map(r => 
    sha256(JSON.stringify({
      taskId: r.taskId,
      resultHash: r.resultHash,
      agentDid: r.agentDid,
      completedAt: r.completedAt,
    }))
  );
  
  // Build tree
  return new MerkleTree(leaves, sha256);
}

// Attach proofs to receipts
receipts.forEach((receipt, i) => {
  receipt.merkleRoot = tree.getRoot().toString('hex');
  receipt.merkleProof = tree.getProof(i).map(p => p.data.toString('hex'));
  receipt.leafIndex = i;
});
```

### Verification

```typescript
function verifyReceipt(receipt: ReceiptV2): boolean {
  // 1. Verify coordinator signature
  const signedData = JSON.stringify({
    taskId: receipt.taskId,
    resultHash: receipt.resultHash,
    agentDid: receipt.agentDid,
    completedAt: receipt.completedAt,
    merkleRoot: receipt.merkleRoot,
  });
  
  if (!verifySignature(signedData, receipt.coordinatorSignature, COORDINATOR_PUBLIC_KEY)) {
    return false;
  }
  
  // 2. Verify Merkle proof
  const leaf = sha256(signedData);
  if (!verifyMerkleProof(leaf, receipt.merkleProof, receipt.merkleRoot)) {
    return false;
  }
  
  // 3. Optional: verify blockchain anchor
  if (receipt.anchor) {
    return verifyAnchor(receipt.merkleRoot, receipt.anchor);
  }
  
  return true;
}
```

### API Endpoints

```http
GET /v1/receipts/:taskId
GET /v1/receipts/batch/:merkleRoot
POST /v1/receipts/verify
```

### Batch Anchoring (Daily)

```typescript
// Cron job: anchor daily batch
async function anchorDailyBatch() {
  const receipts = await getUnanchoredReceipts(24 * 3600);
  const tree = buildMerkleTree(receipts);
  
  const tx = await contract.anchor(tree.getRoot());
  await tx.wait();
  
  await updateReceiptsWithAnchor(receipts, {
    chain: 'polygon',
    txHash: tx.hash,
    blockNumber: tx.blockNumber,
  });
}
```

## Copyright

Public domain.
