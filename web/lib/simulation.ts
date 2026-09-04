export type LoadBalancingPolicy = "round-robin" | "least-connections" | "random";
export type OverloadPolicy = "queue" | "reject" | "shed-load";

export type FailureWindow = {
  startMs: number;
  endMs: number;
};

export type BurstConfig = {
  startRequest: number;
  requestCount: number;
  multiplier: number;
};

export type ServerNodeConfig = {
  id: string;
  serviceTimeMs: number;
  networkLatencyMs: number;
  maxConcurrentRequests: number;
  queueCapacity: number;
  failures?: FailureWindow[];
};

export type SimulationConfig = {
  requestCount: number;
  requestsPerSecond: number;
  policy: LoadBalancingPolicy;
  overloadPolicy: OverloadPolicy;
  maxQueueWaitMs: number;
  backpressureLimit: number;
  burst?: BurstConfig;
  seed: number;
  latencyJitterMs: number;
  nodes: ServerNodeConfig[];
};

export type FailureReason = "no-healthy-node" | "over-capacity" | "queue-full" | "shed-load";

export type RequestResult = {
  requestId: number;
  scheduledArrivalMs: number;
  arrivalMs: number;
  backpressureDelayMs: number;
  nodeId: string | null;
  success: boolean;
  queueDelayMs: number | null;
  serviceStartMs: number | null;
  latencyMs: number | null;
  completionMs: number | null;
  failureReason?: FailureReason;
};

export type NodeMetrics = {
  nodeId: string;
  routedRequests: number;
  successfulRequests: number;
  rejectedRequests: number;
  peakInFlight: number;
  peakQueueDepth: number;
};

export type SimulationResult = {
  requests: RequestResult[];
  nodeMetrics: NodeMetrics[];
  attemptedRequests: number;
  successfulRequests: number;
  failedRequests: number;
  overloadDroppedRequests: number;
  shedRequests: number;
  queuedRequests: number;
  availability: number;
  measuredArrivalRatePerSecond: number;
  throughputPerSecond: number;
  nominalServiceCapacityPerSecond: number;
  meanLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  meanQueueDelayMs: number | null;
  p95QueueDelayMs: number | null;
  meanBackpressureDelayMs: number;
  averageInSystem: number;
  littleLawEstimate: number;
  modeledDurationMs: number;
};

type ScheduledWork = {
  serviceStartMs: number;
  serviceEndMs: number;
};

type RuntimeNode = {
  config: ServerNodeConfig;
  scheduled: ScheduledWork[];
  workerAvailableMs: number[];
  routedRequests: number;
  successfulRequests: number;
  rejectedRequests: number;
  peakInFlight: number;
  peakQueueDepth: number;
};

type RandomSource = () => number;

