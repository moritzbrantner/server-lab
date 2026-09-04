use std::net::TcpListener;
use std::thread;

use server_lab_native::{
    ClientConfig, LoopbackExperimentConfig, ProxyConfig, ServerConfig, run_client,
    run_loopback_experiment, serve, serve_proxy,
};

#[test]
fn direct_server_round_trip_succeeds() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind server");
    let address = listener.local_addr().expect("server address");
    let server = thread::spawn(move || {
        serve(
            listener,
            ServerConfig {
                service_delay_ms: 1,
                io_timeout_ms: 1_000,
            },
            3,
        )
        .expect("serve requests");
    });

    let summary = run_client(
        address,
        &ClientConfig {
            request_count: 3,
            timeout_ms: 1_000,
            interval_ms: 0,
        },
    );

    server.join().expect("server thread");
    assert_eq!(summary.succeeded, 3);
    assert_eq!(summary.failed, 0);
    assert_eq!(summary.success_rate, 1.0);
}

#[test]
fn proxy_adds_delay_and_drops_every_second_request() {
    let backend_listener = TcpListener::bind("127.0.0.1:0").expect("bind backend");
    let backend_address = backend_listener.local_addr().expect("backend address");
    let backend = thread::spawn(move || {
        serve(
            backend_listener,
            ServerConfig {
                service_delay_ms: 1,
                io_timeout_ms: 1_000,
            },
            2,
        )
        .expect("serve proxied successes");
    });

    let proxy_listener = TcpListener::bind("127.0.0.1:0").expect("bind proxy");
    let proxy_address = proxy_listener.local_addr().expect("proxy address");
    let proxy = thread::spawn(move || {
        serve_proxy(
            proxy_listener,
            backend_address,
            ProxyConfig {
                one_way_delay_ms: 8,
                drop_every: 2,
                io_timeout_ms: 1_000,
            },
            4,
        )
        .expect("serve proxy requests");
    });

    let summary = run_client(
        proxy_address,
        &ClientConfig {
            request_count: 4,
            timeout_ms: 1_000,
            interval_ms: 0,
        },
    );

    proxy.join().expect("proxy thread");
    backend.join().expect("backend thread");
    assert_eq!(summary.succeeded, 2);
    assert_eq!(summary.failed, 2);
    assert!(summary.mean_latency_ms.expect("mean latency") >= 12.0);
}

#[test]
fn loopback_runner_compares_expected_and_measured_effects() {
    let report = run_loopback_experiment(&LoopbackExperimentConfig {
        request_count: 10,
        service_delay_ms: 2,
        proxy_one_way_delay_ms: 6,
        drop_every: 5,
        timeout_ms: 1_000,
    })
    .expect("run loopback experiment");

    assert_eq!(report.baseline.succeeded, 10);
    assert_eq!(report.expected_impaired_successes, 8);
    assert_eq!(report.impaired.succeeded, 8);
    assert!(report.expectations_hold());
}
