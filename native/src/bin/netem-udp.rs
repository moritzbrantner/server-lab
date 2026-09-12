use std::collections::HashSet;
use std::env;
use std::error::Error;
use std::io;
use std::net::{SocketAddr, UdpSocket};
use std::thread;
use std::time::{Duration, Instant};

fn main() -> Result<(), Box<dyn Error>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str) {
        Some("server") => run_server(&args[1..]),
        Some("client") => run_client(&args[1..]),
        _ => Err("usage: netem-udp <server|client> ...".into()),
    }
}

fn run_server(args: &[String]) -> Result<(), Box<dyn Error>> {
    let address: SocketAddr = args
        .first()
        .map(String::as_str)
        .unwrap_or("127.0.0.1:9001")
        .parse()?;
    let socket = UdpSocket::bind(address)?;
    socket.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut buffer = [0_u8; 8];
    loop {
        match socket.recv_from(&mut buffer) {
            Ok((8, peer)) => {
                socket.send_to(&buffer, peer)?;
            }
            Ok(_) => continue,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ) =>
            {
                break;
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn run_client(args: &[String]) -> Result<(), Box<dyn Error>> {
    let address: SocketAddr = args
        .first()
        .map(String::as_str)
        .unwrap_or("127.0.0.1:9001")
        .parse()?;
    let packet_count = parse_or(args, 1, 200_u64)?;
    let interval_ms = parse_or(args, 2, 1_u64)?;
    let receive_timeout_ms = parse_or(args, 3, 3_000_u64)?;

    let socket = UdpSocket::bind("0.0.0.0:0")?;
    socket.connect(address)?;
    socket.set_read_timeout(Some(Duration::from_millis(100)))?;

    for sequence in 0..packet_count {
        socket.send(&sequence.to_be_bytes())?;
        if interval_ms > 0 {
            thread::sleep(Duration::from_millis(interval_ms));
        }
    }

    let deadline = Instant::now() + Duration::from_millis(receive_timeout_ms);
    let mut received = HashSet::new();
    let mut duplicate_packets = 0_u64;
    let mut reordered_packets = 0_u64;
    let mut highest_sequence = 0_u64;
    let mut has_sequence = false;
    let mut buffer = [0_u8; 8];

    while Instant::now() < deadline && received.len() < packet_count as usize {
        match socket.recv(&mut buffer) {
            Ok(8) => {
                let sequence = u64::from_be_bytes(buffer);
                if !received.insert(sequence) {
                    duplicate_packets += 1;
                    continue;
                }
                if has_sequence && sequence < highest_sequence {
                    reordered_packets += 1;
                }
                highest_sequence = highest_sequence.max(sequence);
                has_sequence = true;
            }
            Ok(_) => continue,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ) => {}
            Err(error) => return Err(error.into()),
        }
    }

    let received_packets = received.len() as u64;
    let lost_packets = packet_count.saturating_sub(received_packets);
    println!(
        "{{\"sentPackets\":{packet_count},\"receivedPackets\":{received_packets},\"lostPackets\":{lost_packets},\"duplicatePackets\":{duplicate_packets},\"reorderedPackets\":{reordered_packets}}}"
    );
    Ok(())
}

fn parse_or<T>(args: &[String], index: usize, default: T) -> Result<T, T::Err>
where
    T: std::str::FromStr,
{
    match args.get(index) {
        Some(value) => value.parse(),
        None => Ok(default),
    }
}
