export type ReplicationMode = "asynchronous" | "quorum" | "synchronous";
export type ReadConsistency = "eventual" | "leader" | "read-your-writes" | "quorum";
export type ReplicationOperationKind = "write" | "read";

export type ReplicationPartition = {
  replicaId: string;
  startMs: number;
  endMs: number;
};

export type ReplicationOperationInput = {
  kind: ReplicationOperationKind;
  scheduledAtMs: number;
};

export type ReplicationConfig = {
  replicaCount: number;
  replicationMode: ReplicationMode;
  readConsistency: ReadConsistency;
  replicationDelayMs: number;
  replicationJitterMs: number;
  writeTimeoutMs: number;
  readTimeoutMs: number;
  operationCount: number;
  operationIntervalMs: number;
  writeEvery: number;
  seed: number;
  partition?: ReplicationPartition;
  operations?: ReplicationOperationInput[];
};

export type ObservedReplicaVersion = {
  nodeId: string;
  version: number;
};

export type ReplicationOperationResult = {
  operationId: number;
  kind: ReplicationOperationKind;
  scheduledAtMs: number;
  startedAtMs: number;
  completedAtMs: number;
  success: boolean;
  version: number | null;
  targetNodeIds: string[];
  observedVersions: ObservedReplicaVersion[];
  waitMs: number;
  stale: boolean;
  sessionRequiredVersion: number;
  partitionedReplicaIds: string[];
  fallbackToLeader: boolean;
  failureReason?: "write-timeout";
};

export type ReplicaMetrics = {
  nodeId: string;
  role: "leader" | "replica";
  appliedVersion: number;
  lagVersions: number;
  maxLagVersions: number;
  pendingUpdates: number;
};

export type ReplicationResult = {
  operations: ReplicationOperationResult[];
  replicaMetrics: ReplicaMetrics[];
  successfulWrites: number;
  failedWrites: number;
  successfulReads: number;
  staleReads: number;
  staleReadRate: number;
  readYourWritesViolations: number;
  leaderFallbackReads: number;
  meanWriteAckLatencyMs: number | null;
  meanReadWaitMs: number | null;
  finalCommittedVersion: number;
  maxReplicaLagVersions: number;
  quorumSize: number;
  modeledDurationMs: number;
};

type PendingReplication = {
  version: number;
  applyAtMs: number;
};

type RuntimeReplica = {
  id: string;
  role: "leader" | "replica";
  appliedVersion: number;
  maxLagVersions: number;
  pending: PendingReplication[];
};

type RandomSource = () => number;

