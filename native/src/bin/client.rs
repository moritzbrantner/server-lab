use std::env;
use std::error::Error;
use std::net::SocketAddr;

use server_lab_native::{ClientConfig, run_client};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    let address: SocketAddr = args
        .first()
        .map(String::as_str)
        .unwrap_or("127.0.0.1:9000")
        .parse()?;
    let request_count = parse_or(&args, 1, 20_usize)?;
    let timeout_ms = parse_or(&args, 2, 1_000_u64)?;
    let interval_ms = parse_or(&args, 3, 0_u64)?;

    let summary = run_client(
        address,
        &ClientConfig {
            request_count,
            timeout_ms,
            interval_ms,
        },
    );
    println!("{}", summary.to_json());
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
