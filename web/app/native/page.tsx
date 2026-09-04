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
    detail: "The proxy adds 20 ms on each direction and closes every fifth accepted connection.",
  },
  {
    title: "4. Run the comparison",
    command: "cargo run -p server-lab-native --bin experiment -- 20 20 5 5 1000",
    detail: "The self-contained runner compares baseline and impaired paths and emits expected-versus-measured JSON.",
  },
];

export default function NativePage() {
  return (
    <main className="native-page">
      <header className="native-hero">
        <div>
          <p className="eyebrow">slice 5 · native network experiments</p>
          <h1>Leave the simulator and touch real sockets.</h1>
          <p className="lede">
            The browser lessons make behavior deterministic. This layer deliberately does the opposite where it matters:
            it uses localhost TCP, operating-system scheduling, and real elapsed time, then compares those measurements with
            simple expectations from the teaching models.
          </p>
        </div>
        <div className="native-note">
          <strong>Measurement evidence, not a benchmark.</strong>
          <span>
            Exact latency is noisy. Correctness gates check routing, drops, protocol behavior, and broad directional effects
            instead of asserting machine-specific timing numbers.
          </span>
        </div>
      </header>

      <section className="native-architecture" aria-label="Native experiment architecture">
        <div className="native-node">
          <span>Process A</span>
          <strong>client</strong>
          <small>Instant-based measurements</small>
        </div>
        <div className="native-arrow">→</div>
        <div className="native-node native-node-proxy">
          <span>Process B</span>
          <strong>fault-proxy</strong>
          <small>delay · deterministic drops</small>
        </div>
        <div className="native-arrow">→</div>
        <div className="native-node">
          <span>Process C</span>
          <strong>server</strong>
          <small>real TcpListener / TcpStream</small>
        </div>
      </section>

      <section className="native-grid">
        <article className="native-panel">
          <p className="eyebrow">protocol</p>
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
          <p className="eyebrow">fault semantics</p>
          <h2>Controlled, not random.</h2>
          <p>
            A configured one-way proxy delay of <code>D</code> should add roughly <code>2 × D</code> to successful round trips.
            Dropping every <code>N</code>th accepted connection gives an exact expected success count while latency remains noisy.
          </p>
        </article>

        <article className="native-panel">
          <p className="eyebrow">receipts</p>
          <h2>Machine-readable by default.</h2>
          <p>
            Client and experiment results are emitted as JSON, so runtime-profiler or another experiment harness can retain
            evidence without becoming a hard dependency of this repository.
          </p>
        </article>
      </section>

      <section className="native-commands">
        <div className="native-section-heading">
          <div>
            <p className="eyebrow">run it locally</p>
            <h2>Four small commands.</h2>
          </div>
          <p>Use separate terminals for the long-running server and proxy commands.</p>
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
          <p className="eyebrow">expected versus measured</p>
          <h2>What the experiment runner checks.</h2>
        </div>
        <div className="native-comparison-grid">
          <div>
            <span>Deterministic expectation</span>
            <strong>drop count</strong>
            <p>20 requests with every fifth connection dropped predicts exactly 16 successful impaired requests.</p>
          </div>
          <div>
            <span>Directional expectation</span>
            <strong>latency inflation</strong>
            <p>20 ms each way predicts roughly 40 ms of additional mean latency, allowing normal scheduler/socket noise.</p>
          </div>
          <div>
            <span>Observed evidence</span>
            <strong>real elapsed time</strong>
            <p>The result contains baseline and impaired success rates plus mean, p50, and p95 latency from actual sockets.</p>
          </div>
        </div>
      </section>

      <section className="concepts native-next">
        <div>
          <p className="eyebrow">next implementation horizon</p>
          <h2>Deeper systems experiments.</h2>
        </div>
        <p>
          The next slice can build on these real sockets for caching, consistent hashing and sharding, rate limiting,
          connection reuse, worker queues, fan-out, and head-of-line blocking. Packet-level loss, congestion, TLS, HTTP/2,
          HTTP/3, and statistically rigorous benchmarking remain separate experiments with explicit measurement contracts.
        </p>
      </section>
    </main>
  );
}
