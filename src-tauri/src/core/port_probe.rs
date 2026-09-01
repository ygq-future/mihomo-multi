use std::net::{SocketAddrV4, TcpListener};

/// Probes whether a given TCP port is available on localhost (127.0.0.1).
pub fn is_port_available(port: u16) -> bool {
    let addr = SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, port);
    TcpListener::bind(addr).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_port_probe_available() {
        // Ephemeral port test: bind a listener to port 0 to get an OS assigned free port
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral port");
        let port = listener.local_addr().expect("Failed to get local addr").port();

        // While listener is held, port should NOT be available
        assert!(!is_port_available(port));

        // Drop listener to release port
        drop(listener);

        // Port should now be available
        assert!(is_port_available(port));
    }
}
