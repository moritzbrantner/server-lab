const commands = [
  {
    title: "1. Start a backend",
    command: "cargo run -p server-lab-native --bin server -- 127.0.0.1:9000 5",
    detail: "A real TCP server answers one PING/PONG exchange per connection and waits 5 ms before responding.",
  },
  {
    title: "2. Measure the direct path",
    command: "cargo run -p server-lab-native --bin client -- 127.0.0.1:9000 20 1000 0",
    detail: "The client records real elapsed connect/write/read latency and prints a JSON summary.",
  },
  {
    title: "3. Add an impaired proxy",
    command: "cargo run -p server-lab-native --bin fault-proxy -- 127.0.0.1:9100 127.0.0.1:9000 20 5",
    detail: "The proxy adds 20 ms on each direction and closes every fifth accepted connection at request/connection granularity.",
  },
  {
    title: "4. Run the request-level comparison",
    command: "cargo run -p server-lab-native --bin experiment -- 20 20 5 5 1000",
    detail: "The self-contained runner compares baseline and impaired paths and emits expected-versus-measured JSON.",
  },
  {
    title: "5. Run real packet-level netem",
    command: "cargo build -p server-lab-native --bin server --bin client --bin netem-udp && sudo bash native/netem/experiment.sh",
    detail: "Linux network namespaces and tc netem apply delay, reordering, jitter, loss, duplication, and rate limiting to actual packets.",
  },
];

export default function NativePage() {
  return (
    <main className="native-page">
      <header className="native-hero">
        <div>
          <p className="eyebrow">native network experiments · slices 5 and 10</p>
          <h1>Leave the simulator and touch real sockets and packets.</h1>
          <p className="lede">
            The browser lessons make behavior deterministic. This layer deliberately does the opposite where it matters:
            it uses real sockets, operating-system scheduling, isolated Linux network namespaces, and kernel traffic control,
            then compares those measurements with explicit semantic expectations.
          </p>
        </div>
        <div className="native-note">
          <strong>Measurement evidence, not a benchmark.</strong>
          <span>
            Exact latency is noisy. Correctness gates check protocol behavior and broad directional effects instead of
            asserting machine-specific timing or pretending localhost emulation is a geographic Internet measurement.
          </span>
        </div>
      </header>

      <section className="native-architecture" aria-label="Native experiment architecture">
        <div className="native-node">
          <span>Client namespace/process</span>
          <strong>client / UDP probe</strong>
          <small>real sockets and sequence evidence</small>
        </div>
        <div className="native-arrow">→</div>
        <div className="native-node native-node-proxy">
          <span>Impairment layer</span>
          <strong>fault-proxy or tc netem</strong>
          <small>request-level or packet-level, never conflated</small>
        </div>
        <div className="native-arrow">→</div>
        <div className="native-node">
          <span>Server namespace/process</span>
          <strong>TCP / UDP server</strong>
          <small>real kernel network path</small>
        </div>
      </section>

      <section className="native-grid">
        <article className="native-panel">
          <p className="eyebrow">request-level protocol</p>
          <h2>Small enough to see the network.</h2>
          <div className="native-protocol">
            <code>PING 7</code>
            <span>→</span>
            <code>PONG 7</code>
          </div>
          <p>
            One request uses one TCP connection. There is no HTTP framework, TLS, connection pool, or serializer hiding the
            first-order socket behavior.
          </p>
        </article>

        <article className="native-panel">
          <p className="eyebrow">two impairment boundaries</p>
          <h2>Proxy faults are not packet faults.</h2>
          <p>
            The Rust fault proxy delays forwarding and deterministically drops accepted connections. The netem harness instead
            attaches Linux qdiscs to namespace interfaces, so delay, jitter, loss, duplication, reordering, and rate limiting
            occur on actual packets.
          </p>
        </article>

        <article className="native-panel">
          <p className="eyebrow">receipts</p>
          <h2>Machine-readable by default.</h2>
          <p>
            TCP and UDP experiment results are emitted as JSON, so runtime-profiler or another experiment harness can retain
            evidence without becoming a hard dependency of this repository.
          </p>
        </article>
      </section>

      <section className="native-commands">
        <div className="native-section-heading">
          <div>
            <p className="eyebrow">run it locally</p>
            <h2>Application-level and packet-level experiments.</h2>
          </div>
          <p>The netem experiment is Linux-only and requires root privileges for namespaces and traffic control.</p>
        </div>

        <div className="native-command-list">
          {commands.map((item) => (
            <article key={item.title} className="native-command-card">
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <pre><code>{item.command}</code></pre>
            </article>
          ))}
        </div>
      </section>

      <section className="native-comparison">
        <div>
          <p className="eyebrow">packet-level evidence</p>
          <h2>What netem now proves.</h2>
        </div>
        <div className="native-comparison-grid">
          <div>
            <span>Fixed delay</span>
            <strong>TCP latency inflation</strong>
            <p>A fixed qdisc delay in both directions must produce a clear measured round-trip increase while requests still succeed.</p>
          </div>
          <div>
            <span>Deterministic gap</span>
            <strong>UDP reordering</strong>
            <p>Numbered UDP datagrams make out-of-order delivery observable instead of relying on TCP, which hides ordering from the application.</p>
          </div>
          <div>
            <span>Seeded impairment</span>
            <strong>loss · jitter · duplication · rate</strong>
            <p>The receipt records UDP delivery/loss/reordering plus the kernel qdisc statistics without treating exact percentages as benchmark guarantees.</p>
          </div>
        </div>
      </section>

      <section className="concepts native-next">
        <div>
          <p className="eyebrow">next experimental extension</p>
          <h2>Put WebTransport through the same packet path.</h2>
        </div>
        <p>
          The namespace/netem ownership boundary is now established independently of any transport. A later experiment can run
          the authoritative QUIC/WebTransport adapter through it and compare stream versus datagram behavior under identical
          packet loss, jitter, reordering, and rate constraints without changing the impairment model.
        </p>
      </section>
    </main>
  );
}
