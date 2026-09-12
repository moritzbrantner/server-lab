use server_lab_authoritative::{
    AuthoritativeWorld, MAX_PLAYERS, SNAPSHOT_HEADER_BYTES, SNAPSHOT_PLAYER_BYTES, TICK_HZ,
    Welcome, decode_input_datagram, encode_snapshot_datagram, encode_welcome,
};
use std::env;
use std::error::Error;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tokio::sync::{Mutex, broadcast};
use tokio::time::MissedTickBehavior;
use wtransport::{Connection, Endpoint, Identity, ServerConfig, VarInt};

const DEFAULT_PORT: u16 = 4433;
const SESSION_PATH: &str = "/authoritative";
const CLOSE_PROTOCOL: u32 = 1;
const CLOSE_CAPACITY: u32 = 2;
const CLOSE_DATAGRAM: u32 = 3;
const CLOSE_SERVER: u32 = 4;
const SNAPSHOT_CHANNEL_DEPTH: usize = 1;
const MAX_SNAPSHOT_BYTES: usize = SNAPSHOT_HEADER_BYTES + MAX_PLAYERS * SNAPSHOT_PLAYER_BYTES;

#[derive(Clone)]
struct ServerState {
    world: Arc<Mutex<AuthoritativeWorld>>,
    snapshots: broadcast::Sender<Vec<u8>>,
    next_player_id: Arc<AtomicU32>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let port = env::var("AUTHORITATIVE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let certificate = env::var("AUTHORITATIVE_CERT_PEM")
        .unwrap_or_else(|_| "cert.pem".to_owned());
    let private_key = env::var("AUTHORITATIVE_KEY_PEM")
        .unwrap_or_else(|_| "key.pem".to_owned());

    let identity = Identity::load_pemfiles(&certificate, &private_key).await?;
    let config = ServerConfig::builder()
        .with_bind_default(port)
        .with_identity(identity)
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();
    let endpoint = Endpoint::server(config)?;

    let (snapshots, _) = broadcast::channel::<Vec<u8>>(SNAPSHOT_CHANNEL_DEPTH);
    let state = ServerState {
        world: Arc::new(Mutex::new(AuthoritativeWorld::new())),
        snapshots,
        next_player_id: Arc::new(AtomicU32::new(1)),
    };
    spawn_tick_loop(state.clone());

    eprintln!(
        "authoritative WebTransport server listening on https://localhost:{port}{SESSION_PATH}"
    );

    loop {
        let incoming = endpoint.accept().await;
        let state = state.clone();
        tokio::spawn(async move {
            let request = match incoming.await {
                Ok(request) => request,
                Err(error) => {
                    eprintln!("WebTransport session negotiation failed: {error}");
                    return;
                }
            };
            if request.path() != SESSION_PATH {
                request.not_found().await;
                return;
            }
            let connection = match request.accept().await {
                Ok(connection) => connection,
                Err(error) => {
                    eprintln!("WebTransport session acceptance failed: {error}");
                    return;
                }
            };
            if let Err(error) = handle_connection(connection, state).await {
                eprintln!("authoritative WebTransport session failed: {error}");
            }
        });
    }
}

fn spawn_tick_loop(state: ServerState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(1_000 / u64::from(TICK_HZ)));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            let encoded = {
                let mut world = state.world.lock().await;
                match world.advance_tick() {
                    Ok(snapshot) => match encode_snapshot_datagram(&snapshot) {
                        Ok(encoded) => encoded,
                        Err(error) => {
                            eprintln!("authoritative snapshot encoding failed: {error}");
                            continue;
                        }
                    },
                    Err(error) => {
                        eprintln!("authoritative tick failed: {error}");
                        continue;
                    }
                }
            };
            let _ = state.snapshots.send(encoded);
        }
    });
}

async fn handle_connection(connection: Connection, state: ServerState) -> Result<(), String> {
    let max_datagram_size = match connection.max_datagram_size() {
        Some(max_datagram_size) if max_datagram_size >= MAX_SNAPSHOT_BYTES => max_datagram_size,
        Some(max_datagram_size) => {
            close(
                &connection,
                CLOSE_DATAGRAM,
                &format!("datagram budget {max_datagram_size} is below {MAX_SNAPSHOT_BYTES}"),
            );
            return Ok(());
        }
        None => {
            close(
                &connection,
                CLOSE_DATAGRAM,
                "WebTransport datagrams are required",
            );
            return Ok(());
        }
    };

    let player_id = state.next_player_id.fetch_add(1, Ordering::Relaxed);
    if player_id == 0 {
        close(&connection, CLOSE_SERVER, "player id space exhausted");
        return Ok(());
    }

    let current_tick = {
        let mut world = state.world.lock().await;
        match world.add_player(player_id) {
            Ok(_) => world.tick(),
            Err(error) => {
                close(&connection, CLOSE_CAPACITY, &error.to_string());
                return Ok(());
            }
        }
    };

    let result = run_admitted_connection(
        &connection,
        player_id,
        current_tick,
        max_datagram_size,
        &state,
    )
    .await;
    state.world.lock().await.remove_player(player_id);
    result
}

async fn run_admitted_connection(
    connection: &Connection,
    player_id: u32,
    current_tick: u64,
    max_datagram_size: usize,
    state: &ServerState,
) -> Result<(), String> {
    let welcome = encode_welcome(Welcome {
        player_id,
        tick_hz: TICK_HZ,
        max_players: MAX_PLAYERS as u8,
        current_tick,
    });
    let opening = connection.open_uni().await.map_err(|error| error.to_string())?;
    let mut welcome_stream = opening.await.map_err(|error| error.to_string())?;
    welcome_stream
        .write_all(&welcome)
        .await
        .map_err(|error| error.to_string())?;
    welcome_stream
        .finish()
        .await
        .map_err(|error| error.to_string())?;

    let mut snapshots = state.snapshots.subscribe();
    loop {
        tokio::select! {
            datagram = connection.receive_datagram() => {
                match datagram {
                    Ok(datagram) => match decode_input_datagram(datagram.as_ref()) {
                        Ok(input) => {
                            if let Err(error) = state.world.lock().await.submit_input(player_id, input) {
                                close(connection, CLOSE_PROTOCOL, &error.to_string());
                                return Ok(());
                            }
                        }
                        Err(error) => {
                            close(connection, CLOSE_PROTOCOL, &error.to_string());
                            return Ok(());
                        }
                    },
                    Err(_) => return Ok(()),
                }
            }
            snapshot = snapshots.recv() => {
                match snapshot {
                    Ok(snapshot) => {
                        if snapshot.len() > max_datagram_size {
                            close(connection, CLOSE_DATAGRAM, "authoritative snapshot exceeds negotiated datagram budget");
                            return Ok(());
                        }
                        // Authoritative snapshots are latest-state messages. Under datagram congestion,
                        // skipping a send is preferable to building a reliable stale-state queue.
                        let _ = connection.send_datagram(snapshot);
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // The next broadcast is newer and authoritative; do not replay stale snapshots.
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        close(connection, CLOSE_SERVER, "authoritative snapshot source closed");
                        return Ok(());
                    }
                }
            }
            _ = connection.closed() => return Ok(()),
        }
    }
}

fn close(connection: &Connection, code: u32, reason: &str) {
    connection.close(VarInt::from_u32(code), reason.as_bytes());
}
