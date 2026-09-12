"use client";

import { useMemo, useState } from "react";
import {
  generateRoomWorkload,
  placeFleet,
  type RegionCapacity,
} from "@/lib/fleet-placement";
import { GLOBAL_REGIONS } from "@/lib/global-ingress";
import {
  buildServerTopology,
  compareHostFailure,
  type RegionOwnedRoom,
  type ServerDistributionPolicy,
} from "@/lib/server-distribution";

const POLICY_LABELS: Record<ServerDistributionPolicy, string> = {
  "round-robin": "Round robin",
  "least-loaded": "Least loaded",
  rendezvous: "Rendezvous hashing",
  "power-of-two": "Power of two choices",
};

function regionLabel(regionId: string) {
  return GLOBAL_REGIONS.find((region) => region.id === regionId)?.location ?? regionId;
}

export function ServerDistributionLab() {
  const [policy, setPolicy] =
    useState<ServerDistributionPolicy>("rendezvous");
  const [capacityUnitsPerProcess, setCapacityUnitsPerProcess] = useState(60);
  const [failedHostId, setFailedHostId] = useState("eu-central-host-a");

  const topology = useMemo(
    () => buildServerTopology(capacityUnitsPerProcess),
    [capacityUnitsPerProcess],
  );

  const comparison = useMemo(() => {
    const regionalCapacity: RegionCapacity[] = GLOBAL_REGIONS.map((region) => ({
      regionId: region.id,
      capacityUnits: 200,
      healthy: true,
    }));
    const regional = placeFleet(
      "load-aware",
      generateRoomWorkload(72, "balanced"),
      regionalCapacity,
    );
    const rooms: RegionOwnedRoom[] = regional.rooms.flatMap((room) =>
      room.regionId
        ? [
            {
              roomId: room.roomId,
              regionId: room.regionId,
              demandUnits: room.demandUnits,
            },
          ]
        : [],
    );
    return compareHostFailure(policy, rooms, topology, failedHostId);
  }, [failedHostId, policy, topology]);

  const failureByRoom = new Map(
    comparison.failure.assignments.map((assignment) => [
      assignment.roomId,
      assignment,
    ]),
  );

  return (
    <section className="global-lab" aria-labelledby="server-distribution-heading">
      <div className="global-section-heading">
        <div>
          <p className="eyebrow">server-lab · slice 9</p>
          <h3 id="server-distribution-heading">Region → host → process distribution</h3>
        </div>
        <p>
          Regional authority is already fixed. This layer only decides which
          healthy process inside that region owns the room.
        </p>
      </div>

      <section className="global-shell">
        <div className="global-controls">
          <div>
            <p className="eyebrow">scheduler controls</p>
            <h2>Process distribution</h2>
          </div>

          <label>
            Algorithm
            <select
              value={policy}
              onChange={(event) =>
                setPolicy(event.target.value as ServerDistributionPolicy)
              }
            >
              {Object.entries(POLICY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="global-range-label">
              Capacity per process <strong>{capacityUnitsPerProcess} units</strong>
            </span>
            <input
              type="range"
              min={20}
              max={100}
              step={10}
              value={capacityUnitsPerProcess}
              onChange={(event) =>
                setCapacityUnitsPerProcess(Number(event.target.value))
              }
            />
          </label>

          <label>
            Failed host
            <select
              value={failedHostId}
              onChange={(event) => setFailedHostId(event.target.value)}
            >
              {topology
                .filter(
                  (process, index, all) =>
                    all.findIndex((candidate) => candidate.hostId === process.hostId) ===
                    index,
                )
                .map((process) => (
                  <option key={process.hostId} value={process.hostId}>
                    {regionLabel(process.regionId)} · {process.hostId}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="global-results">
          <p className="global-summary">
            <strong>{POLICY_LABELS[policy]}.</strong>{" "}
            Host failure forces {comparison.forcedMoves} room moves. The scheduler
            causes {comparison.extraMoves} additional moves on healthy hosts and
            leaves {comparison.rejectedAfterFailure} rooms without enough
            region-local process capacity.
          </p>

          <div>
            <div className="global-section-heading">
              <h3>Process topology</h3>
              <p>A host is the initial failure-domain boundary.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Host</th>
                    <th>Process</th>
                    <th>Baseline load</th>
                    <th>After host failure</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.baseline.processes.map((process) => {
                    const failed = comparison.failure.processes.find(
                      (candidate) => candidate.processId === process.processId,
                    );
                    return (
                      <tr key={process.processId}>
                        <td>{regionLabel(process.regionId)}</td>
                        <td>{process.hostId}</td>
                        <td>{process.processId}</td>
                        <td>
                          {process.usedUnits}/{process.capacityUnits} ({(process.utilization * 100).toFixed(0)}%)
                        </td>
                        <td>
                          {failed?.healthy
                            ? `${failed.usedUnits}/${failed.capacityUnits} (${(failed.utilization * 100).toFixed(0)}%)`
                            : "unavailable"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="global-section-heading">
              <h3>Assignment churn sample</h3>
              <p>Cross-region spill is forbidden even when local capacity is exhausted.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Region authority</th>
                    <th>Baseline process</th>
                    <th>After failure</th>
                    <th>Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.baseline.assignments.slice(0, 20).map((assignment) => {
                    const next = failureByRoom.get(assignment.roomId);
                    const changed = assignment.processId !== next?.processId;
                    const classification = !changed
                      ? "unchanged"
                      : assignment.hostId === failedHostId
                        ? "forced move"
                        : "cascade churn";
                    return (
                      <tr key={assignment.roomId}>
                        <td>{assignment.roomId}</td>
                        <td>{regionLabel(assignment.regionId)}</td>
                        <td>{assignment.processId ?? "rejected"}</td>
                        <td>{next?.processId ?? "rejected"}</td>
                        <td>{classification}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="global-explanation">
            <h3>Possible fleet-scheduler boundary</h3>
            <p>
              This layer is intentionally infrastructure-shaped: discovered process
              topology, health, drain state, capacity, failure-domain identity, and a
              stable workload id go in; one deterministic target process comes out.
              <code>game-server</code> can expose those process facts, while <code>server-setup</code>
              remains responsible for host facts and prerequisites rather than application placement.
              Provisioning and deployment orchestration are still outside the model.
            </p>
          </div>
        </div>
      </section>
    </section>
  );
}
