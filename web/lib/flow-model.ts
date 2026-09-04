export type FlowSimulationConfig = {
  parentRequests: number;
  fanout: number;
  poolSize: number;
  normalServiceMs: number;
  slowServiceMs: number;
  slowEvery: number;
  handshakeMs: number;
  reuseConnections: boolean;
  parentArrivalIntervalMs: number;
};

export type ChildTask = {
  parentId: number;
  childId: number;
  connectionId: number;
  arrivalMs: number;
  startMs: number;
  serviceMs: number;
  handshakeMs: number;
  queueDelayMs: number;
  completionMs: number;
  slow: boolean;
};

export type ParentResult = {
  parentId: number;
  arrivalMs: number;
  completionMs: number;
  latencyMs: number;
};

export type FlowSimulationResult = {
  children: ChildTask[];
  parents: ParentResult[];
  meanParentLatencyMs: number | null;
  p95ParentLatencyMs: number | null;
  meanQueueDelayMs: number | null;
  p95QueueDelayMs: number | null;
  handshakes: number;
  slowChildren: number;
  totalChildren: number;
  maxQueueDelayMs: number;
};

type ConnectionRuntime = {
  id: number;
  availableAtMs: number;
  used: boolean;
};

export function simulateFlow(config: FlowSimulationConfig): FlowSimulationResult {
  validateConfig(config);

  const connections: ConnectionRuntime[] = Array.from({ length: config.poolSize }, (_, id) => ({
    id,
    availableAtMs: 0,
    used: false,
  }));
  const children: ChildTask[] = [];
  const parentCompletion = new Map<number, number>();
  let handshakes = 0;
  let slowChildren = 0;
  let globalChildOrdinal = 0;

  for (let parentId = 0; parentId < config.parentRequests; parentId += 1) {
    const arrivalMs = parentId * config.parentArrivalIntervalMs;

    for (let childId = 0; childId < config.fanout; childId += 1) {
      globalChildOrdinal += 1;
      const connection = earliestConnection(connections);
      const startMs = Math.max(arrivalMs, connection.availableAtMs);
      const slow = config.slowEvery > 0 && globalChildOrdinal % config.slowEvery === 0;
      const serviceMs = slow ? config.slowServiceMs : config.normalServiceMs;
      const handshakeMs =
        config.reuseConnections && connection.used ? 0 : config.handshakeMs;
      const completionMs = startMs + handshakeMs + serviceMs;
      const queueDelayMs = startMs - arrivalMs;

      if (handshakeMs > 0) {
        handshakes += 1;
      }
      slowChildren += slow ? 1 : 0;
      connection.availableAtMs = completionMs;
      connection.used = true;
      parentCompletion.set(
        parentId,
        Math.max(parentCompletion.get(parentId) ?? arrivalMs, completionMs),
      );

      children.push({
        parentId,
        childId,
        connectionId: connection.id,
        arrivalMs,
        startMs,
        serviceMs,
        handshakeMs,
        queueDelayMs,
        completionMs,
        slow,
      });
    }
  }

  const parents: ParentResult[] = Array.from({ length: config.parentRequests }, (_, parentId) => {
    const arrivalMs = parentId * config.parentArrivalIntervalMs;
    const completionMs = parentCompletion.get(parentId) ?? arrivalMs;
    return {
      parentId,
      arrivalMs,
      completionMs,
      latencyMs: completionMs - arrivalMs,
    };
  });
  const parentLatencies = parents.map((parent) => parent.latencyMs);
  const queueDelays = children.map((child) => child.queueDelayMs);

  return {
    children,
    parents,
    meanParentLatencyMs: mean(parentLatencies),
    p95ParentLatencyMs: percentile(parentLatencies, 0.95),
    meanQueueDelayMs: mean(queueDelays),
    p95QueueDelayMs: percentile(queueDelays, 0.95),
    handshakes,
    slowChildren,
    totalChildren: children.length,
    maxQueueDelayMs: queueDelays.length === 0 ? 0 : Math.max(...queueDelays),
  };
}

function earliestConnection(connections: ConnectionRuntime[]): ConnectionRuntime {
  return connections.reduce((best, current) => {
    if (current.availableAtMs < best.availableAtMs) {
      return current;
    }
    if (current.availableAtMs === best.availableAtMs && current.id < best.id) {
      return current;
    }
    return best;
  });
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

function validateConfig(config: FlowSimulationConfig): void {
  if (!Number.isInteger(config.parentRequests) || config.parentRequests < 0) {
    throw new Error("parentRequests must be a non-negative integer");
  }
  if (!Number.isInteger(config.fanout) || config.fanout <= 0) {
    throw new Error("fanout must be a positive integer");
  }
  if (!Number.isInteger(config.poolSize) || config.poolSize <= 0) {
    throw new Error("poolSize must be a positive integer");
  }
  if (config.normalServiceMs < 0 || config.slowServiceMs < config.normalServiceMs) {
    throw new Error("service times are invalid");
  }
  if (!Number.isInteger(config.slowEvery) || config.slowEvery < 0) {
    throw new Error("slowEvery must be a non-negative integer");
  }
  if (config.handshakeMs < 0 || config.parentArrivalIntervalMs < 0) {
    throw new Error("timing values must be non-negative");
  }
}
