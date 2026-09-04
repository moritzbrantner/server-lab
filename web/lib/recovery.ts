export type HealthCheckMode = "active" | "passive";
export type CircuitState = "closed" | "open" | "half-open";

export type FailureWindow = {
  startMs: number;
  endMs: number;
};

export type RecoveryNodeConfig = {
  id: string;
  failureDomain: string;
  serviceTimeMs: number;
  networkLatencyMs: number;
  failures?: FailureWindow[];
};

export type RetryConfig = {
  maxRetries: number;
  baseBackoffMs: number;
  jitterMs: number;
};

export type CircuitBreakerConfig = {
  enabled: boolean;
  failureThreshold: number;
  openMs: number;
};

export type RecoverySimulationConfig = {
  requestCount: number;
  requestsPerSecond: number;
  seed: number;
  nodes: RecoveryNodeConfig[];
  healthCheckMode: HealthCheckMode;
  healthCheckIntervalMs: number;
  healthFailureThreshold: number;
  failoverDelayMs: number;
  attemptTimeoutMs: number;
  retry: RetryConfig;
  circuitBreaker: CircuitBreakerConfig;
};

export type RecoveryFailureReason =
  | "backend-failed"
  | "circuit-open"
  | "failover-in-progress"
  | "no-active-node";

export type RecoveryAttempt = {
  requestId: number;
  attemptIndex: number;
  startMs: number;
  endMs: number;
  nodeId: string | null;
  backendAttempt: boolean;
  success: boolean;
  failureReason: RecoveryFailureReason | null;
  circuitStateBefore: CircuitState | null;
  circuitStateAfter: CircuitState | null;
  retryDelayMs: number | null;
};

export type RecoveryRequestResult = {
  requestId: number;
  scheduledArrivalMs: number;
  success: boolean;
  completionMs: number;
  latencyMs: number;
  attempts: RecoveryAttempt[];
};

export type RecoveryEvent = {
  atMs: number;
  type:
    | "failure-detected"
    | "failover-started"
    | "failover-completed"
    | "circuit-opened"
    | "circuit-half-open"
    | "circuit-closed"
    | "retry-scheduled";
  nodeId: string | null;
  detail: string;
};

export type RecoverySimulationResult = {
  requests: RecoveryRequestResult[];
  events: RecoveryEvent[];
  successfulRequests: number;
  failedRequests: number;
  availability: number;
  totalAttempts: number;
  backendAttempts: number;
  retriedRequests: number;
  retryAmplification: number;
  shortCircuitedAttempts: number;
  circuitTrips: number;
  failoverCount: number;
  firstFailureDetectionMs: number | null;
  firstFailoverCompleteMs: number | null;
  recoveryWindowMs: number | null;
  meanLogicalLatencyMs: number | null;
  p95LogicalLatencyMs: number | null;
};

type PendingAttempt = {
  atMs: number;
  requestId: number;
  attemptIndex: number;
};

type MutableRequest = {
  requestId: number;
  scheduledArrivalMs: number;
  attempts: RecoveryAttempt[];
  completed: boolean;
  success: boolean;
  completionMs: number;
};

type BreakerRuntime = {
  state: CircuitState;
  consecutiveFailures: number;
  reopenAtMs: number | null;
};

type FailoverRuntime = {
  fromNodeId: string;
  detectedAtMs: number;
  completeAtMs: number;
  completed: boolean;
};

type RandomSource = () => number;