export function simulate(config: SimulationConfig): SimulationResult {
  validateConfig(config);

  const random = mulberry32(config.seed);
  const nodes: RuntimeNode[] = config.nodes.map((node) => ({
    config: node,
    scheduled: [],
    workerAvailableMs: Array.from({ length: node.maxConcurrentRequests }, () => 0),
    routedRequests: 0,
    successfulRequests: 0,
    rejectedRequests: 0,
    peakInFlight: 0,
    peakQueueDepth: 0,
  }));

  const requests: RequestResult[] = [];
  let systemCompletionTimes: number[] = [];
  let scheduledArrivalMs = 0;
  let previousArrivalMs = 0;
  let roundRobinCursor = 0;

  for (let requestId = 0; requestId < config.requestCount; requestId += 1) {
    if (requestId > 0) {
      scheduledArrivalMs += requestIntervalMs(config, requestId);
    }

    const arrivalMs = applyBackpressure({
      scheduledArrivalMs,
      previousArrivalMs,
      completionTimes: systemCompletionTimes,
      limit: config.backpressureLimit,
    });
    previousArrivalMs = arrivalMs;
    systemCompletionTimes = systemCompletionTimes.filter((completionMs) => completionMs > arrivalMs);
    pruneNodes(nodes, arrivalMs);

    const backpressureDelayMs = arrivalMs - scheduledArrivalMs;
    const healthyNodes = nodes.filter((node) => isHealthy(node.config, arrivalMs));

    if (healthyNodes.length === 0) {
      requests.push({
        requestId,
        scheduledArrivalMs,
        arrivalMs,
        backpressureDelayMs,
        nodeId: null,
        success: false,
        queueDelayMs: null,
        serviceStartMs: null,
        latencyMs: null,
        completionMs: null,
        failureReason: "no-healthy-node",
      });
      continue;
    }

    const selection = chooseNode({
      policy: config.policy,
      nodes,
      healthyNodes,
      roundRobinCursor,
      random,
    });
    const node = selection.node;
    roundRobinCursor = selection.roundRobinCursor;
    node.routedRequests += 1;

    const outboundMs = jitteredLatency(node.config.networkLatencyMs, config.latencyJitterMs, random);
    const inboundMs = jitteredLatency(node.config.networkLatencyMs, config.latencyJitterMs, random);
    const serverArrivalMs = arrivalMs + outboundMs;
    pruneNode(node, serverArrivalMs);

    const workerIndex = earliestWorkerIndex(node.workerAvailableMs);
    const serviceStartMs = Math.max(serverArrivalMs, node.workerAvailableMs[workerIndex]);
    const queueDelayMs = serviceStartMs - serverArrivalMs;
    const queueDepth = node.scheduled.filter((work) => work.serviceStartMs > serverArrivalMs).length;
    const failureReason = admissionFailureReason({
      overloadPolicy: config.overloadPolicy,
      queueDelayMs,
      queueDepth,
      queueCapacity: node.config.queueCapacity,
      maxQueueWaitMs: config.maxQueueWaitMs,
    });

    if (failureReason !== null) {
      node.rejectedRequests += 1;
      requests.push({
        requestId,
        scheduledArrivalMs,
        arrivalMs,
        backpressureDelayMs,
        nodeId: node.config.id,
        success: false,
        queueDelayMs: null,
        serviceStartMs: null,
        latencyMs: null,
        completionMs: null,
        failureReason,
      });
      continue;
    }

    const serviceEndMs = serviceStartMs + node.config.serviceTimeMs;
    const completionMs = serviceEndMs + inboundMs;
    const latencyMs = completionMs - arrivalMs;

    node.workerAvailableMs[workerIndex] = serviceEndMs;
    node.scheduled.push({ serviceStartMs, serviceEndMs });
    node.successfulRequests += 1;
    node.peakInFlight = Math.max(node.peakInFlight, node.scheduled.length);
    node.peakQueueDepth = Math.max(
      node.peakQueueDepth,
      node.scheduled.filter((work) => work.serviceStartMs > serverArrivalMs).length,
    );
    systemCompletionTimes.push(completionMs);

    requests.push({
      requestId,
      scheduledArrivalMs,
      arrivalMs,
      backpressureDelayMs,
      nodeId: node.config.id,
      success: true,
      queueDelayMs,
      serviceStartMs,
      latencyMs,
      completionMs,
    });
  }

  const successful = requests.filter(
    (request): request is RequestResult & {
      latencyMs: number;
      queueDelayMs: number;
      completionMs: number;
    } => request.success,
  );
  const successfulLatencies = successful.map((request) => request.latencyMs);
  const queueDelays = successful.map((request) => request.queueDelayMs);
  const successfulRequests = successful.length;
  const failedRequests = requests.length - successfulRequests;
  const overloadDroppedRequests = requests.filter(
    (request) =>
      request.failureReason === "over-capacity" ||
      request.failureReason === "queue-full" ||
      request.failureReason === "shed-load",
  ).length;
  const shedRequests = requests.filter((request) => request.failureReason === "shed-load").length;
  const queuedRequests = successful.filter((request) => request.queueDelayMs > 0).length;
  const lastArrivalMs = requests.at(-1)?.arrivalMs ?? 0;
  const lastCompletionMs = requests.reduce(
    (maximum, request) => Math.max(maximum, request.completionMs ?? request.arrivalMs),
    0,
  );
  const modeledDurationMs = Math.max(lastArrivalMs, lastCompletionMs);
  const durationSeconds = modeledDurationMs > 0 ? modeledDurationMs / 1000 : 0;
  const meanLatencyMs = mean(successfulLatencies);
  const throughputPerSecond = durationSeconds === 0 ? successfulRequests : successfulRequests / durationSeconds;
  const averageInSystem = modeledDurationMs === 0 ? 0 : sum(successfulLatencies) / modeledDurationMs;
  const littleLawEstimate = meanLatencyMs === null ? 0 : throughputPerSecond * (meanLatencyMs / 1000);

  return {
    requests,
    nodeMetrics: nodes.map((node) => ({
      nodeId: node.config.id,
      routedRequests: node.routedRequests,
      successfulRequests: node.successfulRequests,
      rejectedRequests: node.rejectedRequests,
      peakInFlight: node.peakInFlight,
      peakQueueDepth: node.peakQueueDepth,
    })),
    attemptedRequests: requests.length,
    successfulRequests,
    failedRequests,
    overloadDroppedRequests,
    shedRequests,
    queuedRequests,
    availability: requests.length === 0 ? 1 : successfulRequests / requests.length,
    measuredArrivalRatePerSecond: measuredArrivalRate(requests),
    throughputPerSecond,
    nominalServiceCapacityPerSecond: config.nodes.reduce(
      (capacity, node) => capacity + (node.maxConcurrentRequests * 1000) / node.serviceTimeMs,
      0,
    ),
    meanLatencyMs,
    p50LatencyMs: percentile(successfulLatencies, 0.5),
    p95LatencyMs: percentile(successfulLatencies, 0.95),
    meanQueueDelayMs: mean(queueDelays),
    p95QueueDelayMs: percentile(queueDelays, 0.95),
    meanBackpressureDelayMs: requests.length === 0 ? 0 : sum(requests.map((request) => request.backpressureDelayMs)) / requests.length,
    averageInSystem,
    littleLawEstimate,
    modeledDurationMs,
  };
}

