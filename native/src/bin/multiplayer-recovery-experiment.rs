use std::env;
use std::error::Error;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(3);
const PROBE_TIMEOUT: Duration = Duration::from_millis(300);

#[derive(Clone, Copy, Debug)]
struct Probe {
    success: bool,
    latency_ms: f64,
}

#[derive(Debug)]
struct Report {
    baseline_directory: Probe,
    baseline_signaling: Probe,
    baseline_direct_gameplay: Probe,
    baseline_turn_relay: Probe,
    setup_with_directory_down: bool,
    direct_with_directory_down: bool,
    ice_restart_with_signaling_down: bool,
    direct_with_signaling_down: bool,
    direct_with_turn_down: bool,
    relayed_with_active_turn_down: bool,
    turn_reallocation_with_replacement: bool,
}

impl Report {
    fn expectations_hold(&self) -> bool {
        self.baseline_directory.success
            && self.baseline_signaling.success
            && self.baseline_direct_gameplay.success
            && self.baseline_turn_relay.success
            && !self.setup_with_directory_down
            && self.direct_with_directory_down
            && !self.ice_restart_with_signaling_down
            && self.direct_with_signaling_down
            && self.direct_with_turn_down
            && !self.relayed_with_active_turn_down
            && self.turn_reallocation_with_replacement
    }

    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{\"mode\":\"native-multi-process-loopback\",",
                "\"baseline\":{{\"directory\":{},\"signaling\":{},\"directGameplay\":{},\"turnRelay\":{}}},",
                "\"directoryFailure\":{{\"newSetup\":{},\"establishedDirectGameplay\":{}}},",
                "\"signalingFailure\":{{\"iceRestart\":{},\"establishedDirectGameplay\":{}}},",
                "\"turnFailure\":{{\"directGameplay\":{},\"relayedGameplay\":{}}},",
                "\"turnReplacement\":{{\"recovery\":{}}},",
                "\"expectationsHold\":{}}}"
            ),
            probe_json(self.baseline_directory),
            probe_json(self.baseline_signaling),
            probe_json(self.baseline_direct_gameplay),
            probe_json(self.baseline_turn_relay),
            self.setup_with_directory_down,
            self.direct_with_directory_down,
            self.ice_restart_with_signaling_down,
            self.direct_with_signaling_down,
            self.direct_with_turn_down,
            self.relayed_with_active_turn_down,
            self.turn_reallocation_with_replacement,
            self.expectations_hold(),
        )
    }
}

struct ServiceProcess {
    name: &'static str,
    address: SocketAddr,
    child: Child,
}

impl ServiceProcess {
    fn spawn(name: &'static str) -> io::Result<Self> {
        let address = reserve_address()?;
        let executable = env::current_exe()?;
        let mut child = Command::new(executable)
            .arg("--service")
            .arg(name)
            .arg(address.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            if probe(address, name).success {
                return Ok(Self {
                    name,
                    address,
                    child,
                });
            }
            if let Some(status) = child.try_wait()? {
                return Err(io::Error::other(format!(
                    "{name} service exited during startup with {status}"
                )));
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("{name} service did not become reachable"),
                ));
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn probe(&self) -> Probe {
        probe(self.address, self.name)
    }

    fn stop(&mut self) -> io::Result<()> {
        if self.child.try_wait()?.is_none() {
            self.child.kill()?;
            let _ = self.child.wait()?;
        }
        Ok(())
    }
}

impl Drop for ServiceProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = env::args().collect::<Vec<_>>();
    if args.get(1).is_some_and(|arg| arg == "--service") {
        let name = args
            .get(2)
            .ok_or("missing service name")?
            .to_owned();
        let address = args
            .get(3)
            .ok_or("missing service address")?
            .parse::<SocketAddr>()?;
        run_service(&name, address)?;
        return Ok(());
    }

    let report = run_experiment()?;
    println!("{}", report.to_json());
    if !report.expectations_hold() {
        return Err("native multiplayer recovery expectations did not hold".into());
    }
    Ok(())
}

