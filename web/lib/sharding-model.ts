export type ShardingStrategy = "modulo" | "consistent-hash";

export type ShardingSimulationConfig = {
  keyCount: number;
  nodeCount: number;
  virtualNodesPerNode: number;
  strategy: ShardingStrategy;
  hotKeyWeight: number;
};

export type NodeLoad = {
  nodeId: string;
  keys: number;
  weightedRequests: number;
};

export type ShardingSimulationResult = {
  before: NodeLoad[];
  after: NodeLoad[];
  movedKeys: number;
  movedFraction: number;
  maxWeightedLoad: number;
  minWeightedLoad: number;
  imbalanceRatio: number;
  hotKeyNode: string;
};

type RingPoint = {
  hash: number;
  nodeId: string;
};

export function simulateSharding(config: ShardingSimulationConfig): ShardingSimulationResult {
  validateConfig(config);

  const keys = Array.from({ length: config.keyCount }, (_, index) => `key-${index}`);
  const beforeNodes = nodeIds(config.nodeCount);
  const afterNodes = nodeIds(config.nodeCount + 1);
  const beforeAssignments = assignKeys(keys, beforeNodes, config);
  const afterAssignments = assignKeys(keys, afterNodes, config);

  let movedKeys = 0;
  for (const key of keys) {
    if (beforeAssignments.get(key) !== afterAssignments.get(key)) {
      movedKeys += 1;
    }
  }

  const before = summarize(beforeNodes, keys, beforeAssignments, config.hotKeyWeight);
  const after = summarize(afterNodes, keys, afterAssignments, config.hotKeyWeight);
  const weightedLoads = after.map((node) => node.weightedRequests);
  const maxWeightedLoad = Math.max(...weightedLoads);
  const minWeightedLoad = Math.min(...weightedLoads);
  const meanWeightedLoad = weightedLoads.reduce((sum, value) => sum + value, 0) / weightedLoads.length;

  return {
    before,
    after,
    movedKeys,
    movedFraction: config.keyCount === 0 ? 0 : movedKeys / config.keyCount,
    maxWeightedLoad,
    minWeightedLoad,
    imbalanceRatio: meanWeightedLoad === 0 ? 1 : maxWeightedLoad / meanWeightedLoad,
    hotKeyNode: afterAssignments.get("key-0") ?? afterNodes[0],
  };
}

function assignKeys(
  keys: string[],
  nodes: string[],
  config: ShardingSimulationConfig,
): Map<string, string> {
  const assignments = new Map<string, string>();

  if (config.strategy === "modulo") {
    for (const key of keys) {
      const index = hashString(key) % nodes.length;
      assignments.set(key, nodes[index]);
    }
    return assignments;
  }

  const ring = buildRing(nodes, config.virtualNodesPerNode);
  for (const key of keys) {
    assignments.set(key, lookupRing(ring, hashString(key)));
  }
  return assignments;
}

function summarize(
  nodes: string[],
  keys: string[],
  assignments: Map<string, string>,
  hotKeyWeight: number,
): NodeLoad[] {
  const byNode = new Map<string, NodeLoad>(
    nodes.map((nodeId) => [nodeId, { nodeId, keys: 0, weightedRequests: 0 }]),
  );

  for (const key of keys) {
    const nodeId = assignments.get(key);
    if (nodeId === undefined) {
      continue;
    }
    const load = byNode.get(nodeId);
    if (load === undefined) {
      continue;
    }
    const weight = key === "key-0" ? hotKeyWeight : 1;
    load.keys += 1;
    load.weightedRequests += weight;
  }

  return nodes.map((nodeId) => byNode.get(nodeId) ?? { nodeId, keys: 0, weightedRequests: 0 });
}

function buildRing(nodes: string[], virtualNodesPerNode: number): RingPoint[] {
  const points: RingPoint[] = [];
  for (const nodeId of nodes) {
    for (let index = 0; index < virtualNodesPerNode; index += 1) {
      points.push({
        hash: hashString(`${nodeId}#${index}`),
        nodeId,
      });
    }
  }
  points.sort((left, right) => left.hash - right.hash || left.nodeId.localeCompare(right.nodeId));
  return points;
}

function lookupRing(ring: RingPoint[], keyHash: number): string {
  let low = 0;
  let high = ring.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ring[middle].hash < keyHash) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return ring[low % ring.length].nodeId;
}

function nodeIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `node-${index + 1}`);
}

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function validateConfig(config: ShardingSimulationConfig): void {
  if (!Number.isInteger(config.keyCount) || config.keyCount <= 0) {
    throw new Error("keyCount must be a positive integer");
  }
  if (!Number.isInteger(config.nodeCount) || config.nodeCount < 2) {
    throw new Error("nodeCount must be at least two");
  }
  if (!Number.isInteger(config.virtualNodesPerNode) || config.virtualNodesPerNode <= 0) {
    throw new Error("virtualNodesPerNode must be a positive integer");
  }
  if (!Number.isFinite(config.hotKeyWeight) || config.hotKeyWeight < 1) {
    throw new Error("hotKeyWeight must be at least one");
  }
}
