"use client";

import { useMemo, useState } from "react";
import {
  CLIENT_SITES,
  GLOBAL_REGIONS,
  type ClientSiteId,
  type GlobalRegionId,
} from "@/lib/global-ingress";
import {
  simulateRoomAuthority,
  type DirectoryState,
  type RoomPlacementPolicy,
} from "@/lib/room-authority";

const PLACEMENT_LABELS: Record<RoomPlacementPolicy, string> = {
  "creator-nearest": "Creator-nearest",
  "fixed-region": "Fixed region",
  "min-average-rtt": "Minimum average RTT",
  "min-worst-rtt": "Minimum worst-player RTT",
};

function regionLabel(regionId: GlobalRegionId) {
  const region = GLOBAL_REGIONS.find((candidate) => candidate.id === regionId);
  return region ? `${region.location} · ${region.id}` : regionId;
}

function siteLabel(siteId: ClientSiteId) {
  return CLIENT_SITES.find((candidate) => candidate.id === siteId)?.label ?? siteId;
}

function homeRegion(siteId: ClientSiteId): GlobalRegionId {
  return (
    CLIENT_SITES.find((candidate) => candidate.id === siteId)?.homeRegion ??
    "eu-central"
  );
}

export function RoomAuthorityLab() {
  const [creatorSiteId, setCreatorSiteId] =
    useState<ClientSiteId>("frankfurt");
  const [joinerSiteId, setJoinerSiteId] =
    useState<ClientSiteId>("singapore");
  const [placementPolicy, setPlacementPolicy] =
    useState<RoomPlacementPolicy>("creator-nearest");
  const [fixedRegionId, setFixedRegionId] =
    useState<GlobalRegionId>("us-east");
  const [directoryState, setDirectoryState] =
    useState<DirectoryState>("fresh");

  const simulation = useMemo(
    () =>
      simulateRoomAuthority({
        roomId: "demo-room",
        creatorSiteId,
        playerSiteIds: [joinerSiteId],
        clientIngresses: [
          {
            siteId: creatorSiteId,
            ingressRegionId: homeRegion(creatorSiteId),
          },
          {
            siteId: joinerSiteId,
            ingressRegionId: homeRegion(joinerSiteId),
          },
        ],
        placementPolicy,
        fixedRegionId,
        directoryState,
      }),
    [creatorSiteId, directoryState, fixedRegionId, joinerSiteId, placementPolicy],
  );

  const joinerRoute = simulation.clients[1];

  return (
    <section className="global-lab" aria-labelledby="room-authority-heading">
      <div className="global-section-heading">
        <div>
          <p className="eyebrow">server-lab · slice 7B</p>
          <h3 id="room-authority-heading">Regional room authority</h3>
        </div>
        <p>
          Ingress is local. Room ownership is singular and resolved through a
          deterministic directory.
        </p>
      </div>

      <section className="global-shell">
        <div className="global-controls">
          <div>
            <p className="eyebrow">room controls</p>
            <h2>Placement and directory</h2>
          </div>

          <label>
            Creator location
            <select
              value={creatorSiteId}
              onChange={(event) =>
                setCreatorSiteId(event.target.value as ClientSiteId)
              }
            >
              {CLIENT_SITES.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Second player location
            <select
              value={joinerSiteId}
              onChange={(event) =>
                setJoinerSiteId(event.target.value as ClientSiteId)
              }
            >
              {CLIENT_SITES.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Room placement policy
            <select
              value={placementPolicy}
              onChange={(event) =>
                setPlacementPolicy(event.target.value as RoomPlacementPolicy)
              }
            >
              {Object.entries(PLACEMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Fixed region
            <select
              value={fixedRegionId}
              onChange={(event) =>
                setFixedRegionId(event.target.value as GlobalRegionId)
              }
              disabled={placementPolicy !== "fixed-region"}
            >
              {GLOBAL_REGIONS.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.location}
                </option>
              ))}
            </select>
          </label>

          <label>
            Directory state
            <select
              value={directoryState}
              onChange={(event) =>
                setDirectoryState(event.target.value as DirectoryState)
              }
            >
              <option value="fresh">Fresh</option>
              <option value="stale">Stale</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>
        </div>

        <div className="global-results">
          <div className="global-route-strip" aria-label="Room routing path">
            <div>
              <span>{siteLabel(creatorSiteId)}</span>
              <strong>{regionLabel(homeRegion(creatorSiteId))}</strong>
            </div>
            <b>→</b>
            <div className="global-hostname">
              <span>room owner</span>
              <strong>{regionLabel(simulation.placement.regionId)}</strong>
            </div>
            <b>←</b>
            <div>
              <span>{siteLabel(joinerSiteId)}</span>
              <strong>{regionLabel(homeRegion(joinerSiteId))}</strong>
            </div>
          </div>

          <p className="global-summary">
            <strong>
              {simulation.converged
                ? "Both independently routed clients resolve the same room authority."
                : "Joining is blocked before either client guesses room authority."}
            </strong>{" "}
            {simulation.clients[0]?.directory.reason}
          </p>

          <div>
            <div className="global-section-heading">
              <h3>Placement comparison</h3>
              <p>{PLACEMENT_LABELS[placementPolicy]}</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Policy score</th>
                    <th>Selected owner</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.placement.scores.map((score) => (
                    <tr key={score.regionId}>
                      <td>{regionLabel(score.regionId)}</td>
                      <td>
                        {Number.isFinite(score.scoreMs)
                          ? `${score.scoreMs.toFixed(1)} ms`
                          : "not eligible"}
                      </td>
                      <td>
                        {score.regionId === simulation.placement.regionId
                          ? "yes"
                          : "no"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="global-section-heading">
              <h3>Directory convergence</h3>
              <p>generation {simulation.directoryEntry.generation}</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>First ingress</th>
                    <th>Directory result</th>
                    <th>Room authority</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.clients.map((client) => (
                    <tr key={client.siteId}>
                      <td>{siteLabel(client.siteId)}</td>
                      <td>{regionLabel(client.ingressRegionId)}</td>
                      <td>{client.directory.state}</td>
                      <td>
                        {client.resolvedOwnerRegionId
                          ? regionLabel(client.resolvedOwnerRegionId)
                          : "blocked"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="global-section-heading">
              <h3>Second-player join path costs</h3>
              <p>Every modeled hop is shown rather than folded into one number.</p>
            </div>
            <div className="global-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Modeled total</th>
                    <th>Client RTTs</th>
                    <th>Inter-region hops</th>
                    <th>Explicit steps</th>
                  </tr>
                </thead>
                <tbody>
                  {joinerRoute?.pathCosts.map((path) => (
                    <tr key={path.path}>
                      <td>{path.path}</td>
                      <td>{path.totalLatencyMs.toFixed(0)} ms</td>
                      <td>{path.clientFacingRoundTrips}</td>
                      <td>{path.interRegionHops}</td>
                      <td>
                        {path.steps
                          .map(
                            (step) =>
                              `${step.label} (${step.latencyMs.toFixed(0)} ms)`,
                          )
                          .join(" + ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="global-explanation">
            <h3>Authority boundary</h3>
            <p>
              This model assigns one region to each room. It does not replicate
              live WebSocket or setup state across regions. A stale or unavailable
              directory blocks the join, making split ownership visible instead of
              manufacturing a second room authority.
            </p>
          </div>
        </div>
      </section>
    </section>
  );
}