export function simulateRecovery(config: RecoverySimulationConfig): RecoverySimulationResult {
  validateRecoveryConfig(config);

  const random = mulberry32(config.seed);
  const intervalMs = 1000 / config.requestsPerSecond;
  const requests: MutableRequest[] = Array.from({ length: config.requestCount }, (_, requestId) => ({
    requestId,
    scheduledArrivalMs: requestId * intervalMs,
    attempts: [],
    completed: false,
    success: false,
    completionMs: requestId * intervalMs,
  }));
  const queue: PendingAttempt[] = requests.map((request) => ({
    atMs: request.scheduledArrivalMs,
    requestId: request.requestId,
    attemptIndex: 0,
  }));
  const events: RecoveryEvent[] = [];
  const breakerByNode = new Map<string, BreakerRuntime>(
    config.nodes.map((node) => [
      node.id,
      { state: "closed", consecutiveFailures: 0, reopenAtMs: null },
    ]),
  );
  const passiveFailures = new Map<string, number>(config.nodes.map((node) => [node.id, 0]));
  const markedUnhealthy = new Set<string>();

  let activeNodeId: string | null = config.nodes[0].id;
  let failover: FailoverRuntime | null = null;
  let firstFailureDetectionMs: number | null = null;
  let firstFailoverCompleteMs: number | null = null;
  let circuitTrips = 0;
  let failoverCount = 0;

  function emit(event: RecoveryEvent): void {
    events.push(event);
  }

  function markUnhealthy(nodeId: string, atMs: number): void {
    if (markedUnhealthy.has(nodeId)) {
      return;
    }

    markedUnhealthy.add(nodeId);
    firstFailureDetectionMs ??= atMs;
    emit({
      atMs,
      type: "failure-detected",
      nodeId,
      detail: `${config.healthCheckMode} health detection marked ${nodeId} unhealthy`,
    });

    if (activeNodeId === nodeId && failover === null) {
      failover = {
        fromNodeId: nodeId,
        detectedAtMs: atMs,
        completeAtMs: atMs + config.failoverDelayMs,
        completed: false,
      };
      emit({
        atMs,
        type: "failover-started",
        nodeId,
        detail: `failover scheduled after ${config.failoverDelayMs} ms`,
      });
    }
  }

  function processActiveDetection(atMs: number): void {
    if (config.healthCheckMode !== "active" || activeNodeId === null || markedUnhealthy.has(activeNodeId)) {
      return;
    }

    const node = getNode(config.nodes, activeNodeId);
    for (const failure of node.failures ?? []) {
      const detectionAt = activeDetectionAt(failure, config.healthCheckIntervalMs, config.healthFailureThreshold);
      if (detectionAt !== null && detectionAt <= atMs) {
        markUnhealthy(node.id, detectionAt);
        return;
      }
    }
  }

  function processFailover(atMs: number): void {
    if (failover === null || failover.completed || failover.completeAtMs > atMs) {
      return;
    }

    const target = config.nodes.find(
      (node) => node.id !== failover?.fromNodeId && !isPhysicallyFailed(node, failover?.completeAtMs ?? atMs),
    );

    activeNodeId = target?.id ?? null;
    failover.completed = true;
    failoverCount += 1;
    firstFailoverCompleteMs ??= failover.completeAtMs;

    emit({
      atMs: failover.completeAtMs,
      type: "failover-completed",
      nodeId: activeNodeId,
      detail: target === undefined ? "no healthy standby was available" : `${target.id} became active`,
    });
  }

  function advanceInfrastructure(atMs: number): void {
    processActiveDetection(atMs);
    processFailover(atMs);

    if (activeNodeId === null) {
      const recovered = config.nodes.find((node) => !isPhysicallyFailed(node, atMs));
      if (recovered !== undefined) {
        activeNodeId = recovered.id;
        failoverCount += 1;
        emit({
          atMs,
          type: "failover-completed",
          nodeId: recovered.id,
          detail: `${recovered.id} became active after capacity returned`,
        });
      }
    }
  }

  function advanceBreaker(nodeId: string, atMs: number): BreakerRuntime {
    const breaker = breakerByNode.get(nodeId);
    if (breaker === undefined) {
      throw new Error(`missing circuit breaker for ${nodeId}`);
    }

    if (
      config.circuitBreaker.enabled &&
      breaker.state === "open" &&
      breaker.reopenAtMs !== null &&
      atMs >= breaker.reopenAtMs
    ) {
      breaker.state = "half-open";
      breaker.reopenAtMs = null;
      emit({
        atMs,
        type: "circuit-half-open",
        nodeId,
        detail: "open interval elapsed; allow one probe",
      });
    }

    return breaker;
  }

  function recordBackendFailure(nodeId: string, atMs: number): void {
    if (config.healthCheckMode === "passive" && activeNodeId === nodeId && !markedUnhealthy.has(nodeId)) {
      const failures = (passiveFailures.get(nodeId) ?? 0) + 1;
      passiveFailures.set(nodeId, failures);
      if (failures >= config.healthFailureThreshold) {
        markUnhealthy(nodeId, atMs);
      }
    }

    if (!config.circuitBreaker.enabled) {
      return;
    }

    const breaker = breakerByNode.get(nodeId);
    if (breaker === undefined) {
      return;
    }

    breaker.consecutiveFailures += 1;
    if (breaker.state === "half-open" || breaker.consecutiveFailures >= config.circuitBreaker.failureThreshold) {
      breaker.state = "open";
      breaker.reopenAtMs = atMs + config.circuitBreaker.openMs;
      breaker.consecutiveFailures = 0;
      circuitTrips += 1;
      emit({
        atMs,
        type: "circuit-opened",
        nodeId,
        detail: `circuit open for ${config.circuitBreaker.openMs} ms`,
      });
    }
  }

  function recordBackendSuccess(nodeId: string, atMs: number): void {
    passiveFailures.set(nodeId, 0);

    const breaker = breakerByNode.get(nodeId);
    if (breaker === undefined) {
      return;
    }

    const wasHalfOpen = breaker.state === "half-open";
    breaker.state = "closed";
    breaker.consecutiveFailures = 0;
    breaker.reopenAtMs = null;

    if (wasHalfOpen) {
      emit({
        atMs,
        type: "circuit-closed",
        nodeId,
        detail: "half-open probe succeeded",
      });
    }
  }

  function scheduleRetry(request: MutableRequest, attemptIndex: number, endMs: number): number | null {
    if (attemptIndex >= config.retry.maxRetries) {
      request.completed = true;
      request.success = false;
      request.completionMs = endMs;
      return null;
    }

    const retryDelayMs = retryDelay(config.retry, attemptIndex, random);
    const retryAtMs = endMs + retryDelayMs;
    queue.push({
      atMs: retryAtMs,
      requestId: request.requestId,
      attemptIndex: attemptIndex + 1,
    });
    emit({
      atMs: endMs,
      type: "retry-scheduled",
      nodeId: activeNodeId,
      detail: `request ${request.requestId + 1} retry ${attemptIndex + 1} in ${retryDelayMs.toFixed(1)} ms`,
    });
    return retryDelayMs;
  }

  while (queue.length > 0) {
    queue.sort(compareAttempts);
    const pending = queue.shift();
    if (pending === undefined) {
      break;
    }

    const request = requests[pending.requestId];
    if (request.completed) {
      continue;
    }

    advanceInfrastructure(pending.atMs);
    const currentFailover = failover as FailoverRuntime | null;

    if (currentFailover !== null && !currentFailover.completed && pending.atMs >= currentFailover.detectedAtMs) {
      const retryDelayMs = scheduleRetry(request, pending.attemptIndex, pending.atMs);
      request.attempts.push({
        requestId: request.requestId,
        attemptIndex: pending.attemptIndex,
        startMs: pending.atMs,
        endMs: pending.atMs,
        nodeId: null,
        backendAttempt: false,
        success: false,
        failureReason: "failover-in-progress",
        circuitStateBefore: null,
        circuitStateAfter: null,
        retryDelayMs,
      });
      continue;
    }

    if (activeNodeId === null) {
      const retryDelayMs = scheduleRetry(request, pending.attemptIndex, pending.atMs);
      request.attempts.push({
        requestId: request.requestId,
        attemptIndex: pending.attemptIndex,
        startMs: pending.atMs,
        endMs: pending.atMs,
        nodeId: null,
        backendAttempt: false,
        success: false,
        failureReason: "no-active-node",
        circuitStateBefore: null,
        circuitStateAfter: null,
        retryDelayMs,
      });
      continue;
    }

    const node = getNode(config.nodes, activeNodeId);
    const breaker = advanceBreaker(node.id, pending.atMs);
    const circuitStateBefore = breaker.state;

    if (config.circuitBreaker.enabled && breaker.state === "open") {
      const retryDelayMs = scheduleRetry(request, pending.attemptIndex, pending.atMs);
      request.attempts.push({
        requestId: request.requestId,
        attemptIndex: pending.attemptIndex,
        startMs: pending.atMs,
        endMs: pending.atMs,
        nodeId: node.id,
        backendAttempt: false,
        success: false,
        failureReason: "circuit-open",
        circuitStateBefore,
        circuitStateAfter: breaker.state,
        retryDelayMs,
      });
      continue;
    }

    const failed = isPhysicallyFailed(node, pending.atMs);
    const durationMs = failed
      ? config.attemptTimeoutMs
      : node.networkLatencyMs * 2 + node.serviceTimeMs;
    const endMs = pending.atMs + durationMs;

    if (failed) {
      recordBackendFailure(node.id, endMs);
      const retryDelayMs = scheduleRetry(request, pending.attemptIndex, endMs);
      request.attempts.push({
        requestId: request.requestId,
        attemptIndex: pending.attemptIndex,
        startMs: pending.atMs,
        endMs,
        nodeId: node.id,
        backendAttempt: true,
        success: false,
        failureReason: "backend-failed",
        circuitStateBefore,
        circuitStateAfter: breakerByNode.get(node.id)?.state ?? circuitStateBefore,
        retryDelayMs,
      });
      continue;
    }

    recordBackendSuccess(node.id, endMs);
    request.attempts.push({
      requestId: request.requestId,
      attemptIndex: pending.attemptIndex,
      startMs: pending.atMs,
      endMs,
      nodeId: node.id,
      backendAttempt: true,
      success: true,
      failureReason: null,
      circuitStateBefore,
      circuitStateAfter: breakerByNode.get(node.id)?.state ?? circuitStateBefore,
      retryDelayMs: null,
    });
    request.completed = true;
    request.success = true;
    request.completionMs = endMs;
  }

  const results: RecoveryRequestResult[] = requests.map((request) => ({
    requestId: request.requestId,
    scheduledArrivalMs: request.scheduledArrivalMs,
    success: request.success,
    completionMs: request.completionMs,
    latencyMs: Math.max(0, request.completionMs - request.scheduledArrivalMs),
    attempts: request.attempts,
  }));

  const successfulRequests = results.filter((request) => request.success).length;
  const failedRequests = results.length - successfulRequests;
  const totalAttempts = results.reduce((sum, request) => sum + request.attempts.length, 0);
  const backendAttempts = results.reduce(
    (sum, request) => sum + request.attempts.filter((attempt) => attempt.backendAttempt).length,
    0,
  );
  const shortCircuitedAttempts = results.reduce(
    (sum, request) => sum + request.attempts.filter((attempt) => attempt.failureReason === "circuit-open").length,
    0,
  );
  const retriedRequests = results.filter((request) => request.attempts.length > 1).length;
  const successfulLatencies = results.filter((request) => request.success).map((request) => request.latencyMs);
  const firstFailureStartMs = earliestFailureStart(config.nodes);

  return {
    requests: results,
    events: [...events].sort((left, right) => left.atMs - right.atMs || left.type.localeCompare(right.type)),
    successfulRequests,
    failedRequests,
    availability: results.length === 0 ? 1 : successfulRequests / results.length,
    totalAttempts,
    backendAttempts,
    retriedRequests,
    retryAmplification: results.length === 0 ? 0 : backendAttempts / results.length,
    shortCircuitedAttempts,
    circuitTrips,
    failoverCount,
    firstFailureDetectionMs,
    firstFailoverCompleteMs,
    recoveryWindowMs:
      firstFailureStartMs === null || firstFailoverCompleteMs === null
        ? null
        : Math.max(0, firstFailoverCompleteMs - firstFailureStartMs),
    meanLogicalLatencyMs: mean(successfulLatencies),
    p95LogicalLatencyMs: percentile(successfulLatencies, 0.95),
  };
}