export function simulateReplication(config: ReplicationConfig): ReplicationResult {
  validateConfig(config);

  const random = mulberry32(config.seed);
  const replicas = createReplicas(config.replicaCount);
  const followers = replicas.filter((replica) => replica.role === "replica");
  const operations = config.operations ?? generateOperations(config);
  const quorumSize = Math.floor(config.replicaCount / 2) + 1;

  let leaderVersion = 0;
  let lastAcknowledgedWriteVersion = 0;
  let clientAvailableAtMs = 0;
  let eventualReadCursor = 0;
  let quorumReadCursor = followers.length > 0 ? 1 : 0;

  const results: ReplicationOperationResult[] = [];

  operations.forEach((operation, operationId) => {
    const startedAtMs = Math.max(operation.scheduledAtMs, clientAvailableAtMs);
    applyPendingReplications(followers, startedAtMs);
    recordLag(followers, leaderVersion);

    if (operation.kind === "write") {
      const writeResult = simulateWrite({
        config,
        followers,
        leaderVersion,
        operationId,
        scheduledAtMs: operation.scheduledAtMs,
        startedAtMs,
        quorumSize,
        random,
      });

      results.push(writeResult.operation);
      clientAvailableAtMs = writeResult.operation.completedAtMs;

      if (writeResult.operation.success && writeResult.operation.version !== null) {
        leaderVersion = writeResult.operation.version;
        replicas[0].appliedVersion = leaderVersion;
        lastAcknowledgedWriteVersion = leaderVersion;
        for (const delivery of writeResult.deliveries) {
          const follower = followers.find((replica) => replica.id === delivery.nodeId);
          if (follower) {
            follower.pending.push({ version: leaderVersion, applyAtMs: delivery.applyAtMs });
            follower.pending.sort((left, right) => left.applyAtMs - right.applyAtMs || left.version - right.version);
          }
        }
        applyPendingReplications(followers, clientAvailableAtMs);
        recordLag(followers, leaderVersion);
      }

      return;
    }

    const readResult = simulateRead({
      config,
      replicas,
      followers,
      leaderVersion,
      lastAcknowledgedWriteVersion,
      operationId,
      scheduledAtMs: operation.scheduledAtMs,
      startedAtMs,
      eventualReadCursor,
      quorumReadCursor,
      quorumSize,
    });

    results.push(readResult.operation);
    eventualReadCursor = readResult.eventualReadCursor;
    quorumReadCursor = readResult.quorumReadCursor;
    clientAvailableAtMs = readResult.operation.completedAtMs;
    applyPendingReplications(followers, clientAvailableAtMs);
    recordLag(followers, leaderVersion);
  });

  const modeledDurationMs = Math.max(clientAvailableAtMs, operations.at(-1)?.scheduledAtMs ?? 0);
  applyPendingReplications(followers, modeledDurationMs);
  recordLag(followers, leaderVersion);

  const successfulWrites = results.filter((operation) => operation.kind === "write" && operation.success);
  const failedWrites = results.filter((operation) => operation.kind === "write" && !operation.success);
  const reads = results.filter((operation) => operation.kind === "read" && operation.success);
  const staleReads = reads.filter((operation) => operation.stale);
  const readYourWritesViolations = reads.filter(
    (operation) => operation.version !== null && operation.version < operation.sessionRequiredVersion,
  ).length;
  const leaderFallbackReads = reads.filter((operation) => operation.fallbackToLeader).length;

  return {
    operations: results,
    replicaMetrics: replicas.map((replica) => ({
      nodeId: replica.id,
      role: replica.role,
      appliedVersion: replica.role === "leader" ? leaderVersion : replica.appliedVersion,
      lagVersions: replica.role === "leader" ? 0 : leaderVersion - replica.appliedVersion,
      maxLagVersions: replica.maxLagVersions,
      pendingUpdates: replica.pending.length,
    })),
    successfulWrites: successfulWrites.length,
    failedWrites: failedWrites.length,
    successfulReads: reads.length,
    staleReads: staleReads.length,
    staleReadRate: reads.length === 0 ? 0 : staleReads.length / reads.length,
    readYourWritesViolations,
    leaderFallbackReads,
    meanWriteAckLatencyMs: mean(
      successfulWrites.map((operation) => operation.completedAtMs - operation.startedAtMs),
    ),
    meanReadWaitMs: mean(reads.map((operation) => operation.waitMs)),
    finalCommittedVersion: leaderVersion,
    maxReplicaLagVersions: Math.max(0, ...followers.map((replica) => replica.maxLagVersions)),
    quorumSize,
    modeledDurationMs,
  };
}

