use std::env;
use std::error::Error;
use std::net::{SocketAddr, TcpListener};

use server_lab_native::{ProxyConfig, serve_proxy};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    let listen = args.first().map(String::as_str).unwrap_or("127.0.0.1:9100");
    let target: SocketAddr = args
        .get(1)
        .map(String::as_str)
        .unwrap_or("127.0.0.1:9000")
        .parse()?;
    let one_way_delay_ms = parse_or(&args, 2, 0_u64)?;
    let drop_every = parse_or(&args, 3, 0_usize)?;
    let max_connections = parse_or(&args, 4, usize::MAX)?;

    let listener = TcpListener::bind(listen)?;
    eprintln!(
        "server-lab fault proxy listening on {} -> {} (delay: {} ms each way, drop every: {})",
        listener.local_addr()?,
        target,
        one_way_delay_ms,
        drop_every
    );

    serve_proxy(
        listener,
        target,
        ProxyConfig {
            one_way_delay_ms,
            drop_every,
            io_timeout_ms: 5_000,
        },
        max_connections,
    )?;
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