export type FailureDomainAvailability = {
  domainAvailability: number;
  nodeAvailability: number;
  replicas: number;
};

export function parallelAvailability(nodeAvailabilities: number[]): number {
  validateProbabilities(nodeAvailabilities);
  return 1 - nodeAvailabilities.reduce((failureProduct, availability) => failureProduct * (1 - availability), 1);
}

export function failureDomainAvailability(domains: FailureDomainAvailability[]): number {
  if (domains.length === 0) {
    return 0;
  }

  const domainServiceAvailabilities = domains.map((domain) => {
    validateProbability(domain.domainAvailability);
    validateProbability(domain.nodeAvailability);
    if (!Number.isInteger(domain.replicas) || domain.replicas <= 0) {
      throw new Error("failure-domain replica counts must be positive integers");
    }

    const anyNodeInsideDomain = 1 - (1 - domain.nodeAvailability) ** domain.replicas;
    return domain.domainAvailability * anyNodeInsideDomain;
  });

  return parallelAvailability(domainServiceAvailabilities);
}

export type ElectionNodeConfig = {
  id: string;
  failures?: FailureWindow[];
};

export type ElectionConfig = {
  nodes: ElectionNodeConfig[];
  initialLeaderId: string;
  initialTerm: number;
  heartbeatIntervalMs: number;
  electionTimeoutMs: number;
  electionDurationMs: number;
};

