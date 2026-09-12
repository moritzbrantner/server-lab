#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "netem experiment must run as root (use sudo bash native/netem/experiment.sh)" >&2
  exit 2
fi

for command in ip tc python3; do
  command -v "$command" >/dev/null || {
    echo "missing required command: $command" >&2
    exit 2
  }
done

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SERVER_BIN="$ROOT_DIR/target/debug/server"
CLIENT_BIN="$ROOT_DIR/target/debug/client"
UDP_BIN="$ROOT_DIR/target/debug/netem-udp"
for binary in "$SERVER_BIN" "$CLIENT_BIN" "$UDP_BIN"; do
  [[ -x "$binary" ]] || {
    echo "missing native binary: $binary (build server, client, and netem-udp first)" >&2
    exit 2
  }
done

RUN_SUFFIX="$$"
CLIENT_NS="sl-netem-client-$RUN_SUFFIX"
SERVER_NS="sl-netem-server-$RUN_SUFFIX"
CLIENT_VETH="slc${RUN_SUFFIX: -5}"
SERVER_VETH="sls${RUN_SUFFIX: -5}"
TCP_LOG=$(mktemp)
UDP_LOG=$(mktemp)

cleanup() {
  set +e
  for namespace in "$CLIENT_NS" "$SERVER_NS"; do
    if ip netns list | grep -q "^${namespace}\b"; then
      ip netns pids "$namespace" | xargs -r kill
      ip netns del "$namespace"
    fi
  done
  rm -f "$TCP_LOG" "$UDP_LOG"
}
trap cleanup EXIT

ip netns add "$CLIENT_NS"
ip netns add "$SERVER_NS"
ip link add "$CLIENT_VETH" type veth peer name "$SERVER_VETH"
ip link set "$CLIENT_VETH" netns "$CLIENT_NS"
ip link set "$SERVER_VETH" netns "$SERVER_NS"

ip -n "$CLIENT_NS" link set lo up
ip -n "$SERVER_NS" link set lo up
ip -n "$CLIENT_NS" link set "$CLIENT_VETH" name eth0
ip -n "$SERVER_NS" link set "$SERVER_VETH" name eth0
ip -n "$CLIENT_NS" addr add 10.203.0.1/24 dev eth0
ip -n "$SERVER_NS" addr add 10.203.0.2/24 dev eth0
ip -n "$CLIENT_NS" link set eth0 up
ip -n "$SERVER_NS" link set eth0 up

ip netns exec "$SERVER_NS" "$SERVER_BIN" 10.203.0.2:9000 0 1000 >"$TCP_LOG" 2>&1 &
TCP_PID=$!
ip netns exec "$SERVER_NS" "$UDP_BIN" server 10.203.0.2:9001 >"$UDP_LOG" 2>&1 &
UDP_PID=$!
sleep 0.15

baseline=$(ip netns exec "$CLIENT_NS" "$CLIENT_BIN" 10.203.0.2:9000 12 2000 0)

ip netns exec "$CLIENT_NS" tc qdisc replace dev eth0 root netem delay 30ms
ip netns exec "$SERVER_NS" tc qdisc replace dev eth0 root netem delay 30ms
delayed=$(ip netns exec "$CLIENT_NS" "$CLIENT_BIN" 10.203.0.2:9000 12 3000 0)

python3 - "$baseline" "$delayed" <<'PY'
import json
import sys
baseline = json.loads(sys.argv[1])
delayed = json.loads(sys.argv[2])
assert baseline["succeeded"] == baseline["attempted"], baseline
assert delayed["succeeded"] == delayed["attempted"], delayed
assert delayed["meanLatencyMs"] >= baseline["meanLatencyMs"] + 40, (baseline, delayed)
PY

ip netns exec "$CLIENT_NS" tc qdisc del dev eth0 root
ip netns exec "$SERVER_NS" tc qdisc del dev eth0 root
ip netns exec "$CLIENT_NS" tc qdisc add dev eth0 root netem delay 20ms reorder 100% gap 5
reordered=$(ip netns exec "$CLIENT_NS" "$UDP_BIN" client 10.203.0.2:9001 200 1 3000)

python3 - "$reordered" <<'PY'
import json
import sys
receipt = json.loads(sys.argv[1])
assert receipt["receivedPackets"] > 0, receipt
assert receipt["reorderedPackets"] > 0, receipt
PY

ip netns exec "$CLIENT_NS" tc qdisc replace dev eth0 root netem \
  delay 20ms 5ms 25% distribution normal \
  loss random 10% duplicate 2% rate 10mbit seed 42
lossy=$(ip netns exec "$CLIENT_NS" "$UDP_BIN" client 10.203.0.2:9001 300 1 4000)
qdisc=$(ip netns exec "$CLIENT_NS" tc -s qdisc show dev eth0 | tr '\n' ' ')

python3 - "$lossy" <<'PY'
import json
import sys
receipt = json.loads(sys.argv[1])
assert receipt["receivedPackets"] > 0, receipt
assert receipt["lostPackets"] > 0, receipt
PY

python3 - "$baseline" "$delayed" "$reordered" "$lossy" "$qdisc" <<'PY'
import json
import sys
print(json.dumps({
    "mode": "linux-network-namespace-netem",
    "baselineTcp": json.loads(sys.argv[1]),
    "fixedDelayTcp": json.loads(sys.argv[2]),
    "gapReorderingUdp": json.loads(sys.argv[3]),
    "lossJitterDuplicateRateUdp": json.loads(sys.argv[4]),
    "qdiscEvidence": sys.argv[5],
    "expectationsHold": True,
}, separators=(",", ":")))
PY

kill "$TCP_PID" "$UDP_PID" 2>/dev/null || true
wait "$TCP_PID" "$UDP_PID" 2>/dev/null || true