function simulateWrite({
  config,
  followers,
  leaderVersion,
  operationId,
  scheduledAtMs,
  startedAtMs,
  quorumSize,
  random,
}: {
  config: ReplicationConfig;
  followers: RuntimeReplica[];
  leaderVersion: number;
  operationId: number;
  scheduledAtMs: number;
  startedAtMs: number;
  quorumSize: number;
  random: RandomSource;
}): {
  operation: ReplicationOperationResult;
  deliveries: Array<{ nodeId: string; applyAtMs: number }>;
} {
  const nextVersion = leaderVersion + 1;
  const deliveries = followers.map((follower) => ({
    nodeId: follower.id,
    applyAtMs: replicationApplyTime(config, follower.id, startedAtMs, random),
  }));

  let acknowledgedAtMs = startedAtMs;
  if (config.replicationMode === "quorum") {
    const followerAcknowledgementsNeeded = Math.max(0, quorumSize - 1);
    const ordered = deliveries.map((delivery) => delivery.applyAtMs).sort((left, right) => left - right);
    acknowledgedAtMs = followerAcknowledgementsNeeded === 0 ? startedAtMs : ordered[followerAcknowledgementsNeeded - 1];
  } else if (config.replicationMode === "synchronous") {
    acknowledgedAtMs = Math.max(startedAtMs, ...deliveries.map((delivery) => delivery.applyAtMs));
  }

  const deadlineMs = startedAtMs + config.writeTimeoutMs;
  const success = acknowledgedAtMs <= deadlineMs;
  const completedAtMs = success ? acknowledgedAtMs : deadlineMs;

  return {
    operation: {
      operationId,
      kind: "write",
      scheduledAtMs,
      startedAtMs,
      completedAtMs,
      success,
      version: success ? nextVersion : null,
      targetNodeIds: ["leader", ...deliveries.map((delivery) => delivery.nodeId)],
      observedVersions: [],
      waitMs: completedAtMs - startedAtMs,
      stale: false,
      sessionRequiredVersion: leaderVersion,
      partitionedReplicaIds: partitionedReplicaIds(config, startedAtMs),
      fallbackToLeader: false,
      failureReason: success ? undefined : "write-timeout",
    },
    deliveries: success ? deliveries : [],
  };
}

function simulateRead({
  config,
  replicas,
  followers,
  leaderVersion,
  lastAcknowledgedWriteVersion,
  operationId,
  scheduledAtMs,
  startedAtMs,
  eventualReadCursor,
  quorumReadCursor,
  quorumSize,
}: {
  config: ReplicationConfig;
  replicas: RuntimeReplica[];
  followers: RuntimeReplica[];
  leaderVersion: number;
  lastAcknowledgedWriteVersion: number;
  operationId: number;
  scheduledAtMs: number;
  startedAtMs: number;
  eventualReadCursor: number;
  quorumReadCursor: number;
  quorumSize: number;
}): {
  operation: ReplicationOperationResult;
  eventualReadCursor: number;
  quorumReadCursor: number;
} {
  if (config.readConsistency === "leader" || followers.length === 0) {
    const operation = readOperation({
      operationId,
      scheduledAtMs,
      startedAtMs,
      completedAtMs: startedAtMs,
      version: leaderVersion,
      targetNodeIds: ["leader"],
      observedVersions: [{ nodeId: "leader", version: leaderVersion }],
      leaderVersion,
      lastAcknowledgedWriteVersion,
      config,
      fallbackToLeader: false,
    });
    return { operation, eventualReadCursor, quorumReadCursor };
  }

  if (config.readConsistency === "quorum") {
    const selected = selectCircular(replicas, quorumReadCursor, quorumSize);
    const observedVersions = selected.items.map((replica) => ({
      nodeId: replica.id,
      version: replica.role === "leader" ? leaderVersion : replica.appliedVersion,
    }));
    const version = Math.max(...observedVersions.map((observation) => observation.version));
    const operation = readOperation({
      operationId,
      scheduledAtMs,
      startedAtMs,
      completedAtMs: startedAtMs,
      version,
      targetNodeIds: observedVersions.map((observation) => observation.nodeId),
      observedVersions,
      leaderVersion,
      lastAcknowledgedWriteVersion,
      config,
      fallbackToLeader: false,
    });
    return {
      operation,
      eventualReadCursor,
      quorumReadCursor: selected.nextCursor,
    };
  }

  const selectedFollower = followers[eventualReadCursor % followers.length];
  const nextEventualReadCursor = (eventualReadCursor + 1) % followers.length;

  if (config.readConsistency === "eventual") {
    const operation = readOperation({
      operationId,
      scheduledAtMs,
      startedAtMs,
      completedAtMs: startedAtMs,
      version: selectedFollower.appliedVersion,
      targetNodeIds: [selectedFollower.id],
      observedVersions: [{ nodeId: selectedFollower.id, version: selectedFollower.appliedVersion }],
      leaderVersion,
      lastAcknowledgedWriteVersion,
      config,
      fallbackToLeader: false,
    });
    return { operation, eventualReadCursor: nextEventualReadCursor, quorumReadCursor };
  }

  const requiredVersion = lastAcknowledgedWriteVersion;
  if (selectedFollower.appliedVersion >= requiredVersion) {
    const operation = readOperation({
      operationId,
      scheduledAtMs,
      startedAtMs,
      completedAtMs: startedAtMs,
      version: selectedFollower.appliedVersion,
      targetNodeIds: [selectedFollower.id],
      observedVersions: [{ nodeId: selectedFollower.id, version: selectedFollower.appliedVersion }],
      leaderVersion,
      lastAcknowledgedWriteVersion,
      config,
      fallbackToLeader: false,
    });
    return { operation, eventualReadCursor: nextEventualReadCursor, quorumReadCursor };
  }

  const catchUpAtMs = earliestVersionTime(selectedFollower, requiredVersion);
  const deadlineMs = startedAtMs + config.readTimeoutMs;
  if (catchUpAtMs !== null && catchUpAtMs <= deadlineMs) {
    applyPendingReplications([selectedFollower], catchUpAtMs);
    const operation = readOperation({
      operationId,
      scheduledAtMs,
      startedAtMs,
      completedAtMs: catchUpAtMs,
      version: selectedFollower.appliedVersion,
      targetNodeIds: [selectedFollower.id],
      observedVersions: [{ nodeId: selectedFollower.id, version: selectedFollower.appliedVersion }],
      leaderVersion,
      lastAcknowledgedWriteVersion,
      config,
      fallbackToLeader: false,
    });
    return { operation, eventualReadCursor: nextEventualReadCursor, quorumReadCursor };
  }

  const operation = readOperation({
    operationId,
    scheduledAtMs,
    startedAtMs,
    completedAtMs: startedAtMs,
    version: leaderVersion,
    targetNodeIds: [selectedFollower.id, "leader"],
    observedVersions: [
      { nodeId: selectedFollower.id, version: selectedFollower.appliedVersion },
      { nodeId: "leader", version: leaderVersion },
    ],
    leaderVersion,
    lastAcknowledgedWriteVersion,
    config,
    fallbackToLeader: true,
  });
  return { operation, eventualReadCursor: nextEventualReadCursor, quorumReadCursor };
}