export type ElectionEvent = {
  atMs: number;
  type:
    | "leader-failed"
    | "election-timeout"
    | "term-started"
    | "vote-granted"
    | "leader-elected"
    | "leader-recovered"
    | "stale-leader-fenced";
  nodeId: string | null;
  term: number;
  detail: string;
};

export type ElectionResult = {
  events: ElectionEvent[];
  quorumSize: number;
  electionSucceeded: boolean;
  finalLeaderId: string | null;
  finalTerm: number;
  detectionAtMs: number | null;
  leaderElectedAtMs: number | null;
  leaderUnavailableMs: number | null;
  fencedStaleWrites: number;
};

export function simulateElection(config: ElectionConfig): ElectionResult {
  validateElectionConfig(config);

  const quorumSize = Math.floor(config.nodes.length / 2) + 1;
  const initialLeader = config.nodes.find((node) => node.id === config.initialLeaderId);
  if (initialLeader === undefined) {
    throw new Error("initial leader must exist in the node set");
  }

  const leaderFailure = initialLeader.failures?.[0];
  if (leaderFailure === undefined) {
    return {
      events: [],
      quorumSize,
      electionSucceeded: false,
      finalLeaderId: initialLeader.id,
      finalTerm: config.initialTerm,
      detectionAtMs: null,
      leaderElectedAtMs: null,
      leaderUnavailableMs: null,
      fencedStaleWrites: 0,
    };
  }

  const events: ElectionEvent[] = [
    {
      atMs: leaderFailure.startMs,
      type: "leader-failed",
      nodeId: initialLeader.id,
      term: config.initialTerm,
      detail: `${initialLeader.id} stopped sending heartbeats`,
    },
  ];

  const previousHeartbeatIndex = Math.max(
    0,
    Math.ceil(leaderFailure.startMs / config.heartbeatIntervalMs) - 1,
  );
  const lastHeartbeatMs = previousHeartbeatIndex * config.heartbeatIntervalMs;
  const detectionAtMs = lastHeartbeatMs + config.electionTimeoutMs;

  if (leaderFailure.endMs <= detectionAtMs) {
    events.push({
      atMs: leaderFailure.endMs,
      type: "leader-recovered",
      nodeId: initialLeader.id,
      term: config.initialTerm,
      detail: "leader recovered before the election timeout",
    });
    return {
      events,
      quorumSize,
      electionSucceeded: false,
      finalLeaderId: initialLeader.id,
      finalTerm: config.initialTerm,
      detectionAtMs,
      leaderElectedAtMs: null,
      leaderUnavailableMs: leaderFailure.endMs - leaderFailure.startMs,
      fencedStaleWrites: 0,
    };
  }

  const nextTerm = config.initialTerm + 1;
  events.push(
    {
      atMs: detectionAtMs,
      type: "election-timeout",
      nodeId: null,
      term: config.initialTerm,
      detail: `followers observed ${config.electionTimeoutMs} ms without a leader heartbeat`,
    },
    {
      atMs: detectionAtMs,
      type: "term-started",
      nodeId: null,
      term: nextTerm,
      detail: `term ${nextTerm} started`,
    },
  );

  const healthyAtElection = config.nodes
    .filter((node) => node.id !== initialLeader.id && !isElectionNodeFailed(node, detectionAtMs))
    .sort((left, right) => left.id.localeCompare(right.id));
  const candidate = healthyAtElection[0];

  for (const voter of healthyAtElection) {
    events.push({
      atMs: detectionAtMs,
      type: "vote-granted",
      nodeId: voter.id,
      term: nextTerm,
      detail: candidate === undefined ? "no candidate available" : `vote available for ${candidate.id}`,
    });
  }

  const leaderElectedAtMs = detectionAtMs + config.electionDurationMs;
  const healthyAtCompletion = config.nodes.filter((node) => !isElectionNodeFailed(node, leaderElectedAtMs));
  const electionSucceeded =
    candidate !== undefined &&
    !isElectionNodeFailed(candidate, leaderElectedAtMs) &&
    healthyAtCompletion.length >= quorumSize;

  let finalLeaderId: string | null = null;
  let finalTerm = nextTerm;
  let fencedStaleWrites = 0;

  if (electionSucceeded && candidate !== undefined) {
    finalLeaderId = candidate.id;
    events.push({
      atMs: leaderElectedAtMs,
      type: "leader-elected",
      nodeId: candidate.id,
      term: nextTerm,
      detail: `${candidate.id} became leader with fencing token ${nextTerm}`,
    });
  }

  events.push({
    atMs: leaderFailure.endMs,
    type: "leader-recovered",
    nodeId: initialLeader.id,
    term: config.initialTerm,
    detail: `${initialLeader.id} recovered holding stale term ${config.initialTerm}`,
  });

  if (electionSucceeded && finalLeaderId !== null && leaderFailure.endMs >= leaderElectedAtMs) {
    fencedStaleWrites = 1;
    events.push({
      atMs: leaderFailure.endMs + 1,
      type: "stale-leader-fenced",
      nodeId: initialLeader.id,
      term: config.initialTerm,
      detail: `write rejected because fencing token ${config.initialTerm} < current term ${nextTerm}`,
    });
  }

  return {
    events: events.sort((left, right) => left.atMs - right.atMs || left.type.localeCompare(right.type)),
    quorumSize,
    electionSucceeded,
    finalLeaderId,
    finalTerm,
    detectionAtMs,
    leaderElectedAtMs: electionSucceeded ? leaderElectedAtMs : null,
    leaderUnavailableMs: electionSucceeded
      ? leaderElectedAtMs - leaderFailure.startMs
      : leaderFailure.endMs - leaderFailure.startMs,
    fencedStaleWrites,
  };
}

