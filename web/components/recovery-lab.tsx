"use client";

import { useMemo, useState } from "react";
import {
  failureDomainAvailability,
  simulateElection,
  simulateRecovery,
  type HealthCheckMode,
  type RecoveryNodeConfig,
} from "@/lib/recovery";

const requestCount = 80;

export function RecoveryLab() {
  const [healthCheckMode, setHealthCheckMode] = useState<HealthCheckMode>("active");
  const [healthCheckIntervalMs, setHealthCheckIntervalMs] = useState(150);
  const [healthFailureThreshold, setHealthFailureThreshold] = useState(2);
  const [failoverDelayMs, setFailoverDelayMs] = useState(250);
  const [attemptTimeoutMs, setAttemptTimeoutMs] = useState(120);
  const [requestsPerSecond, setRequestsPerSecond] = useState(18);
  const [maxRetries, setMaxRetries] = useState(2);
  const [baseBackoffMs, setBaseBackoffMs] = useState(80);
  const [retryJitterMs, setRetryJitterMs] = useState(20);
  const [breakerEnabled, setBreakerEnabled] = useState(true);
  const [breakerThreshold, setBreakerThreshold] = useState(3);
  const [breakerOpenMs, setBreakerOpenMs] = useState(500);
  const [correlatedFailure, setCorrelatedFailure] = useState(false);
  const [seed, setSeed] = useState(17);

  const [nodeAvailabilityPct, setNodeAvailabilityPct] = useState(99.9);
  const [domainAvailabilityPct, setDomainAvailabilityPct] = useState(99.0);

  const [electionTimeoutMs, setElectionTimeoutMs] = useState(400);
  const [electionDurationMs, setElectionDurationMs] = useState(250);
  const [loseElectionMajority, setLoseElectionMajority] = useState(false);

  const recoveryConfig = useMemo(() => {
    const failure = { startMs: 900, endMs: 2700 };
    const nodes: RecoveryNodeConfig[] = [
      {
        id: "server-1",
        failureDomain: "zone-a",
        serviceTimeMs: 35,
        networkLatencyMs: 20,
        failures: [failure],
      },
      {
        id: "server-2",
        failureDomain: "zone-a",
        serviceTimeMs: 35,
        networkLatencyMs: 20,
        failures: correlatedFailure ? [failure] : undefined,
      },
      {
        id: "server-3",
        failureDomain: "zone-b",
        serviceTimeMs: 35,
        networkLatencyMs: 20,
      },
    ];

    return {
      requestCount,
      requestsPerSecond,
      seed,
      nodes,
      healthCheckMode,
      healthCheckIntervalMs,
      healthFailureThreshold,
      failoverDelayMs,
      attemptTimeoutMs,
      retry: {
        maxRetries,
        baseBackoffMs,
        jitterMs: retryJitterMs,
      },
      circuitBreaker: {
        enabled: breakerEnabled,
        failureThreshold: breakerThreshold,
        openMs: breakerOpenMs,
      },
    };
  }, [
    attemptTimeoutMs,
    baseBackoffMs,
    breakerEnabled,
    breakerOpenMs,
    breakerThreshold,
    correlatedFailure,
    failoverDelayMs,
    healthCheckIntervalMs,
    healthCheckMode,
    healthFailureThreshold,
    maxRetries,
    requestsPerSecond,
    retryJitterMs,
    seed,
  ]);

  const recovery = useMemo(() => simulateRecovery(recoveryConfig), [recoveryConfig]);

  const sameDomainAvailability = useMemo(
    () =>
      failureDomainAvailability([
        {
          domainAvailability: domainAvailabilityPct / 100,
          nodeAvailability: nodeAvailabilityPct / 100,
          replicas: 3,
        },
      ]),
    [domainAvailabilityPct, nodeAvailabilityPct],
  );

  const separateDomainAvailability = useMemo(
    () =>
      failureDomainAvailability(
        Array.from({ length: 3 }, () => ({
          domainAvailability: domainAvailabilityPct / 100,
          nodeAvailability: nodeAvailabilityPct / 100,
          replicas: 1,
        })),
      ),
    [domainAvailabilityPct, nodeAvailabilityPct],
  );

  const election = useMemo(
    () =>
      simulateElection({
        initialLeaderId: "node-1",
        initialTerm: 7,
        heartbeatIntervalMs: 100,
        electionTimeoutMs,
        electionDurationMs,
        nodes: [
          { id: "node-1", failures: [{ startMs: 1000, endMs: 3200 }] },
          {
            id: "node-2",
            failures: loseElectionMajority ? [{ startMs: 0, endMs: 4000 }] : undefined,
          },
          {
            id: "node-3",
            failures: loseElectionMajority ? [{ startMs: 0, endMs: 4000 }] : undefined,
          },
          { id: "node-4" },
          { id: "node-5" },
        ],
      }),
    [electionDurationMs, electionTimeoutMs, loseElectionMajority],
  );

  function applyPreset(preset: "fast" | "retry-storm" | "breaker" | "correlated") {
    setHealthCheckMode("active");
    setHealthCheckIntervalMs(150);
    setHealthFailureThreshold(2);
    setFailoverDelayMs(250);
    setAttemptTimeoutMs(120);
    setRequestsPerSecond(18);
    setMaxRetries(2);
    setBaseBackoffMs(80);
    setRetryJitterMs(20);
    setBreakerEnabled(true);
    setBreakerThreshold(3);
    setBreakerOpenMs(500);
    setCorrelatedFailure(false);

    if (preset === "fast") {
      setHealthCheckIntervalMs(100);
      setHealthFailureThreshold(1);
      setFailoverDelayMs(100);
      setMaxRetries(1);
      return;
    }

    if (preset === "retry-storm") {
      setHealthCheckMode("passive");
      setHealthFailureThreshold(8);
      setMaxRetries(5);
      setBaseBackoffMs(20);
      setRetryJitterMs(0);
      setBreakerEnabled(false);
      setRequestsPerSecond(28);
      return;
    }

    if (preset === "breaker") {
      setHealthCheckMode("passive");
      setHealthFailureThreshold(12);
      setMaxRetries(3);
      setBreakerEnabled(true);
      setBreakerThreshold(2);
      setBreakerOpenMs(700);
      setRequestsPerSecond(28);
      return;
    }

    setCorrelatedFailure(true);
    setHealthCheckIntervalMs(100);
    setHealthFailureThreshold(1);
    setFailoverDelayMs(150);
  }

  const traceAttempts = recovery.requests.flatMap((request) => request.attempts).slice(0, 16);

  return (
    <main className="recovery-page">
      <header className="recovery-header">
        <div>
          <p className="eyebrow">slice 4 · availability, recovery, and coordination</p>
          <h1>Failure is an event. Recovery is a timeline.</h1>
          <p className="lede">
            Separate physical failure from detection, promotion, retries, circuit state, and leadership. The same
            deterministic timeline shows why retries can amplify outages and why an old leader must be fenced after
            a new term begins.
          </p>
        </div>
        <div className="recovery-callout">
          <strong>Recovery before consensus.</strong>
          <span>
            The election exhibit uses terms, majority availability, and fencing, but deliberately stops before a named
            consensus algorithm or replicated log.
          </span>
        </div>
      </header>

      <section className="recovery-shell">
        <aside className="recovery-controls">
          <div className="section-heading">
            <span>Service recovery</span>
            <code>seed {seed}</code>
          </div>

          <div className="preset-grid recovery-presets">
            <button type="button" onClick={() => applyPreset("fast")}>Fast failover</button>
            <button type="button" onClick={() => applyPreset("retry-storm")}>Retry storm</button>
            <button type="button" onClick={() => applyPreset("breaker")}>Circuit breaker</button>
            <button type="button" onClick={() => applyPreset("correlated")}>Zone outage</button>
          </div>

          <label>
            Health evidence
            <select value={healthCheckMode} onChange={(event) => setHealthCheckMode(event.target.value as HealthCheckMode)}>
              <option value="active">Active checks</option>
              <option value="passive">Passive request failures</option>
            </select>
          </label>

          <RangeControl label="Request rate" value={requestsPerSecond} suffix=" req/s" min={4} max={40} step={1} onChange={setRequestsPerSecond} />
          <RangeControl label="Health interval" value={healthCheckIntervalMs} suffix=" ms" min={50} max={600} step={50} onChange={setHealthCheckIntervalMs} />
          <RangeControl label="Failure threshold" value={healthFailureThreshold} min={1} max={12} step={1} onChange={setHealthFailureThreshold} />
          <RangeControl label="Failover delay" value={failoverDelayMs} suffix=" ms" min={0} max={1200} step={50} onChange={setFailoverDelayMs} />
          <RangeControl label="Attempt timeout" value={attemptTimeoutMs} suffix=" ms" min={20} max={500} step={20} onChange={setAttemptTimeoutMs} />
          <RangeControl label="Max retries" value={maxRetries} min={0} max={6} step={1} onChange={setMaxRetries} />
          <RangeControl label="Base backoff" value={baseBackoffMs} suffix=" ms" min={0} max={400} step={20} onChange={setBaseBackoffMs} />
          <RangeControl label="Backoff jitter" value={retryJitterMs} suffix=" ms" min={0} max={150} step={10} onChange={setRetryJitterMs} />

          <label className="toggle-row">
            <input type="checkbox" checked={breakerEnabled} onChange={(event) => setBreakerEnabled(event.target.checked)} />
            <span>
              <strong>Enable circuit breaker</strong>
              <small>Open after consecutive failures, then allow a deterministic half-open probe.</small>
            </span>
          </label>
          {breakerEnabled ? (
            <>
              <RangeControl label="Breaker threshold" value={breakerThreshold} min={1} max={8} step={1} onChange={setBreakerThreshold} />
              <RangeControl label="Breaker open time" value={breakerOpenMs} suffix=" ms" min={100} max={1600} step={100} onChange={setBreakerOpenMs} />
            </>
          ) : null}

          <label className="toggle-row">
            <input type="checkbox" checked={correlatedFailure} onChange={(event) => setCorrelatedFailure(event.target.checked)} />
            <span>
              <strong>Fail all of zone-a</strong>
              <small>server-1 and server-2 share one failure domain; server-3 is in zone-b.</small>
            </span>
          </label>

          <label>
            Seed
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 0)} />
          </label>
        </aside>

        <div className="recovery-results">
          <div className="recovery-timeline">
            <TimelineStep label="Physical failure" value="900 ms" detail={correlatedFailure ? "zone-a fails" : "server-1 fails"} />
            <span>→</span>
            <TimelineStep
              label="Detected"
              value={formatLatency(recovery.firstFailureDetectionMs)}
              detail={healthCheckMode === "active" ? "health checks" : "observed requests"}
            />
            <span>→</span>
            <TimelineStep label="Promoted" value={formatLatency(recovery.firstFailoverCompleteMs)} detail={`${failoverDelayMs} ms promotion delay`} />
          </div>

          <div className="metrics recovery-metrics">
            <Metric label="Availability" value={`${(recovery.availability * 100).toFixed(1)}%`} />
            <Metric label="Recovery window" value={formatLatency(recovery.recoveryWindowMs)} />
            <Metric label="Backend attempts" value={`${recovery.backendAttempts}`} />
            <Metric label="Retry amplification" value={`${recovery.retryAmplification.toFixed(2)}×`} />
            <Metric label="Retried requests" value={`${recovery.retriedRequests}`} />
            <Metric label="Short circuits" value={`${recovery.shortCircuitedAttempts}`} />
            <Metric label="Circuit trips" value={`${recovery.circuitTrips}`} />
            <Metric label="p95 logical latency" value={formatLatency(recovery.p95LogicalLatencyMs)} />
          </div>

          <div className="recovery-lessons">
            <Lesson
              number="01"
              title="Detection ≠ failure"
              text={`The physical outage begins at 900 ms. ${healthCheckMode === "active" ? "Active checks" : "Passive evidence"} mark it unhealthy at ${formatLatency(recovery.firstFailureDetectionMs)}.`}
            />
            <Lesson
              number="02"
              title="Failover has its own cost"
              text={`Promotion waits another ${failoverDelayMs} ms after detection. During that gap, retries cannot manufacture a healthy active endpoint.`}
            />
            <Lesson
              number="03"
              title="Retries multiply load"
              text={`${recovery.backendAttempts} backend attempts were generated for ${requestCount} logical requests: ${recovery.retryAmplification.toFixed(2)}× backend load.`}
            />
            <Lesson
              number="04"
              title="Breakers bound damage"
              text={breakerEnabled ? `${recovery.shortCircuitedAttempts} attempts were rejected locally while circuits were open, avoiding backend work.` : "The breaker is disabled, so every retry that reaches an active target becomes backend work."}
            />
          </div>

          <div className="trace-panel recovery-trace">
            <div className="section-heading">
              <span>Attempt trace</span>
              <code>first {traceAttempts.length}</code>
            </div>
            <div className="trace-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Attempt</th>
                    <th>Start</th>
                    <th>Node</th>
                    <th>Backend?</th>
                    <th>Result</th>
                    <th>Circuit</th>
                    <th>Retry delay</th>
                  </tr>
                </thead>
                <tbody>
                  {traceAttempts.map((attempt) => (
                    <tr key={`${attempt.requestId}-${attempt.attemptIndex}`}>
                      <td>#{attempt.requestId + 1}</td>
                      <td>{attempt.attemptIndex + 1}</td>
                      <td>{attempt.startMs.toFixed(0)} ms</td>
                      <td>{attempt.nodeId ?? "—"}</td>
                      <td>{attempt.backendAttempt ? "yes" : "no"}</td>
                      <td><span className={attempt.success ? "status-ok" : "status-failed"}>{attempt.success ? "success" : attempt.failureReason}</span></td>
                      <td>{attempt.circuitStateBefore ?? "—"} → {attempt.circuitStateAfter ?? "—"}</td>
                      <td>{attempt.retryDelayMs === null ? "—" : `${attempt.retryDelayMs.toFixed(1)} ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="availability-panel">
        <div>
          <p className="eyebrow">failure domains</p>
          <h2>Replicas only help against failures they do not share.</h2>
          <p>
            A node can be individually reliable while its rack, zone, process, power feed, or control plane remains a
            common-mode dependency. Move the same three replicas across independent domains and compare the composed
            availability.
          </p>
        </div>
        <div className="availability-controls">
          <RangeControl label="Node availability" value={nodeAvailabilityPct} suffix="%" min={95} max={99.99} step={0.01} onChange={setNodeAvailabilityPct} />
          <RangeControl label="Domain availability" value={domainAvailabilityPct} suffix="%" min={90} max={99.99} step={0.01} onChange={setDomainAvailabilityPct} />
        </div>
        <div className="availability-cards">
          <Metric label="3 replicas · one domain" value={`${(sameDomainAvailability * 100).toFixed(5)}%`} />
          <Metric label="3 replicas · three domains" value={`${(separateDomainAvailability * 100).toFixed(5)}%`} />
          <Metric label="Domain spread gain" value={`${((separateDomainAvailability - sameDomainAvailability) * 100).toFixed(5)} pp`} />
        </div>
      </section>

      <section className="election-panel">
        <div className="election-header">
          <div>
            <p className="eyebrow">minimal coordination exhibit</p>
            <h2>Detection permits an election. A term makes the winner authoritative.</h2>
            <p>
              node-1 begins as leader in term 7 and fails at 1000 ms. Followers wait for the election timeout, then a
              deterministic candidate can be promoted only if a majority is still available.
            </p>
          </div>
          <label className="toggle-row election-toggle">
            <input type="checkbox" checked={loseElectionMajority} onChange={(event) => setLoseElectionMajority(event.target.checked)} />
            <span>
              <strong>Lose the majority too</strong>
              <small>Also fail node-2 and node-3 so a five-node cluster has only two reachable voters.</small>
            </span>
          </label>
        </div>

        <div className="election-controls">
          <RangeControl label="Election timeout" value={electionTimeoutMs} suffix=" ms" min={200} max={1200} step={50} onChange={setElectionTimeoutMs} />
          <RangeControl label="Election duration" value={electionDurationMs} suffix=" ms" min={50} max={800} step={50} onChange={setElectionDurationMs} />
        </div>

        <div className="metrics election-metrics">
          <Metric label="Quorum" value={`${election.quorumSize}/5`} />
          <Metric label="Detected" value={formatLatency(election.detectionAtMs)} />
          <Metric label="New leader" value={election.finalLeaderId ?? "none"} />
          <Metric label="Current term" value={`${election.finalTerm}`} />
          <Metric label="Leader unavailable" value={formatLatency(election.leaderUnavailableMs)} />
          <Metric label="Stale writes fenced" value={`${election.fencedStaleWrites}`} />
        </div>

        <div className={`capacity-banner ${election.electionSucceeded ? "" : "capacity-banner-hot"}`}>
          <strong>{election.electionSucceeded ? `${election.finalLeaderId} wins term ${election.finalTerm}.` : "No majority, no new leader."}</strong>
          <span>
            {election.electionSucceeded
              ? "When node-1 later recovers with term 7, its old fencing token is rejected rather than allowing two authoritative leaders."
              : "A coordinator cannot safely promote a new leader from a minority merely to preserve write availability."}
          </span>
        </div>

        <div className="trace-panel election-trace">
          <div className="section-heading">
            <span>Election trace</span>
            <code>term {election.finalTerm}</code>
          </div>
          <div className="trace-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Node</th>
                  <th>Term</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {election.events.map((event, index) => (
                  <tr key={`${event.type}-${event.nodeId}-${event.atMs}-${index}`}>
                    <td>{event.atMs.toFixed(0)} ms</td>
                    <td>{event.type}</td>
                    <td>{event.nodeId ?? "cluster"}</td>
                    <td>{event.term}</td>
                    <td>{event.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="concepts recovery-next">
        <div>
          <p className="eyebrow">next implementation horizon</p>
          <h2>Now compare the model with real processes.</h2>
        </div>
        <p>
          Slice 5 moves selected lessons into native Rust: real localhost servers and clients, a controllable fault
          proxy, measured delay and failure injection, and explicit comparison between the deterministic model and the
          operating system/network observations. The browser simulator remains the explanatory oracle, not a benchmark.
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
        <strong>{formatControlValue(value)}{suffix}</strong>
      </span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TimelineStep({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="timeline-step">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
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
    <article className="lesson recovery-lesson">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function formatLatency(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}

function formatControlValue(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}
