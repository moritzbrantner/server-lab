"use client";

import { useMemo, useState } from "react";
import {
  simulate,
  type LoadBalancingPolicy,
  type OverloadPolicy,
  type ServerNodeConfig,
} from "@/lib/simulation";

const policyLabels: Record<LoadBalancingPolicy, string> = {
  "round-robin": "Round robin",
  "least-connections": "Least connections",
  random: "Seeded random",
};

const overloadLabels: Record<OverloadPolicy, string> = {
  queue: "Bounded queue",
  reject: "Reject when busy",
  "shed-load": "Shed by wait budget",
};

const requestCount = 120;

export default function Home() {
  const [policy, setPolicy] = useState<LoadBalancingPolicy>("round-robin");
  const [overloadPolicy, setOverloadPolicy] = useState<OverloadPolicy>("queue");
  const [replicas, setReplicas] = useState(3);
  const [requestsPerSecond, setRequestsPerSecond] = useState(20);
  const [networkLatencyMs, setNetworkLatencyMs] = useState(25);
  const [serviceTimeMs, setServiceTimeMs] = useState(40);
  const [latencyJitterMs, setLatencyJitterMs] = useState(8);
  const [maxConcurrentRequests, setMaxConcurrentRequests] = useState(2);
  const [queueCapacity, setQueueCapacity] = useState(6);
  const [maxQueueWaitMs, setMaxQueueWaitMs] = useState(120);
  const [burstTraffic, setBurstTraffic] = useState(false);
  const [burstMultiplier, setBurstMultiplier] = useState(4);
  const [clientBackpressure, setClientBackpressure] = useState(false);
  const [backpressureLimit, setBackpressureLimit] = useState(8);
  const [injectFailure, setInjectFailure] = useState(true);
  const [slowReplica, setSlowReplica] = useState(false);
  const [seed, setSeed] = useState(7);

  const configuration = useMemo(() => {
    const intervalMs = 1000 / requestsPerSecond;
    const scenarioSpanMs = (requestCount - 1) * intervalMs;
    const failureStartMs = scenarioSpanMs * 0.35;
    const failureEndMs = scenarioSpanMs * 0.7;

    const nodes: ServerNodeConfig[] = Array.from({ length: replicas }, (_, index) => ({
      id: `server-${index + 1}`,
      serviceTimeMs:
        slowReplica && index === replicas - 1 && replicas > 1 ? serviceTimeMs * 4 : serviceTimeMs,
      networkLatencyMs,
      maxConcurrentRequests,
      queueCapacity,
      failures:
        injectFailure && index === 0
          ? [{ startMs: failureStartMs, endMs: failureEndMs }]
          : undefined,
    }));

    return {
      requestCount,
      requestsPerSecond,
      policy,
      overloadPolicy,
      maxQueueWaitMs,
      backpressureLimit: clientBackpressure ? backpressureLimit : 0,
      burst: burstTraffic
        ? {
            startRequest: Math.floor(requestCount * 0.35),
            requestCount: Math.floor(requestCount * 0.3),
            multiplier: burstMultiplier,
          }
        : undefined,
      seed,
      latencyJitterMs,
      nodes,
    };
  }, [
    backpressureLimit,
    burstMultiplier,
    burstTraffic,
    clientBackpressure,
    injectFailure,
    latencyJitterMs,
    maxConcurrentRequests,
    maxQueueWaitMs,
    networkLatencyMs,
    overloadPolicy,
    policy,
    queueCapacity,
    replicas,
    requestsPerSecond,
    seed,
    serviceTimeMs,
    slowReplica,
  ]);

  const result = useMemo(() => simulate(configuration), [configuration]);
  const peakRouted = Math.max(1, ...result.nodeMetrics.map((metric) => metric.routedRequests));
  const overloaded = result.overloadDroppedRequests > 0 || (result.p95QueueDelayMs ?? 0) > 0;

  function applyPreset(preset: "steady" | "saturated" | "burst") {
    setInjectFailure(false);
    setSlowReplica(false);
    setClientBackpressure(false);
    setPolicy("least-connections");
    setOverloadPolicy("queue");
    setNetworkLatencyMs(20);
    setLatencyJitterMs(4);
    setQueueCapacity(6);
    setMaxQueueWaitMs(120);

    if (preset === "steady") {
      setReplicas(3);
      setRequestsPerSecond(20);
      setServiceTimeMs(40);
      setMaxConcurrentRequests(2);
      setBurstTraffic(false);
      return;
    }

    if (preset === "saturated") {
      setReplicas(2);
      setRequestsPerSecond(70);
      setServiceTimeMs(40);
      setMaxConcurrentRequests(1);
      setQueueCapacity(4);
      setBurstTraffic(false);
      return;
    }

    setReplicas(2);
    setRequestsPerSecond(20);
    setServiceTimeMs(40);
    setMaxConcurrentRequests(1);
    setQueueCapacity(5);
    setBurstMultiplier(5);
    setBurstTraffic(true);
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">server-lab · deterministic distributed-systems playground</p>
          <h1>See what changes when servers get slow, busy, replicated, or unavailable.</h1>
          <p className="lede">
            Every control reruns the same seedable request trace. Change one system property and inspect routing,
            queueing, latency, availability, overload, and per-replica load without wall-clock noise.
          </p>
        </div>
        <div className="hero-note">
          <strong>Simulation, not a benchmark.</strong>
          <span>Real sockets, processes, and network fault injection belong to the native experiment horizon.</span>
        </div>
      </header>

      <section className="lab-shell" aria-label="Interactive server simulation">
        <aside className="controls">
          <div className="section-heading">
            <span>Experiment controls</span>
            <code>seed {seed}</code>
          </div>

          <div className="preset-grid" aria-label="Scenario presets">
            <button type="button" onClick={() => applyPreset("steady")}>Steady</button>
            <button type="button" onClick={() => applyPreset("saturated")}>Saturated</button>
            <button type="button" onClick={() => applyPreset("burst")}>Burst</button>
          </div>

          <label>
            Load balancer
            <select value={policy} onChange={(event) => setPolicy(event.target.value as LoadBalancingPolicy)}>
              {Object.entries(policyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Overload policy
            <select value={overloadPolicy} onChange={(event) => setOverloadPolicy(event.target.value as OverloadPolicy)}>
              {Object.entries(overloadLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <small className="control-help">
              Queue waits within a fixed bound, reject admits only immediate work, and shedding protects a queue-wait budget.
            </small>
          </label>

          <RangeControl label="Replicas" value={replicas} min={1} max={6} step={1} onChange={setReplicas} />
          <RangeControl
            label="Request rate"
            value={requestsPerSecond}
            suffix=" req/s"
            min={2}
            max={100}
            step={1}
            onChange={setRequestsPerSecond}
          />
          <RangeControl
            label="Workers per replica"
            value={maxConcurrentRequests}
            min={1}
            max={8}
            step={1}
            onChange={setMaxConcurrentRequests}
          />
          <RangeControl
            label="Queue capacity"
            value={queueCapacity}
            suffix=" waiting"
            min={0}
            max={24}
            step={1}
            onChange={setQueueCapacity}
          />
          <RangeControl
            label="One-way network latency"
            value={networkLatencyMs}
            suffix=" ms"
            min={0}
            max={160}
            step={5}
            onChange={setNetworkLatencyMs}
          />
          <RangeControl
            label="Service time"
            value={serviceTimeMs}
            suffix=" ms"
            min={5}
            max={240}
            step={5}
            onChange={setServiceTimeMs}
          />
          <RangeControl
            label="Latency jitter"
            value={latencyJitterMs}
            suffix=" ms"
            min={0}
            max={60}
            step={2}
            onChange={setLatencyJitterMs}
          />
          <RangeControl
            label="Shed wait budget"
            value={maxQueueWaitMs}
            suffix=" ms"
            min={0}
            max={500}
            step={10}
            onChange={setMaxQueueWaitMs}
          />

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={burstTraffic}
              onChange={(event) => setBurstTraffic(event.target.checked)}
            />
            <span>
              <strong>Inject a traffic burst</strong>
              <small>Compress the middle 30% of arrivals without changing the request count.</small>
            </span>
          </label>
          {burstTraffic ? (
            <RangeControl
              label="Burst multiplier"
              value={burstMultiplier}
              suffix="×"
              min={2}
              max={8}
              step={1}
              onChange={setBurstMultiplier}
            />
          ) : null}

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={clientBackpressure}
              onChange={(event) => setClientBackpressure(event.target.checked)}
            />
            <span>
              <strong>Enable client backpressure</strong>
              <small>Delay new arrivals once the configured number of requests are already outstanding.</small>
            </span>
          </label>
          {clientBackpressure ? (
            <RangeControl
              label="Outstanding limit"
              value={backpressureLimit}
              min={1}
              max={32}
              step={1}
              onChange={setBackpressureLimit}
            />
          ) : null}

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={injectFailure}
              onChange={(event) => setInjectFailure(event.target.checked)}
            />
            <span>
              <strong>Fail server-1 mid-run</strong>
              <small>Unavailable for the middle 35% of the request trace.</small>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={slowReplica}
              onChange={(event) => setSlowReplica(event.target.checked)}
            />
            <span>
              <strong>Make the last replica 4× slower</strong>
              <small>Useful for comparing round robin with least connections under queue pressure.</small>
            </span>
          </label>

          <label>
            Seed
            <input
              type="number"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value) || 0)}
            />
          </label>
        </aside>

        <div className="experiment">
          <div className="topology" aria-label="Client to load balancer to replicated servers">
            <TopologyBox
              title="Client"
              detail={burstTraffic ? `${requestsPerSecond} req/s · ${burstMultiplier}× burst` : `${requestsPerSecond} req/s`}
            />
            <span className="arrow">→</span>
            <TopologyBox title="Load balancer" detail={`${policyLabels[policy]} · ${overloadLabels[overloadPolicy]}`} />
            <span className="arrow">→</span>
            <div className="server-stack">
              {configuration.nodes.map((server, index) => {
                const metric = result.nodeMetrics[index];
                const failed = Boolean(server.failures?.length);
                const slow = server.serviceTimeMs !== serviceTimeMs;
                return (
                  <div className="server-card" key={server.id}>
                    <div>
                      <strong>{server.id}</strong>
                      <span>
                        {server.serviceTimeMs} ms service · {server.maxConcurrentRequests} workers · q{server.queueCapacity}
                      </span>
                    </div>
                    <div className="badges">
                      {failed ? <em>fails mid-run</em> : null}
                      {slow ? <em>slow</em> : null}
                      {metric.rejectedRequests > 0 ? <em>{metric.rejectedRequests} dropped</em> : null}
                    </div>
                    <div className="load-bar" aria-label={`${metric.routedRequests} routed requests`}>
                      <span style={{ width: `${(metric.routedRequests / peakRouted) * 100}%` }} />
                    </div>
                    <small>
                      {metric.successfulRequests}/{metric.routedRequests} completed · peak {metric.peakInFlight} outstanding · q{metric.peakQueueDepth} peak
                    </small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="metrics" aria-label="Simulation metrics">
            <Metric label="Availability" value={`${(result.availability * 100).toFixed(1)}%`} />
            <Metric label="Successful" value={`${result.successfulRequests}/${result.attemptedRequests}`} />
            <Metric label="Arrival rate" value={`${result.measuredArrivalRatePerSecond.toFixed(1)} req/s`} />
            <Metric label="Throughput" value={`${result.throughputPerSecond.toFixed(1)} req/s`} />
            <Metric label="Nominal capacity" value={`${result.nominalServiceCapacityPerSecond.toFixed(1)} req/s`} />
            <Metric label="p50 latency" value={formatLatency(result.p50LatencyMs)} />
            <Metric label="p95 latency" value={formatLatency(result.p95LatencyMs)} />
            <Metric label="p95 queue wait" value={formatLatency(result.p95QueueDelayMs)} />
            <Metric label="Queued" value={`${result.queuedRequests}`} />
            <Metric label="Overload drops" value={`${result.overloadDroppedRequests}`} />
          </div>

          <div className={`capacity-banner ${overloaded ? "capacity-banner-hot" : ""}`}>
            <strong>{overloaded ? "Capacity pressure is visible." : "The system is inside its current capacity envelope."}</strong>
            <span>
              Offered arrivals are {result.measuredArrivalRatePerSecond.toFixed(1)} req/s against {result.nominalServiceCapacityPerSecond.toFixed(1)} req/s nominal service capacity. Network delay affects end-to-end latency; workers and service time determine this simplified service-capacity figure.
            </span>
          </div>

          <div className="lesson-grid">
            <Lesson
              number="01"
              title="Latency"
              text={`A successful request pays two network legs, queue wait, and service time. Current p50 is ${formatLatency(result.p50LatencyMs)} and p95 is ${formatLatency(result.p95LatencyMs)}.`}
            />
            <Lesson
              number="02"
              title="Load balancing"
              text={`${policyLabels[policy]} chooses among healthy replicas. A slow replica exposes why even distribution and least outstanding work are different goals.`}
            />
            <Lesson
              number="03"
              title="Replication"
              text={`${replicas} replica${replicas === 1 ? "" : "s"} create alternate destinations and multiply nominal service capacity, but correlated overload can still saturate every copy.`}
            />
            <Lesson
              number="04"
              title="Availability"
              text={
                injectFailure
                  ? `server-1 disappears from routing during its failure window. End-to-end request availability is ${(result.availability * 100).toFixed(1)}%.`
                  : "No node failure is injected. Enable one and reduce replicas to see when redundancy stops masking the outage."
              }
            />
            <Lesson
              number="05"
              title="Queues"
              text={`${result.queuedRequests} requests waited for a worker. A queue converts some overload into latency; it does not create capacity. Current p95 queue wait is ${formatLatency(result.p95QueueDelayMs)}.`}
            />
            <Lesson
              number="06"
              title="Overload policy"
              text={`${overloadLabels[overloadPolicy]} dropped ${result.overloadDroppedRequests} requests. Compare it with the other policies at the same rate to see the latency-versus-rejection tradeoff.`}
            />
            <Lesson
              number="07"
              title="Bursts"
              text={
                burstTraffic
                  ? `The middle of the trace arrives ${burstMultiplier}× faster. Short bursts can overflow a queue even when the long-run base rate looks safe.`
                  : "Enable the burst or choose the Burst preset to distinguish sustained capacity from temporary queue absorption."
              }
            />
            <Lesson
              number="08"
              title="Backpressure"
              text={
                clientBackpressure
                  ? `The client delayed requests by ${result.meanBackpressureDelayMs.toFixed(1)} ms on average instead of offering unlimited outstanding work.`
                  : "Backpressure moves waiting toward the producer. Enable it under saturation and compare queue depth, drops, and measured arrival rate."
              }
            />
          </div>

          <div className="law-panel">
            <div className="section-heading">
              <span>Little&apos;s Law</span>
              <code>L = λ × W</code>
            </div>
            <div className="law-equation">
              <Metric label="Measured L" value={result.averageInSystem.toFixed(2)} />
              <Metric label="λ · throughput" value={`${result.throughputPerSecond.toFixed(2)}/s`} />
              <Metric label="W · mean latency" value={formatLatency(result.meanLatencyMs)} />
              <Metric label="λ × W" value={result.littleLawEstimate.toFixed(2)} />
            </div>
            <p>
              L is the time-averaged number of successful requests in this simulated system, λ is successful completion rate, and W is mean end-to-end request time. Because the trace is finite and observed through completion, the two sides should match apart from floating-point rounding.
            </p>
          </div>

          <div className="trace-panel">
            <div className="section-heading">
              <span>Request trace</span>
              <code>first 12 of {result.attemptedRequests}</code>
            </div>
            <div className="trace-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Scheduled</th>
                    <th>Actual</th>
                    <th>Replica</th>
                    <th>Result</th>
                    <th>Queue</th>
                    <th>Backpressure</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {result.requests.slice(0, 12).map((request) => (
                    <tr key={request.requestId}>
                      <td>#{request.requestId + 1}</td>
                      <td>{request.scheduledArrivalMs.toFixed(0)} ms</td>
                      <td>{request.arrivalMs.toFixed(0)} ms</td>
                      <td>{request.nodeId ?? "—"}</td>
                      <td>
                        <span className={request.success ? "status-ok" : "status-failed"}>
                          {request.success ? "success" : request.failureReason}
                        </span>
                      </td>
                      <td>{formatLatency(request.queueDelayMs)}</td>
                      <td>{request.backpressureDelayMs.toFixed(1)} ms</td>
                      <td>{formatLatency(request.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="concepts">
        <div>
          <p className="eyebrow">next implementation horizon</p>
          <h2>From capacity to consistency.</h2>
        </div>
        <p>
          The next slice separates leaders from read replicas and makes replication semantic: synchronous versus asynchronous replication, replica lag, stale reads, read-after-write behavior, and quorum reads/writes. Partitions then become visible in the event trace before retries, failover, or consensus are introduced.
        </p>
      </section>
    </main>
  );
}

function RangeControl({
  label,
  value,
  suffix = "",
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="range-label">
        <span>{label}</span>
        <strong>
          {value}
          {suffix}
        </strong>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function TopologyBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="topology-box">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Lesson({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <article className="lesson">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function formatLatency(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}