function readOperation({
  operationId,
  scheduledAtMs,
  startedAtMs,
  completedAtMs,
  version,
  targetNodeIds,
  observedVersions,
  leaderVersion,
  lastAcknowledgedWriteVersion,
  config,
  fallbackToLeader,
}: {
  operationId: number;
  scheduledAtMs: number;
  startedAtMs: number;
  completedAtMs: number;
  version: number;
  targetNodeIds: string[];
  observedVersions: ObservedReplicaVersion[];
  leaderVersion: number;
  lastAcknowledgedWriteVersion: number;
  config: ReplicationConfig;
  fallbackToLeader: boolean;
}): ReplicationOperationResult {
  return {
    operationId,
    kind: "read",
    scheduledAtMs,
    startedAtMs,
    completedAtMs,
    success: true,
    version,
    targetNodeIds,
    observedVersions,
    waitMs: completedAtMs - startedAtMs,
    stale: version < leaderVersion,
    sessionRequiredVersion: lastAcknowledgedWriteVersion,
    partitionedReplicaIds: partitionedReplicaIds(config, startedAtMs),
    fallbackToLeader,
  };
}

function createReplicas(replicaCount: number): RuntimeReplica[] {
  return Array.from({ length: replicaCount }, (_, index) => ({
    id: index === 0 ? "leader" : `replica-${index}`,
    role: index === 0 ? "leader" : "replica",
    appliedVersion: 0,
    maxLagVersions: 0,
    pending: [],
  }));
}

function generateOperations(config: ReplicationConfig): ReplicationOperationInput[] {
  return Array.from({ length: config.operationCount }, (_, index) => ({
    kind: index % config.writeEvery === 0 ? "write" : "read",
    scheduledAtMs: index * config.operationIntervalMs,
  }));
}

