use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub service_delay_ms: u64,
    pub io_timeout_ms: u64,
}

#[derive(Clone, Debug)]
pub struct ProxyConfig {
    pub one_way_delay_ms: u64,
    pub drop_every: usize,
    pub io_timeout_ms: u64,
}

#[derive(Clone, Debug)]
pub struct ClientConfig {
    pub request_count: usize,
    pub timeout_ms: u64,
    pub interval_ms: u64,
}

#[derive(Clone, Debug)]
pub struct ProbeSample {
    pub request_id: usize,
    pub success: bool,
    pub latency_ms: f64,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ExperimentSummary {
    pub attempted: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub success_rate: f64,
    pub mean_latency_ms: Option<f64>,
    pub p50_latency_ms: Option<f64>,
    pub p95_latency_ms: Option<f64>,
    pub samples: Vec<ProbeSample>,
}

impl ExperimentSummary {
    pub fn to_json(&self) -> String {
        format!(
            concat!(
                "{{\"attempted\":{},\"succeeded\":{},\"failed\":{},",
                "\"successRate\":{:.6},\"meanLatencyMs\":{},",
                "\"p50LatencyMs\":{},\"p95LatencyMs\":{}}}"
            ),
            self.attempted,
            self.succeeded,
            self.failed,
            self.success_rate,
            json_number(self.mean_latency_ms),
            json_number(self.p50_latency_ms),
            json_number(self.p95_latency_ms),
        )
    }
}

#[derive(Clone, Debug)]
pub struct LoopbackExperimentConfig {
    pub request_count: usize,
    pub service_delay_ms: u64,
    pub proxy_one_way_delay_ms: u64,
    pub drop_every: usize,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug)]
pub struct LoopbackExperimentReport {
    pub baseline: ExperimentSummary,
    pub impaired: ExperimentSummary,
    pub expected_impaired_successes: usize,
    pub expected_added_latency_ms: f64,
    pub measured_added_mean_latency_ms: Option<f64>,
}

impl LoopbackExperimentReport {
    pub fn expectations_hold(&self) -> bool {
        let success_matches = self.impaired.succeeded == self.expected_impaired_successes;
        let latency_matches = match self.measured_added_mean_latency_ms {
            Some(value) => value >= self.expected_added_latency_ms * 0.75,
            None => self.expected_impaired_successes == 0,
        };
        success_matches && latency_matches
    }

    pub fn to_json(&self) -> String {
        format!(
            concat!(
                "{{\"baseline\":{},\"impaired\":{},",
                "\"expectation\":{{\"impairedSuccesses\":{},\"addedLatencyMs\":{:.3}}},",
                "\"measured\":{{\"addedMeanLatencyMs\":{}}},\"expectationsHold\":{}}}"
            ),
            self.baseline.to_json(),
            self.impaired.to_json(),
            self.expected_impaired_successes,
            self.expected_added_latency_ms,
            json_number(self.measured_added_mean_latency_ms),
            self.expectations_hold(),
        )
    }
}

pub fn serve(listener: TcpListener, config: ServerConfig, max_connections: usize) -> io::Result<()> {
    let mut workers = Vec::new();

    for _ in 0..max_connections {
        let (stream, _) = listener.accept()?;
        let worker_config = config.clone();
        workers.push(thread::spawn(move || {
            handle_server_connection(stream, &worker_config)
        }));
    }

    join_workers(workers)
}

pub fn serve_proxy(
    listener: TcpListener,
    target: SocketAddr,
    config: ProxyConfig,
    max_connections: usize,
) -> io::Result<()> {
    let mut workers = Vec::new();

    for ordinal in 1..=max_connections {
        let (stream, _) = listener.accept()?;
        let worker_config = config.clone();
        workers.push(thread::spawn(move || {
            handle_proxy_connection(stream, target, &worker_config, ordinal)
        }));
    }

    join_workers(workers)
}

pub fn run_client(address: SocketAddr, config: &ClientConfig) -> ExperimentSummary {
    let mut samples = Vec::with_capacity(config.request_count);

    for request_id in 0..config.request_count {
        samples.push(probe_once(address, request_id, config.timeout_ms));
        if request_id + 1 < config.request_count && config.interval_ms > 0 {
            thread::sleep(Duration::from_millis(config.interval_ms));
        }
    }

    summarize(samples)
}

pub fn run_loopback_experiment(config: &LoopbackExperimentConfig) -> io::Result<LoopbackExperimentReport> {
    if config.request_count == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "request_count must be positive",
        ));
    }

    let backend_listener = TcpListener::bind("127.0.0.1:0")?;
    let backend_address = backend_listener.local_addr()?;
    let backend_config = ServerConfig {
        service_delay_ms: config.service_delay_ms,
        io_timeout_ms: config.timeout_ms,
    };
    thread::spawn(move || {
        let _ = serve(backend_listener, backend_config, usize::MAX);
    });

    let proxy_listener = TcpListener::bind("127.0.0.1:0")?;
    let proxy_address = proxy_listener.local_addr()?;
    let proxy_config = ProxyConfig {
        one_way_delay_ms: config.proxy_one_way_delay_ms,
        drop_every: config.drop_every,
        io_timeout_ms: config.timeout_ms,
    };
    thread::spawn(move || {
        let _ = serve_proxy(proxy_listener, backend_address, proxy_config, usize::MAX);
    });

    let client_config = ClientConfig {
        request_count: config.request_count,
        timeout_ms: config.timeout_ms,
        interval_ms: 0,
    };
    let baseline = run_client(backend_address, &client_config);
    let impaired = run_client(proxy_address, &client_config);

    let expected_drops = if config.drop_every == 0 {
        0
    } else {
        config.request_count / config.drop_every
    };
    let expected_impaired_successes = config.request_count - expected_drops;
    let expected_added_latency_ms = (config.proxy_one_way_delay_ms * 2) as f64;
    let measured_added_mean_latency_ms = match (baseline.mean_latency_ms, impaired.mean_latency_ms) {
        (Some(baseline_mean), Some(impaired_mean)) => Some(impaired_mean - baseline_mean),
        _ => None,
    };

    Ok(LoopbackExperimentReport {
        baseline,
        impaired,
        expected_impaired_successes,
        expected_added_latency_ms,
        measured_added_mean_latency_ms,
    })
}