function activeDetectionAt(
  failure: FailureWindow,
  healthCheckIntervalMs: number,
  failureThreshold: number,
): number | null {
  const firstCheckAt = Math.ceil(failure.startMs / healthCheckIntervalMs) * healthCheckIntervalMs;
  const detectionAt = firstCheckAt + (failureThreshold - 1) * healthCheckIntervalMs;
  return detectionAt < failure.endMs ? detectionAt : null;
}

function retryDelay(config: RetryConfig, attemptIndex: number, random: RandomSource): number {
  const exponential = config.baseBackoffMs * 2 ** attemptIndex;
  if (config.jitterMs === 0) {
    return exponential;
  }

  const jitter = (random() * 2 - 1) * config.jitterMs;
  return Math.max(0, exponential + jitter);
}

function compareAttempts(left: PendingAttempt, right: PendingAttempt): number {
  return left.atMs - right.atMs || left.requestId - right.requestId || left.attemptIndex - right.attemptIndex;
}

function isPhysicallyFailed(node: RecoveryNodeConfig, atMs: number): boolean {
  return (node.failures ?? []).some((failure) => atMs >= failure.startMs && atMs < failure.endMs);
}

function isElectionNodeFailed(node: ElectionNodeConfig, atMs: number): boolean {
  return (node.failures ?? []).some((failure) => atMs >= failure.startMs && atMs < failure.endMs);
}

