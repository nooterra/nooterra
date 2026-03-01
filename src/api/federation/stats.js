function normalizeNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toSortedCountObject(map) {
  if (!(map instanceof Map) || map.size === 0) return {};
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export function createFederationStatsTracker({ now = () => new Date().toISOString() } = {}) {
  const totals = {
    requestCount: 0,
    invokeCount: 0,
    resultCount: 0,
    statusCounts: new Map()
  };
  const pairs = new Map();

  function record({ endpoint, originDid, targetDid, status } = {}) {
    const endpointKey = normalizeNonEmptyString(endpoint);
    const originKey = normalizeNonEmptyString(originDid);
    const targetKey = normalizeNonEmptyString(targetDid);
    const statusKey = normalizeNonEmptyString(status);
    if (!endpointKey || !originKey || !targetKey || !statusKey) return;

    totals.requestCount += 1;
    if (endpointKey === "invoke") totals.invokeCount += 1;
    if (endpointKey === "result") totals.resultCount += 1;
    totals.statusCounts.set(statusKey, (totals.statusCounts.get(statusKey) ?? 0) + 1);

    const pairKey = `${originKey}\n${targetKey}`;
    let pair = pairs.get(pairKey);
    if (!pair) {
      pair = {
        originDid: originKey,
        targetDid: targetKey,
        requestCount: 0,
        invokeCount: 0,
        resultCount: 0,
        statusCounts: new Map()
      };
      pairs.set(pairKey, pair);
    }
    pair.requestCount += 1;
    if (endpointKey === "invoke") pair.invokeCount += 1;
    if (endpointKey === "result") pair.resultCount += 1;
    pair.statusCounts.set(statusKey, (pair.statusCounts.get(statusKey) ?? 0) + 1);
  }

  function snapshot() {
    const pairRows = [...pairs.values()]
      .sort((a, b) => {
        const originCmp = a.originDid.localeCompare(b.originDid);
        if (originCmp !== 0) return originCmp;
        return a.targetDid.localeCompare(b.targetDid);
      })
      .map((row) => ({
        originDid: row.originDid,
        targetDid: row.targetDid,
        requestCount: row.requestCount,
        invokeCount: row.invokeCount,
        resultCount: row.resultCount,
        statusCounts: toSortedCountObject(row.statusCounts)
      }));
    return {
      schemaVersion: "FederationStats.v1",
      generatedAt: now(),
      totals: {
        requestCount: totals.requestCount,
        invokeCount: totals.invokeCount,
        resultCount: totals.resultCount,
        statusCounts: toSortedCountObject(totals.statusCounts)
      },
      pairs: pairRows
    };
  }

  return Object.freeze({
    record,
    snapshot
  });
}
