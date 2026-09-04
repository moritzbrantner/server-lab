export type LoadBalancingPolicy = "round-robin" | "least-connections" | "random";

export type FailureWindow = {
  startMs: number;
  endMs: number;
};

export type ServerNodeConfig = {
  id: string;
  serviceTimeMs: number;
  networkLatencyMs: number;
  failures?: FailureWindow[];
};

export type SimulationConfig = {
  requestCount: number;
  requestsPerSecond: number;
  policy: LoadBalancingPolicy;
  seed: number;
  latencyJitterMs: number;
  nodes: ServerNodeConfig[];
};

export type RequestResult = {
  requestId: number;
  arrivalMs: number;
  nodeId: string | null;
  success: boolean;
  latencyMs: number | null;
  completionMs: number | null;
  failureReason?: "no-healthy-node";
};

export type NodeMetrics = {
  nodeId: string;
  routedRequests: number;
  peakInFlight: number;
};

export type SimulationResult = {
  requests: RequestResult[];
  nodeMetrics: NodeMetrics[];
  attemptedRequests: number;
  successfulRequests: number;
  failedRequests: number;
  availability: number;
  throughputPerSecond: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  modeledDurationMs: number;
};

type RuntimeNode = {
  config: ServerNodeConfig;
  completionTimes: number[];
  routedRequests: number;
  peakInFlight: number;
};

type RandomSource = () => number;

export function simulate(config: SimulationConfig): SimulationResult {
  validateConfig(config);

  const random = mulberry32(config.seed);
  const nodes: RuntimeNode[] = config.nodes.map((node) => ({
    config: node,
    completionTimes: [],
    routedRequests: 0,
    peakInFlight: 0,
  }));

  const requests: RequestResult[] = [];
  const intervalMs = 1000 / config.requestsPerSecond;
  let roundRobinCursor = 0;

  for (let requestId = 0; requestId < config.requestCount; requestId += 1) {
    const arrivalMs = requestId * intervalMs;

    for (const node of nodes) {
      node.completionTimes = node.completionTimes.filter((completionMs) => completionMs > arrivalMs);
    }

    const healthyNodes = nodes.filter((node) => isHealthy(node.config, arrivalMs));

    if (healthyNodes.length === 0) {
      requests.push({
        requestId,
        arrivalMs,
        nodeId: null,
        success: false,
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

    const outboundMs = jitteredLatency(node.config.networkLatencyMs, config.latencyJitterMs, random);
    const inboundMs = jitteredLatency(node.config.networkLatencyMs, config.latencyJitterMs, random);
    const latencyMs = outboundMs + node.config.serviceTimeMs + inboundMs;
    const completionMs = arrivalMs + latencyMs;

    node.completionTimes.push(completionMs);
    node.routedRequests += 1;
    node.peakInFlight = Math.max(node.peakInFlight, node.completionTimes.length);

    requests.push({
      requestId,
      arrivalMs,
      nodeId: node.config.id,
      success: true,
      latencyMs,
      completionMs,
    });
  }

  const successfulLatencies = requests
    .filter((request): request is RequestResult & { latencyMs: number; completionMs: number } => request.success)
    .map((request) => request.latencyMs);

  const successfulRequests = successfulLatencies.length;
  const failedRequests = requests.length - successfulRequests;
  const lastArrivalMs = requests.at(-1)?.arrivalMs ?? 0;
  const lastCompletionMs = requests.reduce(
    (maximum, request) => Math.max(maximum, request.completionMs ?? request.arrivalMs),
    0,
  );
  const modeledDurationMs = Math.max(lastArrivalMs, lastCompletionMs);
  const durationSeconds = modeledDurationMs > 0 ? modeledDurationMs / 1000 : 0;

  return {
    requests,
    nodeMetrics: nodes.map((node) => ({
      nodeId: node.config.id,
      routedRequests: node.routedRequests,
      peakInFlight: node.peakInFlight,
    })),
    attemptedRequests: requests.length,
    successfulRequests,
    failedRequests,
    availability: requests.length === 0 ? 1 : successfulRequests / requests.length,
    throughputPerSecond: durationSeconds === 0 ? successfulRequests : successfulRequests / durationSeconds,
    p50LatencyMs: percentile(successfulLatencies, 0.5),
    p95LatencyMs: percentile(successfulLatencies, 0.95),
    modeledDurationMs,
  };
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
      if (candidate.completionTimes.length < best.completionTimes.length) {
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

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(percentileValue * sorted.length);
  return sorted[Math.max(0, rank - 1)];
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
  if (config.nodes.length === 0) {
    throw new Error("at least one server node is required");
  }

  for (const node of config.nodes) {
    if (!node.id) {
      throw new Error("server node ids must be non-empty");
    }
    if (!Number.isFinite(node.serviceTimeMs) || node.serviceTimeMs < 0) {
      throw new Error(`serviceTimeMs must be non-negative for ${node.id}`);
    }
    if (!Number.isFinite(node.networkLatencyMs) || node.networkLatencyMs < 0) {
      throw new Error(`networkLatencyMs must be non-negative for ${node.id}`);
    }
    for (const failure of node.failures ?? []) {
      if (failure.startMs < 0 || failure.endMs <= failure.startMs) {
        throw new Error(`invalid failure window for ${node.id}`);
      }
    }
  }
}
