"use client";

import { useMemo, useState } from "react";
import { GLOBAL_REGIONS, type GlobalRegionId } from "@/lib/global-ingress";
import { simulateDirectoryAuthorityRecovery } from "@/lib/multiplayer-directory-recovery";
import {
  simulateMultiplayerFailure,
  type MultiplayerFailureInput,
  type MultiplayerGameplayPath,
  type MultiplayerRecoveryKind,
  type MultiplayerSessionLifecycle,
  type RegionalServiceState,
} from "@/lib/multiplayer-recovery";
import styles from "./multiplayer-recovery-lab.module.css";

const SERVICE_STATES: RegionalServiceState[] = ["available", "failed", "partitioned"];

function regionLabel(regionId: GlobalRegionId): string {
  return GLOBAL_REGIONS.find((region) => region.id === regionId)?.location ?? regionId;
}

function eventNodeLabel(nodeId: string | null): string {
  if (nodeId === null) return "—";
  return GLOBAL_REGIONS.find((region) => region.id === nodeId)?.location ?? nodeId;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function MultiplayerRecoveryLab() {
  const [lifecycle, setLifecycle] = useState<MultiplayerSessionLifecycle>("established");
  const [signalingRegionId, setSignalingRegionId] = useState<GlobalRegionId>("eu-central");
  const [signalingState, setSignalingState] = useState<RegionalServiceState>("available");
  const [directoryState, setDirectoryState] = useState<RegionalServiceState>("available");
  const [gameplayPath, setGameplayPath] = useState<MultiplayerGameplayPath>("direct");
  const [turnRegionId, setTurnRegionId] = useState<GlobalRegionId>("eu-central");
  const [turnState, setTurnState] = useState<RegionalServiceState>("available");
  const [recoveryKind, setRecoveryKind] = useState<MultiplayerRecoveryKind>("ice-restart");
  const [replacementTurnRegionId, setReplacementTurnRegionId] = useState<GlobalRegionId>("us-east");
  const [replacementTurnState, setReplacementTurnState] = useState<RegionalServiceState>("available");

  const effectiveRecoveryKind: MultiplayerRecoveryKind =
    gameplayPath === "direct" && recoveryKind === "turn-reallocate"
      ? "ice-restart"
      : recoveryKind;
  const effectiveReplacementTurnState =
    replacementTurnRegionId === turnRegionId ? turnState : replacementTurnState;
  const turnRelevant = gameplayPath === "turn";
  const replacementRelevant =
    lifecycle === "recovering" && effectiveRecoveryKind === "turn-reallocate";

  const result = useMemo(() => {
    const input: MultiplayerFailureInput = {
      lifecycle,
      signalingRegionId,
      signalingStateByRegion: { [signalingRegionId]: signalingState },
      directoryState,
      gameplayPath,
    };

    if (lifecycle === "recovering") {
      input.recoveryKind = effectiveRecoveryKind;
    }

    if (gameplayPath === "turn") {
      input.turnRegionId = turnRegionId;
      input.turnStateByRegion = { [turnRegionId]: turnState };

      if (replacementRelevant) {
        input.replacementTurnRegionId = replacementTurnRegionId;
        input.turnStateByRegion[replacementTurnRegionId] = effectiveReplacementTurnState;
      }
    }

    return simulateMultiplayerFailure(input);
  }, [
    directoryState,
    effectiveRecoveryKind,
    effectiveReplacementTurnState,
    gameplayPath,
    lifecycle,
    replacementRelevant,
    replacementTurnRegionId,
    signalingRegionId,
    signalingState,
    turnRegionId,
    turnState,
  ]);

  const directoryRecovery = useMemo(
    () =>
      simulateDirectoryAuthorityRecovery({
        initialLeaderRegionId: "eu-central",
        failure: { startMs: 100, endMs: 900 },
        initialTerm: 7,
        heartbeatIntervalMs: 50,
        electionTimeoutMs: 150,
        electionDurationMs: 40,
      }),
    [],
  );

  return (
    <section className={styles.section} aria-labelledby="multiplayer-recovery-heading">
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">server-lab · slice 7D</p>
          <h2 id="multiplayer-recovery-heading">A failure matters only when the current lifecycle still depends on that service.</h2>
        </div>
        <div className={styles.boundary}>
          <strong>Failure scope stays explicit.</strong> Signaling and the room directory are control-plane dependencies. TURN is a gameplay dependency only for a relayed path. Terms and fencing are reused only for the stateful directory authority.
        </div>
      </header>

      <div className={styles.shell}>
        <div className={styles.controls}>
          <label>
            Session lifecycle
            <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as MultiplayerSessionLifecycle)}>
              <option value="establishing">Establishing WebRTC</option>
              <option value="established">Established DataChannel</option>
              <option value="recovering">Recovering lost DataChannel</option>
            </select>
          </label>

          <label>
            Signaling region
            <select value={signalingRegionId} onChange={(event) => setSignalingRegionId(event.target.value as GlobalRegionId)}>
              {GLOBAL_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.location}</option>)}
            </select>
          </label>

          <label>
            Selected signaling state
            <select value={signalingState} onChange={(event) => setSignalingState(event.target.value as RegionalServiceState)}>
              {SERVICE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>

          <label>
            Global room directory
            <select value={directoryState} onChange={(event) => setDirectoryState(event.target.value as RegionalServiceState)}>
              {SERVICE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>

          <label>
            Established gameplay path
            <select value={gameplayPath} onChange={(event) => setGameplayPath(event.target.value as MultiplayerGameplayPath)}>
              <option value="direct">Direct peer DataChannel</option>
              <option value="turn">TURN-relayed DataChannel</option>
            </select>
          </label>

          <label>
            Active TURN region
            <select value={turnRegionId} onChange={(event) => setTurnRegionId(event.target.value as GlobalRegionId)} disabled={!turnRelevant}>
              {GLOBAL_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.location}</option>)}
            </select>
          </label>

          <label>
            Active TURN state
            <select value={turnState} onChange={(event) => setTurnState(event.target.value as RegionalServiceState)} disabled={!turnRelevant}>
              {SERVICE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>

          <label>
            Recovery operation
            <select value={effectiveRecoveryKind} onChange={(event) => setRecoveryKind(event.target.value as MultiplayerRecoveryKind)} disabled={lifecycle !== "recovering"}>
              <option value="ice-restart">ICE restart</option>
              <option value="rejoin">Full room rejoin</option>
              <option value="turn-reallocate" disabled={!turnRelevant}>TURN reallocation</option>
            </select>
          </label>

          <label>
            Replacement TURN region
            <select value={replacementTurnRegionId} onChange={(event) => setReplacementTurnRegionId(event.target.value as GlobalRegionId)} disabled={!replacementRelevant}>
              {GLOBAL_REGIONS.map((region) => <option key={region.id} value={region.id}>{region.location}</option>)}
            </select>
          </label>

          <label>
            Replacement TURN state
            <select value={replacementTurnState} onChange={(event) => setReplacementTurnState(event.target.value as RegionalServiceState)} disabled={!replacementRelevant || replacementTurnRegionId === turnRegionId}>
              {SERVICE_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.results}>
          <p className={styles.summary}>
            <strong>{result.gameplayAvailable ? "Gameplay is available." : "Gameplay is not currently available."}</strong>{" "}
            {result.explanation}
          </p>

          <section>
            <div className={styles.sectionHeading}>
              <h3>Dependency verdict</h3>
              <p>The same service failure has different consequences while establishing, playing, or recovering.</p>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Dependency</th><th>State</th><th>Needed now</th><th>Boundary</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Global room directory</td>
                    <td className={directoryState === "available" ? styles.good : styles.bad}>{directoryState}</td>
                    <td>{result.requiredControlPlane.includes("directory") ? "required" : "not required"}</td>
                    <td className={styles.muted}>Room ownership discovery; never an established gameplay packet path.</td>
                  </tr>
                  <tr>
                    <td>Signaling · {regionLabel(signalingRegionId)}</td>
                    <td className={signalingState === "available" ? styles.good : styles.bad}>{signalingState}</td>
                    <td>{result.requiredControlPlane.includes("signaling") ? "required" : "not required"}</td>
                    <td className={styles.muted}>Offer/answer, ICE restart, or relay reallocation control plane.</td>
                  </tr>
                  <tr>
                    <td>{turnRelevant ? `TURN · ${regionLabel(turnRegionId)}` : "TURN"}</td>
                    <td className={!turnRelevant || turnState === "available" ? styles.good : styles.bad}>{turnRelevant ? turnState : "not on path"}</td>
                    <td>{turnRelevant ? "data path" : "not required"}</td>
                    <td className={styles.muted}>A gameplay dependency only when relay fallback is actually established.</td>
                  </tr>
                  {replacementRelevant ? (
                    <tr>
                      <td>Replacement TURN · {regionLabel(replacementTurnRegionId)}</td>
                      <td className={effectiveReplacementTurnState === "available" ? styles.good : styles.bad}>{effectiveReplacementTurnState}</td>
                      <td>recovery target</td>
                      <td className={styles.muted}>Used only by the explicit TURN reallocation operation.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className={styles.sectionHeading}>
              <h3>Current outcome</h3>
              <p>No hidden fallback: the model reports the current lifecycle operation separately from the established gameplay path.</p>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Question</th><th>Answer</th></tr></thead>
                <tbody>
                  <tr><td>Current lifecycle operation available?</td><td className={result.operationAvailable ? styles.good : styles.bad}>{yesNo(result.operationAvailable)}</td></tr>
                  <tr><td>Gameplay available now?</td><td className={result.gameplayAvailable ? styles.good : styles.bad}>{yesNo(result.gameplayAvailable)}</td></tr>
                  <tr><td>Control plane required now?</td><td>{yesNo(result.requiresControlPlane)}</td></tr>
                  <tr><td>Recovery required from the current established path?</td><td>{yesNo(result.recoveryRequired)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className={styles.sectionHeading}>
              <h3>Stateful directory authority recovery</h3>
              <p>Only this stateful authority reuses the existing election model: failure detection, leader promotion, a higher term, and fencing of a recovered stale writer.</p>
            </div>
            <p className={styles.explanation}>
              The deterministic preset fails the Frankfurt directory leader at 100 ms. Failure is detected at <strong>{directoryRecovery.detectionAtMs} ms</strong>, a replacement is elected at <strong>{directoryRecovery.failoverCompleteMs} ms</strong> in term <strong>{directoryRecovery.finalTerm}</strong>, and the recovered old writer is fenced. Stateless signaling and TURN do not inherit election terms merely because they can fail.
            </p>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>At</th><th>Event</th><th>Region</th><th>Term</th><th>Detail</th></tr></thead>
                <tbody>
                  {directoryRecovery.events.map((event, index) => (
                    <tr key={`${event.atMs}-${event.type}-${event.nodeId ?? "none"}-${index}`}>
                      <td>{event.atMs} ms</td>
                      <td>{event.type}</td>
                      <td>{eventNodeLabel(event.nodeId)}</td>
                      <td>{event.term}</td>
                      <td className={styles.traceDetail}>{event.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className={styles.explanation}>
            <strong>Measurement boundary:</strong> these are deterministic failure semantics and timing constants. They are not provider availability, real ICE success rates, TURN failover measurements, or multi-host evidence. Native measurements remain deferred until this deterministic contract is stable.
          </p>
        </div>
      </div>
    </section>
  );
}