function getNode(nodes: RecoveryNodeConfig[], nodeId: string): RecoveryNodeConfig {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new Error(`unknown recovery node: ${nodeId}`);
  }
  return node;
}

function earliestFailureStart(nodes: RecoveryNodeConfig[]): number | null {
  const starts = nodes.flatMap((node) => (node.failures ?? []).map((failure) => failure.startMs));
  return starts.length === 0 ? null : Math.min(...starts);
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

function validateRecoveryConfig(config: RecoverySimulationConfig): void {
  if (!Number.isInteger(config.requestCount) || config.requestCount < 0) {
    throw new Error("requestCount must be a non-negative integer");
  }
  if (!Number.isFinite(config.requestsPerSecond) || config.requestsPerSecond <= 0) {
    throw new Error("requestsPerSecond must be positive");
  }
  if (config.nodes.length < 2) {
    throw new Error("recovery simulation requires at least two nodes");
  }
  if (!Number.isFinite(config.healthCheckIntervalMs) || config.healthCheckIntervalMs <= 0) {
    throw new Error("healthCheckIntervalMs must be positive");
  }
  if (!Number.isInteger(config.healthFailureThreshold) || config.healthFailureThreshold <= 0) {
    throw new Error("healthFailureThreshold must be a positive integer");
  }
  if (!Number.isFinite(config.failoverDelayMs) || config.failoverDelayMs < 0) {
    throw new Error("failoverDelayMs must be non-negative");
  }
  if (!Number.isFinite(config.attemptTimeoutMs) || config.attemptTimeoutMs <= 0) {
    throw new Error("attemptTimeoutMs must be positive");
  }
  if (!Number.isInteger(config.retry.maxRetries) || config.retry.maxRetries < 0) {
    throw new Error("maxRetries must be a non-negative integer");
  }
  if (!Number.isFinite(config.retry.baseBackoffMs) || config.retry.baseBackoffMs < 0) {
    throw new Error("baseBackoffMs must be non-negative");
  }
  if (!Number.isFinite(config.retry.jitterMs) || config.retry.jitterMs < 0) {
    throw new Error("retry jitter must be non-negative");
  }
  if (!Number.isInteger(config.circuitBreaker.failureThreshold) || config.circuitBreaker.failureThreshold <= 0) {
    throw new Error("circuit breaker threshold must be a positive integer");
  }
  if (!Number.isFinite(config.circuitBreaker.openMs) || config.circuitBreaker.openMs < 0) {
    throw new Error("circuit breaker open duration must be non-negative");
  }

  const ids = new Set<string>();
  for (const node of config.nodes) {
    if (!node.id || ids.has(node.id)) {
      throw new Error("recovery node ids must be unique and non-empty");
    }
    ids.add(node.id);
    if (!node.failureDomain) {
      throw new Error(`failure domain must be non-empty for ${node.id}`);
    }
    if (node.serviceTimeMs < 0 || node.networkLatencyMs < 0) {
      throw new Error(`node latency values must be non-negative for ${node.id}`);
    }
    for (const failure of node.failures ?? []) {
      validateFailureWindow(failure);
    }
  }
}

function validateElectionConfig(config: ElectionConfig): void {
  if (config.nodes.length < 3) {
    throw new Error("election exhibit requires at least three nodes");
  }
  if (!Number.isInteger(config.initialTerm) || config.initialTerm <= 0) {
    throw new Error("initial term must be a positive integer");
  }
  if (config.heartbeatIntervalMs <= 0 || config.electionTimeoutMs <= 0 || config.electionDurationMs < 0) {
    throw new Error("election timing values are invalid");
  }
  const ids = new Set<string>();
  for (const node of config.nodes) {
    if (!node.id || ids.has(node.id)) {
      throw new Error("election node ids must be unique and non-empty");
    }
    ids.add(node.id);
    for (const failure of node.failures ?? []) {
      validateFailureWindow(failure);
    }
  }
}

function validateFailureWindow(failure: FailureWindow): void {
  if (!Number.isFinite(failure.startMs) || !Number.isFinite(failure.endMs) || failure.startMs < 0 || failure.endMs <= failure.startMs) {
    throw new Error("failure windows must have a non-negative start and a later end");
  }
}

function validateProbabilities(values: number[]): void {
  for (const value of values) {
    validateProbability(value);
  }
}

function validateProbability(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("availability values must be between zero and one");
  }
}