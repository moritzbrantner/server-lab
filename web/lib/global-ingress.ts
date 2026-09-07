export type GlobalRegionId = "eu-central" | "us-east" | "ap-southeast";
export type ClientSiteId = "frankfurt" | "virginia" | "singapore";
export type IngressRoutingPolicy = "round-robin" | "geography" | "latency";
export type TrafficProfile = "balanced" | "europe-heavy" | "asia-heavy";

export interface GlobalRegionDefinition {
  id: GlobalRegionId;
  label: string;
  location: string;
}

export interface ClientSiteDefinition {
  id: ClientSiteId;
  label: string;
  homeRegion: GlobalRegionId;
  baseRttMs: Record<GlobalRegionId, number>;
}

export interface GlobalIngressConfig {
  requestCount: number;
  routingPolicy: IngressRoutingPolicy;
  trafficProfile: TrafficProfile;
  healthyRegions: Record<GlobalRegionId, boolean>;
  addedLatencyMs: Record<GlobalRegionId, number>;
}

export interface GlobalIngressRequest {
  index: number;
  clientSite: ClientSiteId;
  homeRegion: GlobalRegionId;
  selectedRegion: GlobalRegionId | null;
  baseRttMs: number | null;
  addedLatencyMs: number | null;
  totalRttMs: number | null;
  crossRegion: boolean;
  healthFailover: boolean;
}

export interface GlobalRegionSummary {
  regionId: GlobalRegionId;
  healthy: boolean;
  addedLatencyMs: number;
  routedRequests: number;
  meanRttMs: number | null;
}

export interface GlobalIngressResult {
  hostname: "multiplayer.example.com";
  requests: GlobalIngressRequest[];
  regions: GlobalRegionSummary[];
  successfulRequests: number;
  failedRequests: number;
  crossRegionRequests: number;
  healthFailovers: number;
  meanRttMs: number | null;
  p95RttMs: number | null;
}

export const GLOBAL_REGIONS: readonly GlobalRegionDefinition[] = [
  { id: "eu-central", label: "Europe", location: "Frankfurt" },
  { id: "us-east", label: "US East", location: "Virginia" },
  { id: "ap-southeast", label: "Asia Pacific", location: "Singapore" },
] as const;

export const CLIENT_SITES: readonly ClientSiteDefinition[] = [
  {
    id: "frankfurt",
    label: "Frankfurt player",
    homeRegion: "eu-central",
    baseRttMs: { "eu-central": 18, "us-east": 92, "ap-southeast": 170 },
  },
  {
    id: "virginia",
    label: "Virginia player",
    homeRegion: "us-east",
    baseRttMs: { "eu-central": 92, "us-east": 22, "ap-southeast": 205 },
  },
  {
    id: "singapore",
    label: "Singapore player",
    homeRegion: "ap-southeast",
    baseRttMs: { "eu-central": 165, "us-east": 205, "ap-southeast": 24 },
  },
] as const;

const TRAFFIC_PATTERNS: Record<TrafficProfile, readonly ClientSiteId[]> = {
  balanced: ["frankfurt", "virginia", "singapore"],
  "europe-heavy": ["frankfurt", "frankfurt", "frankfurt", "frankfurt", "virginia", "singapore"],
  "asia-heavy": ["singapore", "singapore", "singapore", "singapore", "virginia", "frankfurt"],
};

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function clientSite(id: ClientSiteId): ClientSiteDefinition {
  const site = CLIENT_SITES.find((candidate) => candidate.id === id);
  if (!site) {
    throw new Error(`unknown client site: ${id}`);
  }
  return site;
}

function healthyRegionIds(config: GlobalIngressConfig): GlobalRegionId[] {
  return GLOBAL_REGIONS.map((region) => region.id).filter((regionId) => config.healthyRegions[regionId]);
}

function lowestLatencyRegion(
  site: ClientSiteDefinition,
  candidates: readonly GlobalRegionId[],
  addedLatencyMs: Record<GlobalRegionId, number>,
): GlobalRegionId {
  let selected = candidates[0];
  if (!selected) {
    throw new Error("lowestLatencyRegion requires at least one candidate");
  }

  let bestRtt = site.baseRttMs[selected] + clampInteger(addedLatencyMs[selected], 0, 1000);
  for (const candidate of candidates.slice(1)) {
    const candidateRtt = site.baseRttMs[candidate] + clampInteger(addedLatencyMs[candidate], 0, 1000);
    if (candidateRtt < bestRtt) {
      selected = candidate;
      bestRtt = candidateRtt;
    }
  }

  return selected;
}

