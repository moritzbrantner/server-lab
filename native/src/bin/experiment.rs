use std::env;
use std::error::Error;

use server_lab_native::{LoopbackExperimentConfig, run_loopback_experiment};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    let request_count = parse_or(&args, 0, 20_usize)?;
    let proxy_one_way_delay_ms = parse_or(&args, 1, 20_u64)?;
    let drop_every = parse_or(&args, 2, 5_usize)?;
    let service_delay_ms = parse_or(&args, 3, 5_u64)?;
    let timeout_ms = parse_or(&args, 4, 1_000_u64)?;

    let report = run_loopback_experiment(&LoopbackExperimentConfig {
        request_count,
        service_delay_ms,
        proxy_one_way_delay_ms,
        drop_every,
        timeout_ms,
    })?;

    println!("{}", report.to_json());
    if !report.expectations_hold() {
        std::process::exit(2);
    }
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
