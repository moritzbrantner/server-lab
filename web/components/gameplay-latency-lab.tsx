"use client";

import { useMemo, useState } from "react";
import {
  compareSignalingRegions,
  simulateGameplayLatency,
  type ConnectivityMode,
  type GameplayTopology,
} from "@/lib/gameplay-latency";
import {
  CLIENT_SITES,
  GLOBAL_REGIONS,
  type ClientSiteId,
  type GlobalRegionId,
} from "@/lib/global-ingress";
import styles from "./gameplay-latency-lab.module.css";

const players = ["frankfurt", "virginia", "singapore"] as const;

function siteLabel(siteId: ClientSiteId): string {
  return CLIENT_SITES.find((site) => site.id === siteId)?.label.replace(" player", "") ?? siteId;
}

function regionLabel(regionId: GlobalRegionId): string {
  return GLOBAL_REGIONS.find((region) => region.id === regionId)?.location ?? regionId;
}

export function GameplayLatencyLab() {
  const [signalingRegionId, setSignalingRegionId] = useState<GlobalRegionId>("eu-central");
  const [topology, setTopology] = useState<GameplayTopology>("full-mesh");
  const [hostSiteId, setHostSiteId] = useState<ClientSiteId>("frankfurt");
  const [connectivityMode, setConnectivityMode] = useState<ConnectivityMode>("direct");
  const [turnRegionId, setTurnRegionId] = useState<GlobalRegionId>("eu-central");

  const result = useMemo(
    () =>
      simulateGameplayLatency({
        playerSiteIds: players,
        signalingRegionId,
        topology,
        hostSiteId,
        connectivityMode,
        turnRegionId,
      }),
    [connectivityMode, hostSiteId, signalingRegionId, topology, turnRegionId],
  );

  const signalingComparison = useMemo(
    () =>
      compareSignalingRegions({
        playerSiteIds: players,
        topology,
        hostSiteId,
        connectivityMode,
        turnRegionId,
      }),
    [connectivityMode, hostSiteId, topology, turnRegionId],
  );

  return (
    <section className={styles.section} aria-labelledby="gameplay-latency-heading">
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">server-lab · slice 7C</p>
          <h2 id="gameplay-latency-heading">A faster signaling region does not automatically make the game path faster.</h2>
        </div>
        <div className={styles.boundary}>
          <strong>Control plane and data plane stay separate.</strong> Room create/join, WebSocket signaling, and ICE setup are modeled as setup phases. Established gameplay uses direct peer paths unless TURN fallback explicitly inserts a relay region.
        </div>
      </header>

      <div className={styles.shell}>
        <div className={styles.controls}>
          <label>
            Signaling region
            <select value={signalingRegionId} onChange={(event) => setSignalingRegionId(event.target.value as GlobalRegionId)}>
              {GLOBAL_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.location}</option>)}
            </select>
          </label>

          <label>
            Gameplay topology
            <select value={topology} onChange={(event) => setTopology(event.target.value as GameplayTopology)}>
              <option value="full-mesh">Full mesh</option>
              <option value="host-spoke">Host ↔ spoke</option>
            </select>
          </label>

          <label>
            Host player
            <select value={hostSiteId} onChange={(event) => setHostSiteId(event.target.value as ClientSiteId)} disabled={topology !== "host-spoke"}>
              {players.map((siteId) => <option key={siteId} value={siteId}>{siteLabel(siteId)}</option>)}
            </select>
          </label>

          <label>
            ICE outcome
            <select value={connectivityMode} onChange={(event) => setConnectivityMode(event.target.value as ConnectivityMode)}>
              <option value="direct">Direct peer connection</option>
              <option value="turn-fallback">Direct attempt, then TURN fallback</option>
            </select>
          </label>

          <label>
            TURN relay region
            <select value={turnRegionId} onChange={(event) => setTurnRegionId(event.target.value as GlobalRegionId)} disabled={connectivityMode !== "turn-fallback"}>
              {GLOBAL_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.location}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.results}>
          <p className={styles.summary}>
            With signaling in <strong>{regionLabel(signalingRegionId)}</strong>, modeled setup completes in <strong>{result.totalSetupLatencyMs} ms</strong>. Established {topology === "full-mesh" ? "mesh" : "host-spoke"} gameplay has a mean path RTT of <strong>{result.meanGameplayRttMs.toFixed(1)} ms</strong> and worst path RTT of <strong>{result.worstGameplayRttMs} ms</strong>. {connectivityMode === "direct" ? "The signaling region is not on those established gameplay paths." : `TURN in ${regionLabel(turnRegionId)} is now part of every modeled gameplay path.`}
          </p>

          <section>
            <div className={styles.sectionHeading}>
              <h3>Setup phases</h3>
              <p>Kept separate rather than collapsed into one latency number.</p>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Phase</th><th>Latency</th><th>What is on the path</th></tr></thead>
                <tbody>
                  {result.phases.map((phase) => (
                    <tr key={phase.id}>
                      <td>{phase.label}</td>
                      <td>{phase.latencyMs} ms</td>
                      <td>{phase.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className={styles.sectionHeading}>
              <h3>Move only the signaling region</h3>
              <p>Direct gameplay stays unchanged; setup does not.</p>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Signaling</th><th>Total setup</th><th>Mean gameplay RTT</th><th>Worst gameplay RTT</th></tr></thead>
                <tbody>
                  {signalingComparison.map((entry) => (
                    <tr key={entry.signalingRegionId}>
                      <td>{regionLabel(entry.signalingRegionId)}</td>
                      <td>{entry.setupLatencyMs} ms</td>
                      <td>{entry.meanGameplayRttMs.toFixed(1)} ms</td>
                      <td>{entry.worstGameplayRttMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className={styles.sectionHeading}>
              <h3>Established gameplay paths</h3>
              <p>{topology === "full-mesh" ? "Every peer pair exchanges gameplay traffic." : `Only ${siteLabel(hostSiteId)} ↔ peer paths carry the modeled game traffic.`}</p>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Peer A</th><th>Peer B</th><th>Path</th><th>RTT</th></tr></thead>
                <tbody>
                  {result.gameplayEdges.map((edge) => (
                    <tr key={`${edge.leftSiteId}-${edge.rightSiteId}`}>
                      <td>{siteLabel(edge.leftSiteId)}</td>
                      <td>{siteLabel(edge.rightSiteId)}</td>
                      <td className={edge.path === "direct" ? styles.pathDirect : styles.pathTurn}>
                        {edge.path === "direct" ? "direct peer ↔ peer" : `via TURN ${regionLabel(edge.viaRegionId!)}`}
                      </td>
                      <td>{edge.rttMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className={styles.explanation}>
            <strong>Teaching boundary:</strong> these RTTs and phase costs are deterministic constants, not infrastructure measurements. TURN credential issuance, provider selection, NAT behavior, packet loss, congestion, and regional failure/recovery remain outside this slice. Slice 7D can now fail signaling, directory, and TURN regions independently without conflating an already-established direct DataChannel with the control plane that created it.
          </p>
        </div>
      </div>
    </section>
  );
}