function geographicFallbackRegion(site: ClientSiteDefinition, candidates: readonly GlobalRegionId[]): GlobalRegionId {
  const zeroPenalty: Record<GlobalRegionId, number> = {
    "eu-central": 0,
    "us-east": 0,
    "ap-southeast": 0,
  };
  return lowestLatencyRegion(site, candidates, zeroPenalty);
}

function selectRegion(
  config: GlobalIngressConfig,
  site: ClientSiteDefinition,
  healthy: readonly GlobalRegionId[],
  requestIndex: number,
): GlobalRegionId | null {
  if (healthy.length === 0) {
    return null;
  }

  if (config.routingPolicy === "round-robin") {
    return healthy[requestIndex % healthy.length] ?? null;
  }

  if (config.routingPolicy === "geography") {
    if (config.healthyRegions[site.homeRegion]) {
      return site.homeRegion;
    }
    return geographicFallbackRegion(site, healthy);
  }

  return lowestLatencyRegion(site, healthy, config.addedLatencyMs);
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function simulateGlobalIngress(config: GlobalIngressConfig): GlobalIngressResult {
  const requestCount = clampInteger(config.requestCount, 1, 500);
  const pattern = TRAFFIC_PATTERNS[config.trafficProfile];
  const healthy = healthyRegionIds(config);
  const requests: GlobalIngressRequest[] = [];

  for (let index = 0; index < requestCount; index += 1) {
    const clientSiteId = pattern[index % pattern.length] ?? pattern[0];
    if (!clientSiteId) {
      throw new Error("traffic profile must contain at least one client site");
    }

    const site = clientSite(clientSiteId);
    const selectedRegion = selectRegion(config, site, healthy, index);
    const homeHealthy = config.healthyRegions[site.homeRegion];

    if (selectedRegion === null) {
      requests.push({
        index,
        clientSite: site.id,
        homeRegion: site.homeRegion,
        selectedRegion: null,
        baseRttMs: null,
        addedLatencyMs: null,
        totalRttMs: null,
        crossRegion: false,
        healthFailover: !homeHealthy,
      });
      continue;
    }

    const baseRttMs = site.baseRttMs[selectedRegion];
    const addedLatencyMs = clampInteger(config.addedLatencyMs[selectedRegion], 0, 1000);
    requests.push({
      index,
      clientSite: site.id,
      homeRegion: site.homeRegion,
      selectedRegion,
      baseRttMs,
      addedLatencyMs,
      totalRttMs: baseRttMs + addedLatencyMs,
      crossRegion: selectedRegion !== site.homeRegion,
      healthFailover: !homeHealthy && selectedRegion !== site.homeRegion,
    });
  }

  const successful = requests.filter((request) => request.totalRttMs !== null);
  const rtts = successful.flatMap((request) => (request.totalRttMs === null ? [] : [request.totalRttMs]));

  const regions = GLOBAL_REGIONS.map((region): GlobalRegionSummary => {
    const routed = successful.filter((request) => request.selectedRegion === region.id);
    const regionRtts = routed.flatMap((request) => (request.totalRttMs === null ? [] : [request.totalRttMs]));
    return {
      regionId: region.id,
      healthy: config.healthyRegions[region.id],
      addedLatencyMs: clampInteger(config.addedLatencyMs[region.id], 0, 1000),
      routedRequests: routed.length,
      meanRttMs: mean(regionRtts),
    };
  });

  return {
    hostname: "multiplayer.example.com",
    requests,
    regions,
    successfulRequests: successful.length,
    failedRequests: requests.length - successful.length,
    crossRegionRequests: requests.filter((request) => request.crossRegion).length,
    healthFailovers: requests.filter((request) => request.healthFailover && request.selectedRegion !== null).length,
    meanRttMs: mean(rtts),
    p95RttMs: percentile95(rtts),
  };
}