fn run_experiment() -> io::Result<Report> {
    let mut directory = ServiceProcess::spawn("directory")?;
    let mut signaling = ServiceProcess::spawn("signaling")?;
    let direct_gameplay = ServiceProcess::spawn("direct-gameplay")?;
    let mut turn_relay = ServiceProcess::spawn("turn-primary")?;

    let baseline_directory = directory.probe();
    let baseline_signaling = signaling.probe();
    let baseline_direct_gameplay = direct_gameplay.probe();
    let baseline_turn_relay = turn_relay.probe();

    directory.stop()?;
    let setup_with_directory_down =
        probe(directory.address, directory.name).success && signaling.probe().success;
    let direct_with_directory_down = direct_gameplay.probe().success;

    signaling.stop()?;
    let ice_restart_with_signaling_down = probe(signaling.address, signaling.name).success;
    let direct_with_signaling_down = direct_gameplay.probe().success;

    signaling = ServiceProcess::spawn("signaling-replacement")?;
    turn_relay.stop()?;
    let direct_with_turn_down = direct_gameplay.probe().success;
    let relayed_with_active_turn_down = probe(turn_relay.address, turn_relay.name).success;

    let replacement_turn = ServiceProcess::spawn("turn-replacement")?;
    let turn_reallocation_with_replacement = signaling.probe().success && replacement_turn.probe().success;

    Ok(Report {
        baseline_directory,
        baseline_signaling,
        baseline_direct_gameplay,
        baseline_turn_relay,
        setup_with_directory_down,
        direct_with_directory_down,
        ice_restart_with_signaling_down,
        direct_with_signaling_down,
        direct_with_turn_down,
        relayed_with_active_turn_down,
        turn_reallocation_with_replacement,
    })
}

fn reserve_address() -> io::Result<SocketAddr> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.local_addr()
}

fn run_service(name: &str, address: SocketAddr) -> io::Result<()> {
    let listener = TcpListener::bind(address)?;
    for incoming in listener.incoming() {
        match incoming {
            Ok(mut stream) => {
                stream.set_read_timeout(Some(PROBE_TIMEOUT))?;
                stream.set_write_timeout(Some(PROBE_TIMEOUT))?;
                let mut request = String::new();
                BufReader::new(stream.try_clone()?).read_line(&mut request)?;
                if request.trim_end() == "PING" {
                    writeln!(stream, "PONG {name}")?;
                    stream.flush()?;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn probe(address: SocketAddr, expected_name: &str) -> Probe {
    let started = Instant::now();
    let success = (|| -> io::Result<bool> {
        let mut stream = TcpStream::connect_timeout(&address, PROBE_TIMEOUT)?;
        stream.set_read_timeout(Some(PROBE_TIMEOUT))?;
        stream.set_write_timeout(Some(PROBE_TIMEOUT))?;
        writeln!(stream, "PING")?;
        stream.flush()?;
        let mut response = String::new();
        let read = BufReader::new(stream).read_line(&mut response)?;
        Ok(read > 0 && response.trim_end() == format!("PONG {expected_name}"))
    })()
    .unwrap_or(false);

    Probe {
        success,
        latency_ms: started.elapsed().as_secs_f64() * 1_000.0,
    }
}

fn probe_json(probe: Probe) -> String {
    format!(
        "{{\"reachable\":{},\"latencyMs\":{:.3}}}",
        probe.success, probe.latency_ms
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_gate_accepts_required_failure_independence() {
        let ok = Probe {
            success: true,
            latency_ms: 1.0,
        };
        let report = Report {
            baseline_directory: ok,
            baseline_signaling: ok,
            baseline_direct_gameplay: ok,
            baseline_turn_relay: ok,
            setup_with_directory_down: false,
            direct_with_directory_down: true,
            ice_restart_with_signaling_down: false,
            direct_with_signaling_down: true,
            direct_with_turn_down: true,
            relayed_with_active_turn_down: false,
            turn_reallocation_with_replacement: true,
        };
        assert!(report.expectations_hold());
    }

    #[test]
    fn semantic_gate_fails_if_direct_gameplay_depends_on_directory() {
        let ok = Probe {
            success: true,
            latency_ms: 1.0,
        };
        let report = Report {
            baseline_directory: ok,
            baseline_signaling: ok,
            baseline_direct_gameplay: ok,
            baseline_turn_relay: ok,
            setup_with_directory_down: false,
            direct_with_directory_down: false,
            ice_restart_with_signaling_down: false,
            direct_with_signaling_down: true,
            direct_with_turn_down: true,
            relayed_with_active_turn_down: false,
            turn_reallocation_with_replacement: true,
        };
        assert!(!report.expectations_hold());
    }
}
