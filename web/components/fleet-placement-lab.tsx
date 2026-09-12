"use client";

import { useMemo, useState } from "react";
import {
  compareRegionFailure,
  generateRoomWorkload,
  type FleetPlacementPolicy,
  type RegionCapacity,
} from "@/lib/fleet-placement";
import {
  GLOBAL_REGIONS,
  type GlobalRegionId,
  type TrafficProfile,
} from "@/lib/global-ingress";

const POLICY_LABELS: Record<FleetPlacementPolicy, string> = {
  "min-average-rtt": "Minimum average RTT",
  "min-worst-rtt": "Minimum worst-player RTT",
  "load-aware": "Latency + current load",
  rendezvous: "Rendezvous hashing",
  "power-of-two": "Power of two choices",
};

function regionLabel(regionId: GlobalRegionId) {
  return GLOBAL_REGIONS.find((region) => region.id === regionId)?.location ?? regionId;
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}

export function FleetPlacementLab() {
  const [policy, setPolicy] = useState<FleetPlacementPolicy>("load-aware");
  const [trafficProfile, setTrafficProfile] = useState<TrafficProfile>("balanced");
  const [roomCount, setRoomCount] = useState(60);
  const [capacityUnits, setCapacityUnits] = useState(100);
  const [failedRegionId, setFailedRegionId] =
    useState<GlobalRegionId>("us-east");

  const comparison = useMemo(() => {
    const rooms = generateRoomWorkload(roomCount, trafficProfile);
    const capacities: RegionCapacity[] = GLOBAL_REGIONS.map((region) => ({
      regionId: region.id,
      capacityUnits,
      healthy: true,
    }));
    return compareRegionFailure(policy, rooms, capacities, failedRegionId);
  }, [capacityUnits, failedRegionId, policy, roomCount, trafficProfile]);

  const failureByRoom = new Map(
    comparison.failure.rooms.map((room) => [room.roomId, room]),
  );

  return (
    <section className="global-lab" aria-labelledby="fleet-placement-heading">
      <div className="global-section-heading">
        <div>
          <p className="eyebrow">server-lab · slice 8</p>
          <h3 id="fleet-placement-heading">Multi-region fleet placement</h3>
        </div>
        <p>
          Compare latency, load, and stability across many rooms instead of choosing
          one region for one room in isolation.
        </p>
      </div>

      <section className="global-shell">
        <div className="global-controls">
          <div>
            <p className="eyebrow">fleet controls</p>
            <h2>Placement policy</h2>
          </div>

          <label>
            Algorithm
            <select
              value={policy}
              onChange={(event) =>
                setPolicy(event.target.value as FleetPlacementPolicy)
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
            Traffic profile
            <select
              value={trafficProfile}
              onChange={(event) =>
                setTrafficProfile(event.target.value as TrafficProfile)
              }
            >
              <option value="balanced">Balanced</option>
              <option value="europe-heavy">Europe-heavy</option>
              <option value="asia-heavy">Asia-heavy</option>
            </select>
          </label>

          <label>
            <span className="global-range-label">
              Rooms <strong>{roomCount}</strong>
            </span>
            <input
              type="range"
              min={12}
              max={120}
              step={12}
              value={roomCount}
              onChange={(event) => setRoomCount(Number(event.target.value))}
            />
          </label>

          <label>
            <span className="global-range-label">
              Capacity per region <strong>{capacityUnits} units</strong>
            </span>
            <input
              type="range"
              min={40}
              max={180}
              step={10}
              value={capacityUnits}
              onChange={(event) => setCapacityUnits(Number(event.target.value))}
            />
          </label>

          <label>
            Failed region
            <select
              value={failedRegionId}
              onChange={(event) =>
                setFailedRegionId(event.target.value as GlobalRegionId)
              }
            >
              {GLOBAL_REGIONS.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.location}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="global-results">
          <p className="global-summary">
            <strong>{POLICY_LABELS[policy]}.</strong>{" "}
            The baseline assigns {comparison.baseline.assignedRooms} rooms and rejects{" "}
            {comparison.baseline.rejectedRooms}. After {regionLabel(failedRegionId)} fails,
            {" "}{comparison.forcedMoves} moves are unavoidable, {comparison.extraMoves} are
            additional cascade churn, and {comparison.rejectedAfterFailure} rooms cannot be
            placed within remaining capacity.
          </p>

          <div>
            <div className="global-section-heading">
              <h3>Outcome comparison</h3>
              <p>Latency values are deterministic teaching constants, not measurements.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Assigned rooms</th>
                    <th>Rejected rooms</th>
                    <th>Mean player RTT</th>
                    <th>Worst player RTT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>All regions healthy</td>
                    <td>{comparison.baseline.assignedRooms}</td>
                    <td>{comparison.baseline.rejectedRooms}</td>
                    <td>{formatMs(comparison.baseline.meanPlayerRttMs)}</td>
                    <td>{formatMs(comparison.baseline.worstPlayerRttMs)}</td>
                  </tr>
                  <tr>
                    <td>{regionLabel(failedRegionId)} unavailable</td>
                    <td>{comparison.failure.assignedRooms}</td>
                    <td>{comparison.failure.rejectedRooms}</td>
                    <td>{formatMs(comparison.failure.meanPlayerRttMs)}</td>
                    <td>{formatMs(comparison.failure.worstPlayerRttMs)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="global-section-heading">
              <h3>Regional load</h3>
              <p>Hard capacity is always respected; placement fails closed when it cannot fit.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Baseline rooms</th>
                    <th>Baseline load</th>
                    <th>After failure rooms</th>
                    <th>After failure load</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.baseline.regions.map((baselineRegion) => {
                    const failedRegion = comparison.failure.regions.find(
                      (candidate) => candidate.regionId === baselineRegion.regionId,
                    );
                    return (
                      <tr key={baselineRegion.regionId}>
                        <td>{regionLabel(baselineRegion.regionId)}</td>
                        <td>{baselineRegion.roomCount}</td>
                        <td>
                          {baselineRegion.usedUnits}/{baselineRegion.capacityUnits} ({(baselineRegion.utilization * 100).toFixed(0)}%)
                        </td>
                        <td>{failedRegion?.healthy ? failedRegion.roomCount : "down"}</td>
                        <td>
                          {failedRegion?.healthy
                            ? `${failedRegion.usedUnits}/${failedRegion.capacityUnits} (${(failedRegion.utilization * 100).toFixed(0)}%)`
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
              <h3>Ownership churn sample</h3>
              <p>First 18 rooms; movement outside the failed region is avoidable churn.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Demand</th>
                    <th>Baseline owner</th>
                    <th>After failure</th>
                    <th>Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.baseline.rooms.slice(0, 18).map((room) => {
                    const next = failureByRoom.get(room.roomId);
                    const changed = room.regionId !== next?.regionId;
                    const classification = !changed
                      ? "unchanged"
                      : room.regionId === failedRegionId
                        ? "forced move"
                        : "cascade churn";
                    return (
                      <tr key={room.roomId}>
                        <td>{room.roomId}</td>
                        <td>{room.demandUnits}</td>
                        <td>{room.regionId ? regionLabel(room.regionId) : "rejected"}</td>
                        <td>{next?.regionId ? regionLabel(next.regionId) : "rejected"}</td>
                        <td>{classification}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="global-explanation">
            <h3>Possible extraction boundary</h3>
            <p>
              A future `server-setup` integration should consume a small placement contract:
              eligible regions, capacity/load evidence, participant latency evidence, and a
              deterministic decision. Provider provisioning, DNS, process orchestration, and
              game rules stay outside this model until later slices prove their boundaries.
            </p>
          </div>
        </div>
      </section>
    </section>
  );
}