function replicationApplyTime(
  config: ReplicationConfig,
  replicaId: string,
  writeAtMs: number,
  random: RandomSource,
): number {
  const jitter = config.replicationJitterMs === 0 ? 0 : (random() * 2 - 1) * config.replicationJitterMs;
  const delayMs = Math.max(0, config.replicationDelayMs + jitter);
  const partition = config.partition;

  if (partition?.replicaId === replicaId && writeAtMs >= partition.startMs && writeAtMs < partition.endMs) {
    return partition.endMs + delayMs;
  }

  return writeAtMs + delayMs;
}

function applyPendingReplications(replicas: RuntimeReplica[], atMs: number): void {
  for (const replica of replicas) {
    const ready = replica.pending.filter((delivery) => delivery.applyAtMs <= atMs);
    if (ready.length > 0) {
      replica.appliedVersion = Math.max(replica.appliedVersion, ...ready.map((delivery) => delivery.version));
      replica.pending = replica.pending.filter((delivery) => delivery.applyAtMs > atMs);
    }
  }
}

function recordLag(replicas: RuntimeReplica[], leaderVersion: number): void {
  for (const replica of replicas) {
    replica.maxLagVersions = Math.max(replica.maxLagVersions, leaderVersion - replica.appliedVersion);
  }
}

function earliestVersionTime(replica: RuntimeReplica, version: number): number | null {
  const event = replica.pending.find((delivery) => delivery.version >= version);
  return event?.applyAtMs ?? null;
}

function partitionedReplicaIds(config: ReplicationConfig, atMs: number): string[] {
  if (!config.partition) {
    return [];
  }
  return atMs >= config.partition.startMs && atMs < config.partition.endMs
    ? [config.partition.replicaId]
    : [];
}

function selectCircular<T>(items: T[], cursor: number, count: number): { items: T[]; nextCursor: number } {
  const selected = Array.from({ length: Math.min(count, items.length) }, (_, offset) => items[(cursor + offset) % items.length]);
  return {
    items: selected,
    nextCursor: items.length === 0 ? 0 : (cursor + 1) % items.length,
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function validateConfig(config: ReplicationConfig): void {
  if (!Number.isInteger(config.replicaCount) || config.replicaCount < 2) {
    throw new Error("replicaCount must be an integer of at least two");
  }
  if (!Number.isFinite(config.replicationDelayMs) || config.replicationDelayMs < 0) {
    throw new Error("replicationDelayMs must be non-negative");
  }
  if (!Number.isFinite(config.replicationJitterMs) || config.replicationJitterMs < 0) {
    throw new Error("replicationJitterMs must be non-negative");
  }
  if (!Number.isFinite(config.writeTimeoutMs) || config.writeTimeoutMs < 0) {
    throw new Error("writeTimeoutMs must be non-negative");
  }
  if (!Number.isFinite(config.readTimeoutMs) || config.readTimeoutMs < 0) {
    throw new Error("readTimeoutMs must be non-negative");
  }
  if (!Number.isInteger(config.operationCount) || config.operationCount < 0) {
    throw new Error("operationCount must be a non-negative integer");
  }
  if (!Number.isFinite(config.operationIntervalMs) || config.operationIntervalMs < 0) {
    throw new Error("operationIntervalMs must be non-negative");
  }
  if (!Number.isInteger(config.writeEvery) || config.writeEvery < 1) {
    throw new Error("writeEvery must be a positive integer");
  }
  if (config.partition) {
    if (config.partition.replicaId === "leader") {
      throw new Error("slice 3 partitions only follower replication links");
    }
    if (config.partition.startMs < 0 || config.partition.endMs <= config.partition.startMs) {
      throw new Error("partition window must have a non-negative start and later end");
    }
    const validReplicaIds = new Set(Array.from({ length: config.replicaCount - 1 }, (_, index) => `replica-${index + 1}`));
    if (!validReplicaIds.has(config.partition.replicaId)) {
      throw new Error("partition replicaId must reference an existing follower");
    }
  }
  if (config.operations) {
    for (const operation of config.operations) {
      if (!Number.isFinite(operation.scheduledAtMs) || operation.scheduledAtMs < 0) {
        throw new Error("operation scheduledAtMs must be non-negative");
      }
    }
  }
}
