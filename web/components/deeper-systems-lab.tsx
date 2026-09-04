"use client";

import { useMemo, useState } from "react";
import { simulateAdmission, type AdmissionPolicy } from "@/lib/admission-model";
import { simulateCache, type CacheInvalidationMode } from "@/lib/cache-model";
import { simulateCap, type PartitionStrategy } from "@/lib/cap-model";
import { simulateFlow } from "@/lib/flow-model";
import { simulateSharding, type ShardingStrategy } from "@/lib/sharding-model";

export function DeeperSystemsLab() {
  const [cacheMode, setCacheMode] = useState<CacheInvalidationMode>("invalidate-on-write");
  const [cacheCapacity, setCacheCapacity] = useState(3);
  const [cacheTtl, setCacheTtl] = useState(12);
  const [writeEvery, setWriteEvery] = useState(8);

  const [shardingStrategy, setShardingStrategy] = useState<ShardingStrategy>("consistent-hash");
  const [shardNodes, setShardNodes] = useState(3);
  const [virtualNodes, setVirtualNodes] = useState(64);
  const [hotKeyWeight, setHotKeyWeight] = useState(1);

  const [admissionPolicy, setAdmissionPolicy] = useState<AdmissionPolicy>("concurrency-limit");
  const [burstMultiplier, setBurstMultiplier] = useState(6);
  const [backendConcurrency, setBackendConcurrency] = useState(2);
  const [tokenCapacity, setTokenCapacity] = useState(8);

  const [poolSize, setPoolSize] = useState(3);
  const [reuseConnections, setReuseConnections] = useState(true);
  const [fanout, setFanout] = useState(3);
  const [slowEvery, setSlowEvery] = useState(5);

  const [partitionStrategy, setPartitionStrategy] = useState<PartitionStrategy>("quorum-consistency");
  const [replicationLag, setReplicationLag] = useState(3);
  const [quorumLatency, setQuorumLatency] = useState(80);

  const cache = useMemo(
    () =>
      simulateCache({
        requestCount: 40,
        cacheCapacity,
        ttlOperations: cacheTtl,
        invalidationMode: cacheMode,
        writeEvery,
        cacheLatencyMs: 1,
        originLatencyMs: 20,
      }),
    [cacheCapacity, cacheMode, cacheTtl, writeEvery],
  );

  const sharding = useMemo(
    () =>
      simulateSharding({
        keyCount: 1000,
        nodeCount: shardNodes,
        virtualNodesPerNode: virtualNodes,
        strategy: shardingStrategy,
        hotKeyWeight,
      }),
    [hotKeyWeight, shardNodes, shardingStrategy, virtualNodes],
  );

  const admission = useMemo(
    () =>
      simulateAdmission({
        requestCount: 120,
        baseRequestsPerSecond: 20,
        burstMultiplier,
        serviceTimeMs: 80,
        backendConcurrency,
        policy: admissionPolicy,
        tokenCapacity,
        tokenRefillPerSecond: 20,
      }),
    [admissionPolicy, backendConcurrency, burstMultiplier, tokenCapacity],
  );

  const flow = useMemo(
    () =>
      simulateFlow({
        parentRequests: 20,
        fanout,
        poolSize,
        normalServiceMs: 10,
        slowServiceMs: 120,
        slowEvery,
        handshakeMs: 15,
        reuseConnections,
        parentArrivalIntervalMs: 20,
      }),
    [fanout, poolSize, reuseConnections, slowEvery],
  );

  const cap = useMemo(
    () =>
      simulateCap({
        operationCount: 60,
        operationsPerSecond: 10,
        strategy: partitionStrategy,
        localLatencyMs: 12,
        quorumLatencyMs: quorumLatency,
        asyncReplicationLagOperations: replicationLag,
        partitionStartOperation: 20,
        partitionEndOperation: 40,
      }),
    [partitionStrategy, quorumLatency, replicationLag],
  );

  return (
    <main className="systems-lab">
      <header className="systems-hero">
        <div>
          <p className="eyebrow">server-lab · slice 6</p>
          <h1>Deeper systems behavior, without hiding the mechanism.</h1>
          <p className="lede">
            These exhibits stay deliberately small. Change one systems choice and inspect the concrete consequence:
            cache staleness, shard movement, rejected load, queueing behind slow work, or consistency lost during a partition.
          </p>
        </div>
        <div className="systems-boundary">
          <strong>Deterministic teaching models.</strong>
          <span>
            Real socket timing belongs to the Native experiments lesson. These models exist to make comparisons reproducible.
          </span>
        </div>
      </header>

      <SystemSection
        eyebrow="01 · caching"
        title="A cache buys latency by accepting invalidation complexity."
        summary="Compare write invalidation with TTL-only freshness. The workload has repeated hot/warm keys, periodic writes, and deterministic LRU eviction."
        controls={
          <>
            <SelectControl
              label="Invalidation"
              value={cacheMode}
              onChange={(value) => setCacheMode(value as CacheInvalidationMode)}
              options={[
                ["invalidate-on-write", "Invalidate on write"],
                ["ttl-only", "TTL only"],
              ]}
            />
            <RangeControl label="Cache capacity" value={cacheCapacity} min={0} max={6} step={1} onChange={setCacheCapacity} />
            <RangeControl label="TTL" value={cacheTtl} suffix=" ops" min={2} max={40} step={1} onChange={setCacheTtl} />
            <RangeControl label="Write every" value={writeEvery} suffix=" ops" min={0} max={16} step={1} onChange={setWriteEvery} />
          </>
        }
      >
        <MetricGrid>
          <Metric label="Hit rate" value={percent(cache.hitRate)} />
          <Metric label="Stale reads" value={String(cache.staleReads)} />
          <Metric label="Origin fetches" value={String(cache.originFetches)} />
          <Metric label="Mean read latency" value={ms(cache.meanReadLatencyMs)} />
          <Metric label="Invalidations" value={String(cache.invalidations)} />
          <Metric label="LRU evictions" value={String(cache.evictions)} />
        </MetricGrid>
        <TraceTable
          headers={["Op", "Type", "Key", "Cache", "Origin", "Result", "Latency"]}
          rows={cache.operations.slice(0, 12).map((operation) => [
            `#${operation.index + 1}`,
            operation.type,
            operation.key,
            operation.cacheVersion === null ? "—" : `v${operation.cacheVersion}`,
            `v${operation.originVersion}`,
            operation.type === "write" ? "write" : operation.hit ? (operation.stale ? "stale hit" : "hit") : "miss",
            `${operation.latencyMs.toFixed(0)} ms`,
          ])}
        />
      </SystemSection>

      <SystemSection
        eyebrow="02 · sharding"
        title="Consistent hashing reduces movement; it does not eliminate hot keys."
        summary="Add one shard and compare how many keys move. Then increase one key's request weight to see why balanced key counts can still hide a load hotspot."
        controls={
          <>
            <SelectControl
              label="Placement"
              value={shardingStrategy}
              onChange={(value) => setShardingStrategy(value as ShardingStrategy)}
              options={[
                ["consistent-hash", "Consistent hash ring"],
                ["modulo", "Modulo hash"],
              ]}
            />
            <RangeControl label="Starting nodes" value={shardNodes} min={2} max={8} step={1} onChange={setShardNodes} />
            <RangeControl label="Virtual nodes" value={virtualNodes} min={8} max={128} step={8} onChange={setVirtualNodes} />
            <RangeControl label="Hot key weight" value={hotKeyWeight} suffix="×" min={1} max={500} step={25} onChange={setHotKeyWeight} />
          </>
        }
      >
        <MetricGrid>
          <Metric label="Keys moved" value={`${sharding.movedKeys}/1000`} />
          <Metric label="Movement" value={percent(sharding.movedFraction)} />
          <Metric label="Load imbalance" value={`${sharding.imbalanceRatio.toFixed(2)}×`} />
          <Metric label="Hot key owner" value={sharding.hotKeyNode} />
        </MetricGrid>
        <div className="systems-node-grid">
          {sharding.after.map((node) => (
            <article key={node.nodeId} className="systems-node-card">
              <strong>{node.nodeId}</strong>
              <span>{node.keys} keys</span>
              <span>{node.weightedRequests.toFixed(0)} weighted requests</span>
              <div className="systems-load-bar">
                <span style={{ width: `${(node.weightedRequests / Math.max(1, sharding.maxWeightedLoad)) * 100}%` }} />
              </div>
            </article>
          ))}
        </div>
      </SystemSection>

      <SystemSection
        eyebrow="03 · admission control"
        title="Rate limiting protects different things from concurrency limiting."
        summary="The middle of the trace is a deterministic burst. Token buckets shape request rate; concurrency admission protects the backend's simultaneous-work envelope."
        controls={
          <>
            <SelectControl
              label="Policy"
              value={admissionPolicy}
              onChange={(value) => setAdmissionPolicy(value as AdmissionPolicy)}
              options={[
                ["concurrency-limit", "Concurrency limit"],
                ["token-bucket", "Token bucket"],
                ["none", "No admission control"],
              ]}
            />
            <RangeControl label="Burst multiplier" value={burstMultiplier} suffix="×" min={1} max={10} step={1} onChange={setBurstMultiplier} />
            <RangeControl label="Backend concurrency" value={backendConcurrency} min={1} max={8} step={1} onChange={setBackendConcurrency} />
            <RangeControl label="Bucket capacity" value={tokenCapacity} min={1} max={30} step={1} onChange={setTokenCapacity} />
          </>
        }
      >
        <MetricGrid>
          <Metric label="Admitted" value={`${admission.admitted}/${admission.offered}`} />
          <Metric label="Rejected" value={String(admission.rejected)} />
          <Metric label="Peak in-flight" value={String(admission.peakInFlight)} />
          <Metric label="Over-envelope admits" value={String(admission.overCapacityAdmissions)} />
          <Metric label="Nominal capacity" value={`${admission.nominalCapacityPerSecond.toFixed(1)}/s`} />
          <Metric label="Measured offered" value={`${admission.measuredOfferedRatePerSecond.toFixed(1)}/s`} />
        </MetricGrid>
        <div className="systems-pill-row">
          {admission.requests.slice(36, 56).map((request) => (
            <span key={request.requestId} className={request.admitted ? "systems-pill-ok" : "systems-pill-drop"}>
              {request.admitted ? "admit" : "reject"}
            </span>
          ))}
        </div>
      </SystemSection>

      <SystemSection
        eyebrow="04 · pools, fan-out & HOL"
        title="A slow child becomes everyone else's problem when the pool is narrow."
        summary="Each parent request fans out into child work sharing a connection pool. Slow children occupy a connection longer; FIFO scheduling turns that into head-of-line queueing for later work."
        controls={
          <>
            <RangeControl label="Connection pool" value={poolSize} min={1} max={8} step={1} onChange={setPoolSize} />
            <RangeControl label="Fan-out" value={fanout} min={1} max={6} step={1} onChange={setFanout} />
            <RangeControl label="Slow every" value={slowEvery} suffix=" children" min={0} max={12} step={1} onChange={setSlowEvery} />
            <label className="systems-toggle">
              <input type="checkbox" checked={reuseConnections} onChange={(event) => setReuseConnections(event.target.checked)} />
              <span>Reuse connections</span>
            </label>
          </>
        }
      >
        <MetricGrid>
          <Metric label="Parent p95" value={ms(flow.p95ParentLatencyMs)} />
          <Metric label="Mean queue delay" value={ms(flow.meanQueueDelayMs)} />
          <Metric label="p95 queue delay" value={ms(flow.p95QueueDelayMs)} />
          <Metric label="Max queue delay" value={`${flow.maxQueueDelayMs.toFixed(1)} ms`} />
          <Metric label="Handshakes" value={String(flow.handshakes)} />
          <Metric label="Slow children" value={`${flow.slowChildren}/${flow.totalChildren}`} />
        </MetricGrid>
        <TraceTable
          headers={["Parent", "Child", "Conn", "Start", "Queue", "Service", "Done"]}
          rows={flow.children.slice(0, 12).map((child) => [
            `#${child.parentId + 1}`,
            String(child.childId + 1),
            String(child.connectionId + 1),
            `${child.startMs.toFixed(0)} ms`,
            `${child.queueDelayMs.toFixed(0)} ms`,
            child.slow ? `${child.serviceMs} ms slow` : `${child.serviceMs} ms`,
            `${child.completionMs.toFixed(0)} ms`,
          ])}
        />
      </SystemSection>

      <SystemSection
        eyebrow="05 · CAP / PACELC"
        title="Partition choices are operation outcomes, not acronyms."
        summary="Two regions alternate reads and writes. Operations 21–40 are partitioned. Quorum mode rejects the isolated side; local mode keeps serving, then pays in stale/divergent state and reconciliation."
        controls={
          <>
            <SelectControl
              label="Strategy"
              value={partitionStrategy}
              onChange={(value) => setPartitionStrategy(value as PartitionStrategy)}
              options={[
                ["quorum-consistency", "Quorum / consistency"],
                ["local-availability", "Local / availability"],
              ]}
            />
            <RangeControl label="Async lag" value={replicationLag} suffix=" ops" min={0} max={8} step={1} onChange={setReplicationLag} />
            <RangeControl label="Quorum latency" value={quorumLatency} suffix=" ms" min={20} max={180} step={10} onChange={setQuorumLatency} />
          </>
        }
      >
        <MetricGrid>
          <Metric label="Availability" value={percent(cap.availability)} />
          <Metric label="Failed ops" value={String(cap.failedOperations)} />
          <Metric label="Mean latency" value={ms(cap.meanLatencyMs)} />
          <Metric label="Stale reads" value={String(cap.staleReads)} />
          <Metric label="Divergent writes" value={String(cap.divergentWrites)} />
          <Metric label="Reconciliation" value={String(cap.reconciliationWrites)} />
        </MetricGrid>
        <TraceTable
          headers={["Op", "Region", "Type", "Network", "Result", "Observed", "Newest"]}
          rows={cap.operations.slice(16, 44).map((operation) => [
            `#${operation.index + 1}`,
            operation.region,
            operation.type,
            operation.partitioned ? "partition" : "healthy",
            operation.success ? (operation.divergent ? "divergent" : operation.stale ? "stale" : "success") : "rejected",
            operation.observedVersion === null ? "—" : `v${operation.observedVersion}`,
            `v${operation.newestVersion}`,
          ])}
        />
      </SystemSection>

      <section className="systems-next">
        <div>
          <p className="eyebrow">slice 6 boundary</p>
          <h2>These are mechanisms, not production implementations.</h2>
        </div>
        <p>
          The next useful native depth is OS-level network emulation—packet loss, reordering, jitter, and congestion—plus multi-process cache/shard experiments. Production-grade cache, rate-limit, or consensus kernels should only be extracted after those experiments prove a reusable owner is justified.
        </p>
      </section>
    </main>
  );
}

function SystemSection({
  eyebrow,
  title,
  summary,
  controls,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  controls: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="systems-section">
      <div className="systems-section-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{summary}</p>
        </div>
        <div className="systems-controls">{controls}</div>
      </div>
      <div className="systems-results">{children}</div>
    </section>
  );
}

function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="systems-metrics">{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
    <label className="systems-control">
      <span>
        {label}
        <strong>{value}{suffix}</strong>
      </span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="systems-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option value={optionValue} key={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function TraceTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="systems-table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, columnIndex) => <td key={`${rowIndex}-${columnIndex}`}>{value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}
