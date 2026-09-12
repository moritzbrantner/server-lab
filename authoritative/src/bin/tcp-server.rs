use server_lab_authoritative::{
    AuthoritativeWorld, INPUT_DATAGRAM_BYTES, MAX_PLAYERS, TICK_HZ, Welcome, decode_input_datagram,
    encode_snapshot_datagram, encode_welcome,
};
use std::env;
use std::error::Error;
use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:9443";

#[derive(Default)]
struct LatestSnapshotState {
    pending: Option<Vec<u8>>,
    closed: bool,
}

#[derive(Default)]
struct LatestSnapshot {
    state: Mutex<LatestSnapshotState>,
    ready: Condvar,
}

impl LatestSnapshot {
    fn publish(&self, snapshot: &[u8]) -> bool {
        let mut state = self
            .state
            .lock()
            .expect("authoritative snapshot queue mutex poisoned");
        if state.closed {
            return false;
        }
        state.pending = Some(snapshot.to_vec());
        self.ready.notify_one();
        true
    }

    fn receive(&self) -> Option<Vec<u8>> {
        let mut state = self
            .state
            .lock()
            .expect("authoritative snapshot queue mutex poisoned");
        loop {
            if let Some(snapshot) = state.pending.take() {
                return Some(snapshot);
            }
            if state.closed {
                return None;
            }
            state = self
                .ready
                .wait(state)
                .expect("authoritative snapshot queue mutex poisoned while waiting");
        }
    }

    fn close(&self) {
        let mut state = self
            .state
            .lock()
            .expect("authoritative snapshot queue mutex poisoned");
        state.closed = true;
        state.pending = None;
        self.ready.notify_all();
    }
}

#[derive(Clone)]
struct ClientSink {
    player_id: u32,
    outbox: Arc<LatestSnapshot>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let bind_addr = env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_BIND_ADDR.to_owned())
        .parse::<SocketAddr>()?;
    let listener = TcpListener::bind(bind_addr)?;
    let world = Arc::new(Mutex::new(AuthoritativeWorld::new()));
    let clients = Arc::new(Mutex::new(Vec::<ClientSink>::new()));
    let next_player_id = Arc::new(AtomicU32::new(1));

    spawn_tick_loop(Arc::clone(&world), Arc::clone(&clients));
    eprintln!("authoritative TCP harness listening on {bind_addr}");

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let player_id = next_player_id.fetch_add(1, Ordering::Relaxed);
                if player_id == 0 {
                    eprintln!("player id space exhausted");
                    continue;
                }
                let world = Arc::clone(&world);
                let clients = Arc::clone(&clients);
                thread::spawn(move || {
                    if let Err(error) = handle_client(stream, player_id, &world, &clients) {
                        eprintln!("authoritative client {player_id} failed: {error}");
                    }
                });
            }
            Err(error) => eprintln!("authoritative accept failed: {error}"),
        }
    }
    Ok(())
}

fn spawn_tick_loop(world: Arc<Mutex<AuthoritativeWorld>>, clients: Arc<Mutex<Vec<ClientSink>>>) {
    thread::spawn(move || {
        let tick_period = Duration::from_millis(1_000 / u64::from(TICK_HZ));
        loop {
            let started = Instant::now();
            let encoded = {
                let mut world = world.lock().expect("authoritative world mutex poisoned");
                let snapshot = world
                    .advance_tick()
                    .expect("authoritative tick counter should not exhaust");
                encode_snapshot_datagram(&snapshot)
                    .expect("world-generated snapshot must satisfy protocol bounds")
            };

            let mut clients = clients
                .lock()
                .expect("authoritative client list mutex poisoned");
            clients.retain(|client| client.outbox.publish(&encoded));
            drop(clients);

            let elapsed = started.elapsed();
            if elapsed < tick_period {
                thread::sleep(tick_period - elapsed);
            }
        }
    });
}

fn handle_client(
    mut stream: TcpStream,
    player_id: u32,
    world: &Arc<Mutex<AuthoritativeWorld>>,
    clients: &Arc<Mutex<Vec<ClientSink>>>,
) -> io::Result<()> {
    stream.set_nodelay(true)?;
    let current_tick = {
        let mut world = world.lock().expect("authoritative world mutex poisoned");
        match world.add_player(player_id) {
            Ok(_) => world.tick(),
            Err(error) => {
                eprintln!("authoritative player {player_id} rejected: {error}");
                return Ok(());
            }
        }
    };

    let result = handle_admitted_client(&mut stream, player_id, current_tick, clients, world);
    world
        .lock()
        .expect("authoritative world mutex poisoned")
        .remove_player(player_id);
    let mut clients = clients
        .lock()
        .expect("authoritative client list mutex poisoned");
    clients.retain(|client| {
        if client.player_id == player_id {
            client.outbox.close();
            false
        } else {
            true
        }
    });
    result
}

fn handle_admitted_client(
    stream: &mut TcpStream,
    player_id: u32,
    current_tick: u64,
    clients: &Arc<Mutex<Vec<ClientSink>>>,
    world: &Arc<Mutex<AuthoritativeWorld>>,
) -> io::Result<()> {
    let welcome = encode_welcome(Welcome {
        player_id,
        tick_hz: TICK_HZ,
        max_players: MAX_PLAYERS as u8,
        current_tick,
    });
    write_frame(stream, &welcome)?;

    let mut writer = stream.try_clone()?;
    let outbox = Arc::new(LatestSnapshot::default());
    clients
        .lock()
        .expect("authoritative client list mutex poisoned")
        .push(ClientSink {
            player_id,
            outbox: Arc::clone(&outbox),
        });
    let writer_outbox = Arc::clone(&outbox);
    let writer_thread = thread::spawn(move || {
        while let Some(snapshot) = writer_outbox.receive() {
            if write_frame(&mut writer, &snapshot).is_err() {
                writer_outbox.close();
                let _ = writer.shutdown(Shutdown::Both);
                break;
            }
        }
    });

    let result = read_inputs(stream, player_id, world);
    outbox.close();
    let _ = writer_thread.join();
    result
}

fn read_inputs(
    stream: &mut TcpStream,
    player_id: u32,
    world: &Arc<Mutex<AuthoritativeWorld>>,
) -> io::Result<()> {
    let mut input_bytes = [0_u8; INPUT_DATAGRAM_BYTES];
    loop {
        match stream.read_exact(&mut input_bytes) {
            Ok(()) => match decode_input_datagram(&input_bytes) {
                Ok(input) => {
                    let result = world
                        .lock()
                        .expect("authoritative world mutex poisoned")
                        .submit_input(player_id, input);
                    if let Err(error) = result {
                        eprintln!("authoritative input from player {player_id} rejected: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("malformed authoritative input from player {player_id}: {error}");
                    return Ok(());
                }
            },
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::UnexpectedEof
                        | io::ErrorKind::ConnectionReset
                        | io::ErrorKind::BrokenPipe
                ) =>
            {
                return Ok(());
            }
            Err(error) => return Err(error),
        }
    }
}

fn write_frame(stream: &mut TcpStream, payload: &[u8]) -> io::Result<()> {
    let length = u16::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "frame exceeds u16 length"))?;
    stream.write_all(&length.to_be_bytes())?;
    stream.write_all(payload)?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_snapshot_replaces_an_older_pending_snapshot() {
        let outbox = LatestSnapshot::default();
        assert!(outbox.publish(&[1]));
        assert!(outbox.publish(&[2]));
        assert_eq!(outbox.receive(), Some(vec![2]));
        outbox.close();
        assert_eq!(outbox.receive(), None);
        assert!(!outbox.publish(&[3]));
    }
}
