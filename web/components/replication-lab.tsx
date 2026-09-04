"use client";

import { useMemo, useState } from "react";
import {
  simulateReplication,
  type ReadConsistency,
  type ReplicationMode,
} from "@/lib/replication";

const modeLabels: Record<ReplicationMode, string> = {
  asynchronous: "Async · leader ack",
  quorum: "Majority quorum",
  synchronous: "Sync · all replicas",
};

const readLabels: Record<ReadConsistency, string> = {
  eventual: "Eventual follower read",
  leader: "Leader read",
  "read-your-writes": "Read your writes",
  quorum: "Read quorum",
};

const operationCount = 24;

export function ReplicationLab() {
  const [replicaCount, setReplicaCount] = useState(3);
  const [replicationMode, setReplicationMode] = useState<ReplicationMode>("asynchronous");
  const [readConsistency, setReadConsistency] = useState<ReadConsistency>("eventual");
  const [replicationDelayMs, setReplicationDelayMs] = useState(220);
  const [replicationJitterMs, setReplicationJitterMs] = useState(20);
  const [operationIntervalMs, setOperationIntervalMs] = useState(90);
  const [writeEvery, setWriteEvery] = useState(4);
  const [writeTimeoutMs, setWriteTimeoutMs] = useState(450);
  const [readTimeoutMs, setReadTimeoutMs] = useState(300);
  const [partitionFollower, setPartitionFollower] = useState(false);
  const [seed, setSeed] = useState(17);

  const configuration = useMemo(() => {
    const nominalDurationMs = Math.max(1, (operationCount - 1) * operationIntervalMs);
    return {
      replicaCount,
      replicationMode,
      readConsistency,
      replicationDelayMs,
      replicationJitterMs,
      writeTimeoutMs,
      readTimeoutMs,
      operationCount,
      operationIntervalMs,
      writeEvery,
      seed,
      partition: partitionFollower
        ? {
            replicaId: `replica-${replicaCount - 1}`,
            startMs: nominalDurationMs * 0.28,
            endMs: nominalDurationMs * 0.72,
          }
        : undefined,
    };
  }, [
    operationIntervalMs,
    partitionFollower,
    readConsistency,
    readTimeoutMs,
    replicaCount,
    replicationDelayMs,
    replicationJitterMs,
    replicationMode,
    seed,
    writeEvery,
    writeTimeoutMs,
  ]);

  const result = useMemo(() => simulateReplication(configuration), [configuration]);

  function applyPreset(preset: "eventual" | "session" | "quorum" | "partition") {
    setReplicaCount(3);
    setReplicationDelayMs(220);
    setReplicationJitterMs(0);
    setOperationIntervalMs(90);
    setWriteEvery(4);
    setWriteTimeoutMs(450);
    setReadTimeoutMs(300);
    setPartitionFollower(false);

    if (preset === "eventual") {
      setReplicationMode("asynchronous");
      setReadConsistency("eventual");
      return;
    }

    if (preset === "session") {
      setReplicationMode("asynchronous");
      setReadConsistency("read-your-writes");
      return;
    }

    if (preset === "quorum") {
      setReplicationMode("quorum");
      setReadConsistency("quorum");
      setReplicationDelayMs(140);
      return;
    }

    setReplicationMode("quorum");
    setReadConsistency("quorum");
    setReplicationDelayMs(140);
    setPartitionFollower(true);
  }

  return (
    <section className="replication-lab" aria-labelledby="replication-heading">
      <div className="replication-header">
        <div>
          <p className="eyebrow">slice 3 · replication semantics</p>
          <h2 id="replication-heading">A replica can be healthy and still be wrong for this read.</h2>
          <p>
            Writes advance a versioned value on one leader. Followers receive that version later. Change the acknowledgement
            and read rules to see when latency buys consistency, when quorums preserve progress, and when partitions expose
            stale state.
          </p>
        </div>
        <div className="replication-callout">
          <strong>One logical value, explicit versions.</strong>
          <span>
            This is a teaching model for visibility and acknowledgement semantics, not a database or consensus protocol.
          </span>
        </div>
      </div>

      <div className="replication-shell">
        <aside className="replication-controls">
          <div className="section-heading">
            <span>Consistency controls</span>
            <code>seed {seed}</code>
          </div>

          <div className="replication-presets" aria-label="Replication scenario presets">
            <button type="button" onClick={() => applyPreset("eventual")}>Eventual</button>
            <button type="button" onClick={() => applyPreset("session")}>Session</button>
            <button type="button" onClick={() => applyPreset("quorum")}>Quorum</button>
            <button type="button" onClick={() => applyPreset("partition")}>Partition</button>
          </div>

          <label>
            Write acknowledgement
            <select
              value={replicationMode}
              onChange={(event) => setReplicationMode(event.target.value as ReplicationMode)}
            >
              {Object.entries(modeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Read consistency
            <select
              value={readConsistency}
              onChange={(event) => setReadConsistency(event.target.value as ReadConsistency)}
            >
              {Object.entries(readLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <ReplicationRange label="Total nodes" value={replicaCount} min={2} max={5} step={1} onChange={setReplicaCount} />
          <ReplicationRange
            label="Replication delay"
            value={replicationDelayMs}
            suffix=" ms"
            min={0}
            max={600}
            step={10}
            onChange={setReplicationDelayMs}
          />
          <ReplicationRange
            label="Replication jitter"
            value={replicationJitterMs}
            suffix=" ms"
            min={0}
            max={180}
            step={10}
            onChange={setReplicationJitterMs}
          />
          <ReplicationRange
            label="Operation interval"
            value={operationIntervalMs}
            suffix=" ms"
            min={30}
            max={300}
            step={10}
            onChange={setOperationIntervalMs}
          />
          <ReplicationRange
            label="Write every"
            value={writeEvery}
            suffix=" ops"
            min={2}
            max={8}
            step={1}
            onChange={setWriteEvery}
          />
          <ReplicationRange
            label="Write timeout"
            value={writeTimeoutMs}
            suffix=" ms"
            min={50}
            max={1200}
            step={50}
            onChange={setWriteTimeoutMs}
          />
          <ReplicationRange
            label="Session read timeout"
            value={readTimeoutMs}
            suffix=" ms"
            min={0}
            max={800}
            step={25}
            onChange={setReadTimeoutMs}
          />

          <label className="toggle-row replication-toggle">
            <input
              type="checkbox"
              checked={partitionFollower}
              onChange={(event) => setPartitionFollower(event.target.checked)}
            />
            <span>
              <strong>Partition the last follower</strong>
              <small>The client can still read it, but its replication link to the leader is cut during the middle of the trace.</small>
            </span>
          </label>

          <label>
            Seed
            <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 0)} />
          </label>
        </aside>

        <div className="replication-experiment">
          <div className="replication-topology">
            <div className="replication-leader">
              <span>write owner</span>
              <strong>leader</strong>
              <code>v{result.finalCommittedVersion}</code>
            </div>
            <div className="replication-link">
              <strong>{modeLabels[replicationMode]}</strong>
              <span>{replicationDelayMs} ms base replication delay</span>
              {partitionFollower ? <em>one follower link partitioned mid-trace</em> : null}
            </div>
            <div className="replication-replicas">
              {result.replicaMetrics.filter((replica) => replica.role === "replica").map((replica) => (
                <article key={replica.nodeId} className={replica.lagVersions > 0 ? "replica-state replica-state-lagging" : "replica-state"}>
                  <div>
                    <strong>{replica.nodeId}</strong>
                    <code>v{replica.appliedVersion}</code>
                  </div>
                  <span>lag {replica.lagVersions} · max {replica.maxLagVersions} versions</span>
                  <small>{replica.pendingUpdates} replication update{replica.pendingUpdates === 1 ? "" : "s"} pending</small>
                </article>
              ))}
            </div>
          </div>

          <div className="replication-metrics">
            <ReplicationMetric label="Committed version" value={`v${result.finalCommittedVersion}`} />
            <ReplicationMetric label="Writes" value={`${result.successfulWrites} ok · ${result.failedWrites} failed`} />
            <ReplicationMetric label="Stale reads" value={`${result.staleReads}/${result.successfulReads}`} />
            <ReplicationMetric label="Stale rate" value={`${(result.staleReadRate * 100).toFixed(1)}%`} />
            <ReplicationMetric label="Mean write ack" value={formatMs(result.meanWriteAckLatencyMs)} />
            <ReplicationMetric label="Mean read wait" value={formatMs(result.meanReadWaitMs)} />
            <ReplicationMetric label="Max replica lag" value={`${result.maxReplicaLagVersions} versions`} />
            <ReplicationMetric label="Quorum" value={`${result.quorumSize}/${replicaCount}`} />
          </div>

          <div className="replication-lessons">
            <ReplicationLesson
              title="Async vs. sync"
              text={
                replicationMode === "asynchronous"
                  ? "The leader acknowledges immediately, so followers can trail an acknowledged write. Lower write latency is bought with a stale-read window."
                  : replicationMode === "synchronous"
                    ? "The client waits for every follower. Reads begin after all copies acknowledge, but one slow or partitioned follower can consume the write timeout."
                    : "The client waits only for a majority. One lagging or partitioned follower can be bypassed while the acknowledged write still intersects a later read quorum."
              }
            />
            <ReplicationLesson
              title="Read semantics"
              text={
                readConsistency === "eventual"
                  ? `Follower reads returned stale state ${result.staleReads} times in this trace.`
                  : readConsistency === "leader"
                    ? "Every read goes to the write owner, avoiding replica staleness at the cost of concentrating reads on the leader."
                    : readConsistency === "read-your-writes"
                      ? `The session waits or falls back to the leader so an acknowledged own write is not forgotten. Leader fallback happened ${result.leaderFallbackReads} times.`
                      : "Each read compares a majority and takes the newest observed version. With quorum writes, read and write majorities must overlap."
              }
            />
            <ReplicationLesson
              title="Replica lag"
              text={`The worst follower fell ${result.maxReplicaLagVersions} version${result.maxReplicaLagVersions === 1 ? "" : "s"} behind. Lag is state divergence, not merely request latency.`}
            />
            <ReplicationLesson
              title="Partitions"
              text={
                partitionFollower
                  ? "The isolated follower remains readable by the client while replication is cut. This makes stale-but-responsive behavior visible instead of treating every partition as a dead server."
                  : "Enable the follower partition or choose the Partition preset. Then compare sync-all with majority quorum acknowledgement."
              }
            />
          </div>

          <div className="replication-trace">
            <div className="section-heading">
              <span>Consistency trace</span>
              <code>first 16 of {result.operations.length}</code>
            </div>
            <div className="trace-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Op</th>
                    <th>Start</th>
                    <th>Kind</th>
                    <th>Target</th>
                    <th>Version</th>
                    <th>Wait</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {result.operations.slice(0, 16).map((operation) => (
                    <tr key={operation.operationId}>
                      <td>#{operation.operationId + 1}</td>
                      <td>{operation.startedAtMs.toFixed(0)} ms</td>
                      <td>{operation.kind}</td>
                      <td>{operation.targetNodeIds.join(" + ")}</td>
                      <td>{operation.version === null ? "—" : `v${operation.version}`}</td>
                      <td>{operation.waitMs.toFixed(0)} ms</td>
                      <td>
                        <span className={operation.success && !operation.stale ? "status-ok" : "status-failed"}>
                          {!operation.success
                            ? operation.failureReason
                            : operation.stale
                              ? "stale"
                              : operation.fallbackToLeader
                                ? "leader fallback"
                                : operation.partitionedReplicaIds.length > 0
                                  ? "partition active"
                                  : "current"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReplicationRange({
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
        <strong>{value}{suffix}</strong>
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

function ReplicationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="replication-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReplicationLesson({ title, text }: { title: string; text: string }) {
  return (
    <article>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}
