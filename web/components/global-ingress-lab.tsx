"use client";

import { useMemo, useState } from "react";
import {
  CLIENT_SITES,
  GLOBAL_REGIONS,
  simulateGlobalIngress,
  type GlobalRegionId,
  type IngressRoutingPolicy,
  type TrafficProfile,
} from "@/lib/global-ingress";

const defaultHealth: Record<GlobalRegionId, boolean> = {
  "eu-central": true,
  "us-east": true,
  "ap-southeast": true,
};

const defaultAddedLatency: Record<GlobalRegionId, number> = {
  "eu-central": 0,
  "us-east": 0,
  "ap-southeast": 0,
};

const policyLabels: Record<IngressRoutingPolicy, string> = {
  "round-robin": "Round robin",
  geography: "Geographic proximity",
  latency: "Measured latency",
};

const profileLabels: Record<TrafficProfile, string> = {
  balanced: "Balanced world traffic",
  "europe-heavy": "Europe-heavy traffic",
  "asia-heavy": "Asia-heavy traffic",
};

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value % 1 === 0 ? 0 : 1)} ms`;
}

function regionLabel(regionId: GlobalRegionId | null): string {
  if (regionId === null) {
    return "unavailable";
  }
  return GLOBAL_REGIONS.find((region) => region.id === regionId)?.location ?? regionId;
}

export function GlobalIngressLab() {
  const [routingPolicy, setRoutingPolicy] = useState<IngressRoutingPolicy>("latency");
  const [trafficProfile, setTrafficProfile] = useState<TrafficProfile>("balanced");
  const [requestCount, setRequestCount] = useState(60);
  const [healthyRegions, setHealthyRegions] = useState<Record<GlobalRegionId, boolean>>(defaultHealth);
  const [addedLatencyMs, setAddedLatencyMs] = useState<Record<GlobalRegionId, number>>(defaultAddedLatency);

  const result = useMemo(
    () =>
      simulateGlobalIngress({
        requestCount,
        routingPolicy,
        trafficProfile,
        healthyRegions,
        addedLatencyMs,
      }),
    [addedLatencyMs, healthyRegions, requestCount, routingPolicy, trafficProfile],
  );

  const setRegionHealth = (regionId: GlobalRegionId, healthy: boolean) => {
    setHealthyRegions((current) => ({ ...current, [regionId]: healthy }));
  };

  const setRegionLatency = (regionId: GlobalRegionId, latencyMs: number) => {
    setAddedLatencyMs((current) => ({ ...current, [regionId]: latencyMs }));
  };

  return (
    <main className="global-lab">
      <header className="global-hero">
        <div>
          <p className="eyebrow">server-lab · slice 7A</p>
          <h1>One multiplayer hostname. Several regions. One routing decision per arrival.</h1>
          <p className="lede">
            Put Frankfurt, Virginia, and Singapore behind the same logical endpoint. Compare round-robin,
            geography, and latency-aware steering, then fail or slow regions and inspect exactly where new
            setup traffic goes.
          </p>
        </div>
        <aside className="global-boundary">
          <strong>Control plane only.</strong>
          <span>
            This slice models how a player reaches a healthy signaling region. Room ownership, WebRTC gameplay,
            and TURN relay placement remain separate later slices.
          </span>
        </aside>
      </header>

      <section className="global-shell" aria-labelledby="global-ingress-heading">
        <div className="global-controls">
          <div>
            <p className="eyebrow">experiment controls</p>
            <h2 id="global-ingress-heading">Global ingress</h2>
          </div>

          <label>
            Routing policy
            <select
              value={routingPolicy}
              onChange={(event) => setRoutingPolicy(event.target.value as IngressRoutingPolicy)}
            >
              <option value="latency">Measured latency</option>
              <option value="geography">Geographic proximity</option>
              <option value="round-robin">Round robin</option>
            </select>
          </label>

          <label>
            Traffic profile
            <select value={trafficProfile} onChange={(event) => setTrafficProfile(event.target.value as TrafficProfile)}>
              <option value="balanced">Balanced world traffic</option>
              <option value="europe-heavy">Europe-heavy traffic</option>
              <option value="asia-heavy">Asia-heavy traffic</option>
            </select>
          </label>

          <label>
            <span className="global-range-label">
              Requests <strong>{requestCount}</strong>
            </span>
            <input
              type="range"
              min={12}
              max={120}
              step={6}
              value={requestCount}
              onChange={(event) => setRequestCount(Number(event.target.value))}
            />
          </label>

          <div className="global-region-controls">
            {GLOBAL_REGIONS.map((region) => (
              <article key={region.id} className="global-region-control">
                <div className="global-region-heading">
                  <div>
                    <strong>{region.location}</strong>
                    <span>{region.id}</span>
                  </div>
                  <label className="global-health-toggle">
                    <input
                      type="checkbox"
                      checked={healthyRegions[region.id]}
                      onChange={(event) => setRegionHealth(region.id, event.target.checked)}
                    />
                    {healthyRegions[region.id] ? "healthy" : "down"}
                  </label>
                </div>
                <label>
                  <span className="global-range-label">
                    Added RTT <strong>{addedLatencyMs[region.id]} ms</strong>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={220}
                    step={10}
                    value={addedLatencyMs[region.id]}
                    onChange={(event) => setRegionLatency(region.id, Number(event.target.value))}
                  />
                </label>
              </article>
            ))}
          </div>
        </div>

        <div className="global-results">
          <div className="global-route-strip" aria-label="Global routing topology">
            <div>
              <span>Players</span>
              <strong>Frankfurt · Virginia · Singapore</strong>
            </div>
            <b aria-hidden="true">→</b>
            <div className="global-hostname">
              <span>One hostname</span>
              <strong>{result.hostname}</strong>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              <span>Policy</span>
              <strong>{policyLabels[routingPolicy]}</strong>
            </div>
          </div>

          <p className="global-summary">
            {result.successfulRequests} of {result.requests.length} arrivals reach a healthy region. Mean modeled
            ingress RTT is <strong>{formatMs(result.meanRttMs)}</strong>, p95 is <strong>{formatMs(result.p95RttMs)}</strong>,
            {" "}{result.crossRegionRequests} requests cross away from the client&apos;s home region, and {result.healthFailovers}
            {" "}are explicit health failovers.
          </p>

          <div className="global-region-grid">
            {result.regions.map((summary) => {
              const region = GLOBAL_REGIONS.find((candidate) => candidate.id === summary.regionId);
              return (
                <article key={summary.regionId} className={`global-region-card ${summary.healthy ? "" : "is-down"}`}>
                  <div>
                    <span>{region?.label ?? summary.regionId}</span>
                    <strong>{region?.location ?? summary.regionId}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Status</dt>
                      <dd>{summary.healthy ? "healthy" : "down"}</dd>
                    </div>
                    <div>
                      <dt>Routed</dt>
                      <dd>{summary.routedRequests}</dd>
                    </div>
                    <div>
                      <dt>Mean RTT</dt>
                      <dd>{formatMs(summary.meanRttMs)}</dd>
                    </div>
                    <div>
                      <dt>Added RTT</dt>
                      <dd>{summary.addedLatencyMs} ms</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>

          <section className="global-explanation">
            <div>
              <p className="eyebrow">what the policy means</p>
              <h3>{policyLabels[routingPolicy]}</h3>
            </div>
            <p>
              {routingPolicy === "round-robin" &&
                "Every arrival rotates across the currently healthy regions. This balances request counts, not user latency."}
              {routingPolicy === "geography" &&
                "A client stays in its configured home region while that region is healthy. Added latency does not move it; a health failure does."}
              {routingPolicy === "latency" &&
                "Each client chooses the healthy region with the smallest modeled base RTT plus the injected regional RTT penalty. A slow-but-healthy region can therefore lose traffic."}
            </p>
          </section>

          <section>
            <div className="global-section-heading">
              <div>
                <p className="eyebrow">baseline matrix</p>
                <h3>Client-to-region RTT assumptions</h3>
              </div>
              <p>Teaching constants, not measurements.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    {GLOBAL_REGIONS.map((region) => <th key={region.id}>{region.location}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {CLIENT_SITES.map((site) => (
                    <tr key={site.id}>
                      <td>{site.label}</td>
                      {GLOBAL_REGIONS.map((region) => <td key={region.id}>{site.baseRttMs[region.id]} ms</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="global-section-heading">
              <div>
                <p className="eyebrow">request trace</p>
                <h3>Why each arrival ended up where it did</h3>
              </div>
              <p>First 18 arrivals.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Client</th>
                    <th>Home</th>
                    <th>Selected</th>
                    <th>RTT</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {result.requests.slice(0, 18).map((request) => (
                    <tr key={request.index}>
                      <td>{request.index + 1}</td>
                      <td>{request.clientSite}</td>
                      <td>{regionLabel(request.homeRegion)}</td>
                      <td>{regionLabel(request.selectedRegion)}</td>
                      <td>{formatMs(request.totalRttMs)}</td>
                      <td>
                        {request.selectedRegion === null
                          ? "no healthy region"
                          : request.healthFailover
                            ? "health failover"
                            : request.crossRegion
                              ? "cross-region steering"
                              : "home region"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>

      <footer className="global-next">
        <div>
          <p className="eyebrow">boundary</p>
          <h2>Routing a player is not the same as routing a room.</h2>
        </div>
        <p>
          Slice 7A deliberately stops after global ingress. Slice 7B will give rooms a regional authority and a
          small global directory so independently routed players can converge on the same room. Later slices will
          separate signaling latency from WebRTC/TURN latency and then exercise regional failures.
        </p>
      </footer>
    </main>
  );
}
