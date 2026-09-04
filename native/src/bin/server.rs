use std::env;
use std::error::Error;
use std::net::TcpListener;

use server_lab_native::{ServerConfig, serve};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    let listen = args.first().map(String::as_str).unwrap_or("127.0.0.1:9000");
    let service_delay_ms = parse_or(&args, 1, 0_u64)?;
    let max_connections = parse_or(&args, 2, usize::MAX)?;

    let listener = TcpListener::bind(listen)?;
    eprintln!(
        "server-lab native server listening on {} (service delay: {} ms)",
        listener.local_addr()?,
        service_delay_ms
    );

    serve(
        listener,
        ServerConfig {
            service_delay_ms,
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
