"use client";

import { useMemo, useState } from "react";
import {
  simulate,
  type LoadBalancingPolicy,
  type ServerNodeConfig,
} from "@/lib/simulation";

const policyLabels: Record<LoadBalancingPolicy, string> = {
  "round-robin": "Round robin",
  "least-connections": "Least connections",
  random: "Seeded random",
};

const requestCount = 120;

export default function Home() {
  const [policy, setPolicy] = useState<LoadBalancingPolicy>("round-robin");
  const [replicas, setReplicas] = useState(3);
  const [requestsPerSecond, setRequestsPerSecond] = useState(20);
  const [networkLatencyMs, setNetworkLatencyMs] = useState(25);
  const [serviceTimeMs, setServiceTimeMs] = useState(40);
  const [latencyJitterMs, setLatencyJitterMs] = useState(8);
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
      failures:
        injectFailure && index === 0
          ? [{ startMs: failureStartMs, endMs: failureEndMs }]
          : undefined,
    }));

    return {
      requestCount,
      requestsPerSecond,
      policy,
      seed,
      latencyJitterMs,
      nodes,
    };
  }, [
    injectFailure,
    latencyJitterMs,
    networkLatencyMs,
    policy,
    replicas,
    requestsPerSecond,
    seed,
    serviceTimeMs,
    slowReplica,
  ]);

  const result = useMemo(() => simulate(configuration), [configuration]);
  const peakRouted = Math.max(1, ...result.nodeMetrics.map((node) => node.routedRequests));

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">server-lab · deterministic distributed-systems playground</p>
          <h1>See what changes when servers get slow, busy, replicated, or unavailable.</h1>
          <p className="lede">
            Every control reruns the same seedable request trace. Change one system property and inspect routing,
            latency, availability, and per-replica load without noise from wall-clock timing.
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

          <RangeControl label="Replicas" value={replicas} min={1} max={6} step={1} onChange={setReplicas} />
          <RangeControl
            label="Request rate"
            value={requestsPerSecond}
            suffix=" req/s"
            min={2}
            max={80}
            step={1}
            onChange={setRequestsPerSecond}
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
              <small>Useful for comparing round robin with least connections.</small>
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
            <TopologyBox title="Client" detail={`${requestsPerSecond} req/s`} />
            <span className="arrow">→</span>
            <TopologyBox title="Load balancer" detail={policyLabels[policy]} />
            <span className="arrow">→</span>
            <div className="server-stack">
              {configuration.nodes.map((node, index) => {
                const metric = result.nodeMetrics[index];
                const failed = Boolean(node.failures?.length);
                const slow = node.serviceTimeMs !== serviceTimeMs;
                return (
                  <div className="server-card" key={node.id}>
                    <div>
                      <strong>{node.id}</strong>
                      <span>
                        {node.serviceTimeMs} ms service · {node.networkLatencyMs} ms network
                      </span>
                    </div>
                    <div className="badges">
                      {failed ? <em>fails mid-run</em> : null}
                      {slow ? <em>slow</em> : null}
                    </div>
                    <div className="load-bar" aria-label={`${metric.routedRequests} routed requests`}>
                      <span style={{ width: `${(metric.routedRequests / peakRouted) * 100}%` }} />
                    </div>
                    <small>
                      {metric.routedRequests} routed · peak {metric.peakInFlight} in flight
                    </small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="metrics" aria-label="Simulation metrics">
            <Metric label="Availability" value={`${(result.availability * 100).toFixed(1)}%`} />
            <Metric label="Successful" value={`${result.successfulRequests}/${result.attemptedRequests}`} />
            <Metric label="p50 latency" value={formatLatency(result.p50LatencyMs)} />
            <Metric label="p95 latency" value={formatLatency(result.p95LatencyMs)} />
            <Metric label="Throughput" value={`${result.throughputPerSecond.toFixed(1)} req/s`} />
          </div>

          <div className="lesson-grid">
            <Lesson
              number="01"
              title="Latency"
              text={`A successful request pays roughly two network legs plus service time. Jitter widens the tail: p50 is ${formatLatency(result.p50LatencyMs)}, while p95 is ${formatLatency(result.p95LatencyMs)}.`}
            />
            <Lesson
              number="02"
              title="Load balancing"
              text={`${policyLabels[policy]} decides which healthy replica receives each request. Turn on the slow replica and compare how the policies change the routed-request bars and peak concurrency.`}
            />
            <Lesson
              number="03"
              title="Replication"
              text={`${replicas} replica${replicas === 1 ? "" : "s"} share the same logical service. Replication creates alternate destinations when a node is unavailable, but it does not make slow requests disappear.`}
            />
            <Lesson
              number="04"
              title="Availability"
              text={
                injectFailure
                  ? `server-1 is removed from routing during its failure window. Current end-to-end request availability is ${(result.availability * 100).toFixed(1)}%.`
                  : "No node failure is injected. Enable one, then reduce the replica count to see when redundancy stops masking the outage."
              }
            />
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
                    <th>Arrival</th>
                    <th>Replica</th>
                    <th>Result</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {result.requests.slice(0, 12).map((request) => (
                    <tr key={request.requestId}>
                      <td>#{request.requestId + 1}</td>
                      <td>{request.arrivalMs.toFixed(0)} ms</td>
                      <td>{request.nodeId ?? "—"}</td>
                      <td>
                        <span className={request.success ? "status-ok" : "status-failed"}>
                          {request.success ? "success" : request.failureReason}
                        </span>
                      </td>
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
          <h2>From routing to overload.</h2>
        </div>
        <p>
          The next slice adds bounded queues, queueing delay, load shedding, bursts, and backpressure. After that,
          replication becomes semantic: leaders, replica lag, stale reads, quorums, partitions, retries, and failover.
          Native Rust processes will then replay selected scenarios against real sockets instead of expanding the
          simulator until it becomes a fake network stack.
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