function requestIntervalMs(config: SimulationConfig, requestId: number): number {
  const baseIntervalMs = 1000 / config.requestsPerSecond;
  const burst = config.burst;
  if (
    burst !== undefined &&
    requestId >= burst.startRequest &&
    requestId < burst.startRequest + burst.requestCount
  ) {
    return baseIntervalMs / burst.multiplier;
  }
  return baseIntervalMs;
}

function applyBackpressure({
  scheduledArrivalMs,
  previousArrivalMs,
  completionTimes,
  limit,
}: {
  scheduledArrivalMs: number;
  previousArrivalMs: number;
  completionTimes: number[];
  limit: number;
}): number {
  let candidateMs = Math.max(scheduledArrivalMs, previousArrivalMs);
  if (limit === 0) {
    return candidateMs;
  }

  while (completionTimes.filter((completionMs) => completionMs > candidateMs).length >= limit) {
    const nextCompletionMs = completionTimes
      .filter((completionMs) => completionMs > candidateMs)
      .reduce((earliest, completionMs) => Math.min(earliest, completionMs), Number.POSITIVE_INFINITY);

    if (!Number.isFinite(nextCompletionMs)) {
      break;
    }
    candidateMs = nextCompletionMs;
  }

  return candidateMs;
}

function admissionFailureReason({
  overloadPolicy,
  queueDelayMs,
  queueDepth,
  queueCapacity,
  maxQueueWaitMs,
}: {
  overloadPolicy: OverloadPolicy;
  queueDelayMs: number;
  queueDepth: number;
  queueCapacity: number;
  maxQueueWaitMs: number;
}): FailureReason | null {
  if (queueDelayMs === 0) {
    return null;
  }

  if (overloadPolicy === "reject") {
    return "over-capacity";
  }

  if (overloadPolicy === "shed-load") {
    if (queueDepth >= queueCapacity || queueDelayMs > maxQueueWaitMs) {
      return "shed-load";
    }
    return null;
  }

  return queueDepth >= queueCapacity ? "queue-full" : null;
}

function chooseNode({
  policy,
  nodes,
  healthyNodes,
  roundRobinCursor,
  random,
}: {
  policy: LoadBalancingPolicy;
  nodes: RuntimeNode[];
  healthyNodes: RuntimeNode[];
  roundRobinCursor: number;
  random: RandomSource;
}): { node: RuntimeNode; roundRobinCursor: number } {
  if (policy === "least-connections") {
    const node = healthyNodes.reduce((best, candidate) => {
      if (candidate.scheduled.length < best.scheduled.length) {
        return candidate;
      }
      return best;
    });
    return { node, roundRobinCursor };
  }

  if (policy === "random") {
    const index = Math.floor(random() * healthyNodes.length);
    return { node: healthyNodes[index], roundRobinCursor };
  }

  for (let offset = 0; offset < nodes.length; offset += 1) {
    const index = (roundRobinCursor + offset) % nodes.length;
    const candidate = nodes[index];
    if (healthyNodes.includes(candidate)) {
      return {
        node: candidate,
        roundRobinCursor: (index + 1) % nodes.length,
      };
    }
  }

  throw new Error("round-robin selection requires at least one healthy node");
}