fn handle_server_connection(mut stream: TcpStream, config: &ServerConfig) -> io::Result<()> {
    let timeout = Duration::from_millis(config.io_timeout_ms);
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;

    let mut request = String::new();
    let mut reader = BufReader::new(stream.try_clone()?);
    reader.read_line(&mut request)?;

    let request = request.trim_end();
    let request_id = request
        .strip_prefix("PING ")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "expected PING <id>"))?;

    if config.service_delay_ms > 0 {
        thread::sleep(Duration::from_millis(config.service_delay_ms));
    }

    writeln!(stream, "PONG {request_id}")?;
    stream.flush()?;
    Ok(())
}

fn handle_proxy_connection(
    mut client: TcpStream,
    target: SocketAddr,
    config: &ProxyConfig,
    ordinal: usize,
) -> io::Result<()> {
    let timeout = Duration::from_millis(config.io_timeout_ms);
    client.set_read_timeout(Some(timeout))?;
    client.set_write_timeout(Some(timeout))?;

    if config.drop_every > 0 && ordinal.is_multiple_of(config.drop_every) {
        return Ok(());
    }

    let mut request = String::new();
    let mut client_reader = BufReader::new(client.try_clone()?);
    client_reader.read_line(&mut request)?;

    if config.one_way_delay_ms > 0 {
        thread::sleep(Duration::from_millis(config.one_way_delay_ms));
    }

    let mut upstream = TcpStream::connect_timeout(&target, timeout)?;
    upstream.set_read_timeout(Some(timeout))?;
    upstream.set_write_timeout(Some(timeout))?;
    upstream.write_all(request.as_bytes())?;
    upstream.flush()?;

    let mut response = String::new();
    let mut upstream_reader = BufReader::new(upstream);
    upstream_reader.read_line(&mut response)?;

    if config.one_way_delay_ms > 0 {
        thread::sleep(Duration::from_millis(config.one_way_delay_ms));
    }

    client.write_all(response.as_bytes())?;
    client.flush()?;
    Ok(())
}

fn probe_once(address: SocketAddr, request_id: usize, timeout_ms: u64) -> ProbeSample {
    let started = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    let result = (|| -> io::Result<bool> {
        let mut stream = TcpStream::connect_timeout(&address, timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        writeln!(stream, "PING {request_id}")?;
        stream.flush()?;

        let mut response = String::new();
        let mut reader = BufReader::new(stream);
        let read = reader.read_line(&mut response)?;
        Ok(read > 0 && response.trim_end() == format!("PONG {request_id}"))
    })();

    let latency_ms = started.elapsed().as_secs_f64() * 1000.0;
    match result {
        Ok(true) => ProbeSample {
            request_id,
            success: true,
            latency_ms,
            error: None,
        },
        Ok(false) => ProbeSample {
            request_id,
            success: false,
            latency_ms,
            error: Some("unexpected or empty response".to_string()),
        },
        Err(error) => ProbeSample {
            request_id,
            success: false,
            latency_ms,
            error: Some(error.to_string()),
        },
    }
}

fn summarize(samples: Vec<ProbeSample>) -> ExperimentSummary {
    let attempted = samples.len();
    let succeeded = samples.iter().filter(|sample| sample.success).count();
    let failed = attempted - succeeded;
    let latencies: Vec<f64> = samples
        .iter()
        .filter(|sample| sample.success)
        .map(|sample| sample.latency_ms)
        .collect();

    ExperimentSummary {
        attempted,
        succeeded,
        failed,
        success_rate: if attempted == 0 {
            1.0
        } else {
            succeeded as f64 / attempted as f64
        },
        mean_latency_ms: mean(&latencies),
        p50_latency_ms: percentile(&latencies, 0.50),
        p95_latency_ms: percentile(&latencies, 0.95),
        samples,
    }
}

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(values.iter().sum::<f64>() / values.len() as f64)
}

fn percentile(values: &[f64], percentile_value: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }

    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = (percentile_value * sorted.len() as f64).ceil() as usize;
    sorted.get(rank.saturating_sub(1)).copied()
}

fn join_workers(workers: Vec<thread::JoinHandle<io::Result<()>>>) -> io::Result<()> {
    for worker in workers {
        match worker.join() {
            Ok(result) => result?,
            Err(_) => return Err(io::Error::other("connection worker panicked")),
        }
    }
    Ok(())
}

fn json_number(value: Option<f64>) -> String {
    match value {
        Some(value) if value.is_finite() => format!("{value:.6}"),
        _ => "null".to_string(),
    }
}
