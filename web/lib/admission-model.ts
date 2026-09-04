export type AdmissionPolicy = "none" | "token-bucket" | "concurrency-limit";

export type AdmissionSimulationConfig = {
  requestCount: number;
  baseRequestsPerSecond: number;
  burstMultiplier: number;
  serviceTimeMs: number;
  backendConcurrency: number;
  policy: AdmissionPolicy;
  tokenCapacity: number;
  tokenRefillPerSecond: number;
};

export type AdmissionRequest = {
  requestId: number;
  arrivalMs: number;
  admitted: boolean;
  reason: "admitted" | "rate-limited" | "concurrency-limited";
  inFlightBefore: number;
  tokensBefore: number | null;
};

export type AdmissionSimulationResult = {
  requests: AdmissionRequest[];
  offered: number;
  admitted: number;
  rejected: number;
  rejectionRate: number;
  peakInFlight: number;
  overCapacityAdmissions: number;
  nominalCapacityPerSecond: number;
  measuredOfferedRatePerSecond: number;
};

export function simulateAdmission(config: AdmissionSimulationConfig): AdmissionSimulationResult {
  validateConfig(config);

  const arrivals = buildArrivals(config);
  const activeCompletions: number[] = [];
  const requests: AdmissionRequest[] = [];
  let tokens = config.tokenCapacity;
  let previousArrival = arrivals[0] ?? 0;
  let peakInFlight = 0;
  let overCapacityAdmissions = 0;

  for (let requestId = 0; requestId < arrivals.length; requestId += 1) {
    const arrivalMs = arrivals[requestId];
    removeCompleted(activeCompletions, arrivalMs);

    if (config.policy === "token-bucket") {
      const elapsedSeconds = Math.max(0, arrivalMs - previousArrival) / 1000;
      tokens = Math.min(
        config.tokenCapacity,
        tokens + elapsedSeconds * config.tokenRefillPerSecond,
      );
    }
    previousArrival = arrivalMs;

    const inFlightBefore = activeCompletions.length;
    const tokensBefore = config.policy === "token-bucket" ? tokens : null;
    let admitted = true;
    let reason: AdmissionRequest["reason"] = "admitted";

    if (config.policy === "token-bucket" && tokens < 1) {
      admitted = false;
      reason = "rate-limited";
    } else if (
      config.policy === "concurrency-limit" &&
      inFlightBefore >= config.backendConcurrency
    ) {
      admitted = false;
      reason = "concurrency-limited";
    }

    if (admitted) {
      if (config.policy === "token-bucket") {
        tokens -= 1;
      }
      if (inFlightBefore >= config.backendConcurrency) {
        overCapacityAdmissions += 1;
      }
      activeCompletions.push(arrivalMs + config.serviceTimeMs);
      activeCompletions.sort((left, right) => left - right);
      peakInFlight = Math.max(peakInFlight, activeCompletions.length);
    }

    requests.push({
      requestId,
      arrivalMs,
      admitted,
      reason,
      inFlightBefore,
      tokensBefore,
    });
  }

  const admitted = requests.filter((request) => request.admitted).length;
  const rejected = requests.length - admitted;
  const spanMs = arrivals.length <= 1 ? 1000 : Math.max(1, arrivals[arrivals.length - 1] - arrivals[0]);

  return {
    requests,
    offered: requests.length,
    admitted,
    rejected,
    rejectionRate: requests.length === 0 ? 0 : rejected / requests.length,
    peakInFlight,
    overCapacityAdmissions,
    nominalCapacityPerSecond:
      config.serviceTimeMs === 0
        ? Number.POSITIVE_INFINITY
        : (config.backendConcurrency * 1000) / config.serviceTimeMs,
    measuredOfferedRatePerSecond:
      requests.length <= 1 ? requests.length : ((requests.length - 1) * 1000) / spanMs,
  };
}

function buildArrivals(config: AdmissionSimulationConfig): number[] {
  if (config.requestCount === 0) {
    return [];
  }

  const baseInterval = 1000 / config.baseRequestsPerSecond;
  const burstStart = Math.floor(config.requestCount * 0.35);
  const burstEnd = Math.floor(config.requestCount * 0.65);
  const arrivals = [0];

  for (let index = 1; index < config.requestCount; index += 1) {
    const inBurst = index >= burstStart && index < burstEnd;
    const interval = inBurst ? baseInterval / config.burstMultiplier : baseInterval;
    arrivals.push(arrivals[index - 1] + interval);
  }

  return arrivals;
}

function removeCompleted(completions: number[], atMs: number): void {
  while (completions.length > 0 && completions[0] <= atMs) {
    completions.shift();
  }
}

function validateConfig(config: AdmissionSimulationConfig): void {
  if (!Number.isInteger(config.requestCount) || config.requestCount < 0) {
    throw new Error("requestCount must be a non-negative integer");
  }
  if (!Number.isFinite(config.baseRequestsPerSecond) || config.baseRequestsPerSecond <= 0) {
    throw new Error("baseRequestsPerSecond must be positive");
  }
  if (!Number.isFinite(config.burstMultiplier) || config.burstMultiplier < 1) {
    throw new Error("burstMultiplier must be at least one");
  }
  if (!Number.isFinite(config.serviceTimeMs) || config.serviceTimeMs < 0) {
    throw new Error("serviceTimeMs must be non-negative");
  }
  if (!Number.isInteger(config.backendConcurrency) || config.backendConcurrency <= 0) {
    throw new Error("backendConcurrency must be a positive integer");
  }
  if (!Number.isFinite(config.tokenCapacity) || config.tokenCapacity < 0) {
    throw new Error("tokenCapacity must be non-negative");
  }
  if (!Number.isFinite(config.tokenRefillPerSecond) || config.tokenRefillPerSecond < 0) {
    throw new Error("tokenRefillPerSecond must be non-negative");
  }
}