function pruneNodes(nodes: RuntimeNode[], atMs: number): void {
  for (const node of nodes) {
    pruneNode(node, atMs);
  }
}

function pruneNode(node: RuntimeNode, atMs: number): void {
  node.scheduled = node.scheduled.filter((work) => work.serviceEndMs > atMs);
}

function earliestWorkerIndex(workerAvailableMs: number[]): number {
  let earliestIndex = 0;
  for (let index = 1; index < workerAvailableMs.length; index += 1) {
    if (workerAvailableMs[index] < workerAvailableMs[earliestIndex]) {
      earliestIndex = index;
    }
  }
  return earliestIndex;
}

function isHealthy(node: ServerNodeConfig, atMs: number): boolean {
  return !(node.failures ?? []).some((failure) => atMs >= failure.startMs && atMs < failure.endMs);
}

function jitteredLatency(baseMs: number, jitterMs: number, random: RandomSource): number {
  if (jitterMs === 0) {
    return baseMs;
  }

  const delta = (random() * 2 - 1) * jitterMs;
  return Math.max(0, baseMs + delta);
}

function measuredArrivalRate(requests: RequestResult[]): number {
  if (requests.length < 2) {
    return requests.length;
  }

  const spanMs = requests[requests.length - 1].arrivalMs - requests[0].arrivalMs;
  return spanMs <= 0 ? requests.length : ((requests.length - 1) * 1000) / spanMs;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(percentileValue * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : sum(values) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
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

function validateConfig(config: SimulationConfig): void {
  if (!Number.isInteger(config.requestCount) || config.requestCount < 0) {
    throw new Error("requestCount must be a non-negative integer");
  }
  if (!Number.isFinite(config.requestsPerSecond) || config.requestsPerSecond <= 0) {
    throw new Error("requestsPerSecond must be greater than zero");
  }
  if (!Number.isFinite(config.latencyJitterMs) || config.latencyJitterMs < 0) {
    throw new Error("latencyJitterMs must be non-negative");
  }
  if (!Number.isFinite(config.maxQueueWaitMs) || config.maxQueueWaitMs < 0) {
    throw new Error("maxQueueWaitMs must be non-negative");
  }
  if (!Number.isInteger(config.backpressureLimit) || config.backpressureLimit < 0) {
    throw new Error("backpressureLimit must be a non-negative integer");
  }
  if (config.nodes.length === 0) {
    throw new Error("at least one server node is required");
  }

  if (config.burst !== undefined) {
    if (!Number.isInteger(config.burst.startRequest) || config.burst.startRequest < 0) {
      throw new Error("burst.startRequest must be a non-negative integer");
    }
    if (!Number.isInteger(config.burst.requestCount) || config.burst.requestCount < 0) {
      throw new Error("burst.requestCount must be a non-negative integer");
    }
    if (!Number.isFinite(config.burst.multiplier) || config.burst.multiplier < 1) {
      throw new Error("burst.multiplier must be at least one");
    }
  }

  const nodeIds = new Set<string>();
  for (const node of config.nodes) {
    if (!node.id) {
      throw new Error("server node ids must be non-empty");
    }
    if (nodeIds.has(node.id)) {
      throw new Error(`server node ids must be unique: ${node.id}`);
    }
    nodeIds.add(node.id);

    if (!Number.isFinite(node.serviceTimeMs) || node.serviceTimeMs <= 0) {
      throw new Error(`serviceTimeMs must be greater than zero for ${node.id}`);
    }
    if (!Number.isFinite(node.networkLatencyMs) || node.networkLatencyMs < 0) {
      throw new Error(`networkLatencyMs must be non-negative for ${node.id}`);
    }
    if (!Number.isInteger(node.maxConcurrentRequests) || node.maxConcurrentRequests <= 0) {
      throw new Error(`maxConcurrentRequests must be a positive integer for ${node.id}`);
    }
    if (!Number.isInteger(node.queueCapacity) || node.queueCapacity < 0) {
      throw new Error(`queueCapacity must be a non-negative integer for ${node.id}`);
    }
    for (const failure of node.failures ?? []) {
      if (failure.startMs < 0 || failure.endMs <= failure.startMs) {
        throw new Error(`invalid failure window for ${node.id}`);
      }
    }
  }
}
