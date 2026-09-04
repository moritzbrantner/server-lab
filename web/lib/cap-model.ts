export type PartitionStrategy = "quorum-consistency" | "local-availability";

export type CapSimulationConfig = {
  operationCount: number;
  operationsPerSecond: number;
  strategy: PartitionStrategy;
  localLatencyMs: number;
  quorumLatencyMs: number;
  asyncReplicationLagOperations: number;
  partitionStartOperation: number;
  partitionEndOperation: number;
};

export type CapOperation = {
  index: number;
  atMs: number;
  region: "A" | "B";
  type: "read" | "write";
  partitioned: boolean;
  success: boolean;
  latencyMs: number | null;
  observedVersion: number | null;
  newestVersion: number;
  stale: boolean;
  divergent: boolean;
};

export type CapSimulationResult = {
  operations: CapOperation[];
  successfulOperations: number;
  failedOperations: number;
  availability: number;
  successfulReads: number;
  staleReads: number;
  divergentWrites: number;
  reconciliationWrites: number;
  meanLatencyMs: number | null;
  p95LatencyMs: number | null;
  finalVersion: number;
};

type PendingReplication = {
  applyAtOperation: number;
  target: "A" | "B";
  version: number;
};

export function simulateCap(config: CapSimulationConfig): CapSimulationResult {
  validateConfig(config);

  let regionAVersion = 0;
  let regionBVersion = 0;
  let newestVersion = 0;
  const pending: PendingReplication[] = [];
  const operations: CapOperation[] = [];
  let staleReads = 0;
  let divergentWrites = 0;
  let reconciliationWrites = 0;
  let partitionWrites = 0;

  for (let index = 0; index < config.operationCount; index += 1) {
    const partitioned = index >= config.partitionStartOperation && index < config.partitionEndOperation;

    if (index === config.partitionEndOperation && config.strategy === "local-availability") {
      const reconciledVersion = Math.max(regionAVersion, regionBVersion, newestVersion);
      regionAVersion = reconciledVersion;
      regionBVersion = reconciledVersion;
      newestVersion = reconciledVersion;
      reconciliationWrites = partitionWrites;
    }

    applyPending(pending, index, partitioned, (target, version) => {
      if (target === "A") {
        regionAVersion = Math.max(regionAVersion, version);
      } else {
        regionBVersion = Math.max(regionBVersion, version);
      }
    });

    const region: "A" | "B" = index % 2 === 0 ? "A" : "B";
    const type: "read" | "write" = index % 3 === 0 ? "write" : "read";
    const atMs = (index * 1000) / config.operationsPerSecond;

    if (config.strategy === "quorum-consistency" && partitioned && region === "B") {
      operations.push({
        index,
        atMs,
        region,
        type,
        partitioned,
        success: false,
        latencyMs: null,
        observedVersion: null,
        newestVersion,
        stale: false,
        divergent: false,
      });
      continue;
    }

    if (type === "write") {
      newestVersion += 1;
      let divergent = false;

      if (config.strategy === "quorum-consistency") {
        if (partitioned) {
          regionAVersion = newestVersion;
        } else {
          regionAVersion = newestVersion;
          regionBVersion = newestVersion;
        }
      } else {
        if (region === "A") {
          regionAVersion = newestVersion;
        } else {
          regionBVersion = newestVersion;
        }

        if (partitioned) {
          divergent = true;
          divergentWrites += 1;
          partitionWrites += 1;
        } else {
          pending.push({
            applyAtOperation: index + config.asyncReplicationLagOperations,
            target: region === "A" ? "B" : "A",
            version: newestVersion,
          });
        }
      }

      operations.push({
        index,
        atMs,
        region,
        type,
        partitioned,
        success: true,
        latencyMs:
          config.strategy === "quorum-consistency" ? config.quorumLatencyMs : config.localLatencyMs,
        observedVersion: newestVersion,
        newestVersion,
        stale: false,
        divergent,
      });
      continue;
    }

    const observedVersion = region === "A" ? regionAVersion : regionBVersion;
    const stale = observedVersion < newestVersion;
    staleReads += stale ? 1 : 0;

    operations.push({
      index,
      atMs,
      region,
      type,
      partitioned,
      success: true,
      latencyMs:
        config.strategy === "quorum-consistency" ? config.quorumLatencyMs : config.localLatencyMs,
      observedVersion,
      newestVersion,
      stale,
      divergent: false,
    });
  }

  const successful = operations.filter((operation) => operation.success);
  const successfulReads = successful.filter((operation) => operation.type === "read").length;
  const latencies = successful
    .map((operation) => operation.latencyMs)
    .filter((value): value is number => value !== null);

  return {
    operations,
    successfulOperations: successful.length,
    failedOperations: operations.length - successful.length,
    availability: operations.length === 0 ? 1 : successful.length / operations.length,
    successfulReads,
    staleReads,
    divergentWrites,
    reconciliationWrites,
    meanLatencyMs: mean(latencies),
    p95LatencyMs: percentile(latencies, 0.95),
    finalVersion: newestVersion,
  };
}

function applyPending(
  pending: PendingReplication[],
  operationIndex: number,
  partitioned: boolean,
  apply: (target: "A" | "B", version: number) => void,
): void {
  if (partitioned) {
    return;
  }

  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const item = pending[index];
    if (item.applyAtOperation <= operationIndex) {
      apply(item.target, item.version);
      pending.splice(index, 1);
    }
  }
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(percentileValue * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function validateConfig(config: CapSimulationConfig): void {
  if (!Number.isInteger(config.operationCount) || config.operationCount < 0) {
    throw new Error("operationCount must be a non-negative integer");
  }
  if (!Number.isFinite(config.operationsPerSecond) || config.operationsPerSecond <= 0) {
    throw new Error("operationsPerSecond must be positive");
  }
  if (config.localLatencyMs < 0 || config.quorumLatencyMs < config.localLatencyMs) {
    throw new Error("latency values are invalid");
  }
  if (!Number.isInteger(config.asyncReplicationLagOperations) || config.asyncReplicationLagOperations < 0) {
    throw new Error("asyncReplicationLagOperations must be a non-negative integer");
  }
  if (
    !Number.isInteger(config.partitionStartOperation) ||
    !Number.isInteger(config.partitionEndOperation) ||
    config.partitionStartOperation < 0 ||
    config.partitionEndOperation < config.partitionStartOperation ||
    config.partitionEndOperation > config.operationCount
  ) {
    throw new Error("partition operation window is invalid");
  }
}
