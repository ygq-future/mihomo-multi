use crate::models::{InboundProtocol, PortMapping};
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddrV4, SocketAddrV6, TcpStream};
use std::time::Duration;
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, MIB_UDP6ROW_OWNER_PID,
    MIB_UDPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
};
#[cfg(windows)]
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};

/// Socket families a Mihomo inbound listener binds for a given port mapping.
///
/// `http` inbounds only serve TCP, while `mixed` / `socks` inbounds also relay UDP and therefore
/// own a UDP endpoint on the same port (observed on a live core: `http` bound TCP only, `mixed`
/// and `socks` bound both).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortTransport {
    Tcp,
    TcpAndUdp,
}

/// The socket family held by a third-party process that blocks our listener.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictTransport {
    Tcp,
    Udp,
}

/// A port held by a process other than our own sidecar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PortConflict {
    pub transport: ConflictTransport,
    pub owner_pid: u32,
}

/// Maps a configured inbound protocol onto the socket families its Mihomo listener will bind.
pub fn transport_for(protocol: InboundProtocol) -> PortTransport {
    match protocol {
        InboundProtocol::Http => PortTransport::Tcp,
        InboundProtocol::Mixed | InboundProtocol::Socks5 => PortTransport::TcpAndUdp,
    }
}

/// Probes whether `port` can be bound for `transport`.
///
/// `exclude_pid` is our own sidecar process: sockets it already owns are not conflicts.
pub fn is_port_available(port: u16, transport: PortTransport, allow_lan: bool, exclude_pid: Option<u32>) -> bool {
    // Without a PID to exclude (cold start, user-facing checks) an accepted handshake is the
    // cheapest signal that something is already serving the port.
    if exclude_pid.is_none() && tcp_accepts_connection(port) {
        return false;
    }

    if find_port_conflict(port, transport, exclude_pid).is_some() {
        return false;
    }

    // Our own listening sockets would fail the bind probe below, so the kernel tables decide.
    if exclude_pid.is_some() {
        return true;
    }

    bind_probe_succeeds(port, transport, allow_lan)
}

/// Resolves which third-party process blocks `port`, if any.
pub fn find_port_conflict(port: u16, transport: PortTransport, exclude_pid: Option<u32>) -> Option<PortConflict> {
    #[cfg(windows)]
    {
        for owner_pid in [tcp_v4_listener_owner(port), tcp_v6_listener_owner(port)].into_iter().flatten() {
            if is_third_party_owner(owner_pid, exclude_pid) {
                return Some(PortConflict {
                    transport: ConflictTransport::Tcp,
                    owner_pid,
                });
            }
        }

        if transport == PortTransport::TcpAndUdp {
            for owner_pid in [udp_v4_owner(port), udp_v6_owner(port)].into_iter().flatten() {
                if is_third_party_owner(owner_pid, exclude_pid) {
                    return Some(PortConflict {
                        transport: ConflictTransport::Udp,
                        owner_pid,
                    });
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (port, transport, exclude_pid);
    }

    None
}

/// Windows reports `dwOwningPid == 0` for endpoints it cannot attribute (kernel-owned sockets and
/// sockets inside isolated sessions). Such a row never counts as a third-party conflict: mistaking
/// our own listener for a foreign one would drop a working port for the rest of the session.
#[cfg(windows)]
fn is_third_party_owner(owner_pid: u32, exclude_pid: Option<u32>) -> bool {
    owner_pid != 0 && exclude_pid != Some(owner_pid)
}

/// Returns the first skipped port that can be bound again by our own sidecar.
///
/// An occupancy verdict is a point-in-time sample: a port skipped because another application held
/// it must be re-probed later, otherwise its listener stays missing for the rest of the session.
pub fn first_recoverable_port(
    skipped_ports: &[u16],
    mappings: &[PortMapping],
    allow_lan: bool,
    own_core_pid: u32,
) -> Option<u16> {
    skipped_ports.iter().copied().find(|port| {
        mappings
            .iter()
            .find(|m| m.port == *port && m.enabled)
            .is_some_and(|m| is_port_available(*port, transport_for(m.protocol), allow_lan, Some(own_core_pid)))
    })
}

fn tcp_accepts_connection(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(30),
    )
    .is_ok()
        || TcpStream::connect_timeout(
            &SocketAddrV6::new(Ipv6Addr::LOCALHOST, port, 0, 0).into(),
            Duration::from_millis(30),
        )
        .is_ok()
}

/// Last-resort probe used when the kernel tables cannot decide (non-Windows, or a table read that
/// failed). Binds every socket family the listener is going to use.
fn bind_probe_succeeds(port: u16, transport: PortTransport, allow_lan: bool) -> bool {
    let bind_ip = if allow_lan {
        Ipv4Addr::UNSPECIFIED // 0.0.0.0
    } else {
        Ipv4Addr::LOCALHOST // 127.0.0.1
    };

    let Ok(tcp_socket) = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)) else {
        return false;
    };

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawSocket;
        use windows_sys::Win32::Networking::WinSock::{SO_EXCLUSIVEADDRUSE, SOL_SOCKET, setsockopt};

        let optval: i32 = 1;
        unsafe {
            let _ = setsockopt(
                tcp_socket.as_raw_socket() as usize,
                SOL_SOCKET,
                SO_EXCLUSIVEADDRUSE,
                &optval as *const _ as *const _,
                std::mem::size_of::<i32>() as i32,
            );
        }
    }

    if tcp_socket.bind(&SocketAddrV4::new(bind_ip, port).into()).is_err() {
        return false;
    }

    if transport == PortTransport::TcpAndUdp {
        return std::net::UdpSocket::bind(SocketAddrV4::new(bind_ip, port)).is_ok();
    }

    true
}

/// `MIB_TCP_STATE.MIB_TCP_STATE_LISTEN`
#[cfg(windows)]
const TCP_STATE_LISTEN: u32 = 2;

/// MIB tables store ports in network byte order inside the low 16 bits of a DWORD.
#[cfg(windows)]
fn decode_table_port(raw: u32) -> u16 {
    u16::from_be((raw & 0xFFFF) as u16)
}

/// Listening sockets always report `MIB_TCP_STATE_LISTEN`; some sessions additionally surface them
/// with an empty state field, which is still identifiable by the absence of a peer endpoint.
#[cfg(windows)]
fn tcp_v4_row_is_listener(row: &MIB_TCPROW_OWNER_PID) -> bool {
    row.dwState == TCP_STATE_LISTEN
        || (row.dwState == 0 && row.dwRemoteAddr == 0 && row.dwRemotePort == 0)
}

#[cfg(windows)]
fn tcp_v6_row_is_listener(row: &MIB_TCP6ROW_OWNER_PID) -> bool {
    row.dwState == TCP_STATE_LISTEN
        || (row.dwState == 0 && row.dwRemoteScopeId == 0 && row.dwRemotePort == 0 && row.ucRemoteAddr == [0u8; 16])
}

/// Runs a `GetExtended*Table` call twice (size query, then fill) and returns an 8-byte aligned,
/// zero-initialised buffer holding the table image.
#[cfg(windows)]
fn query_ip_helper_table<F>(mut fill: F) -> Option<Vec<u64>>
where
    F: FnMut(*mut core::ffi::c_void, *mut u32) -> u32,
{
    let mut size: u32 = 0;
    let _ = fill(std::ptr::null_mut(), &mut size);
    if size == 0 {
        return None;
    }

    let mut buffer = vec![0u64; (size as usize).div_ceil(std::mem::size_of::<u64>()) + 1];
    let mut filled_size = size;
    if fill(buffer.as_mut_ptr().cast(), &mut filled_size) != 0 {
        return None;
    }

    Some(buffer)
}

/// Reads the `dwNumEntries` header and the row array that follows it.
///
/// # Safety
///
/// `buffer` must hold a complete `MIB_*TABLE_OWNER_PID` image whose header is a row count DWORD and
/// whose rows start at byte offset 4 and are laid out as `R`.
#[cfg(windows)]
unsafe fn table_rows<R>(buffer: &[u64]) -> &[R] {
    let count = unsafe { *(buffer.as_ptr() as *const u32) } as usize;
    let rows = unsafe { buffer.as_ptr().cast::<u8>().add(std::mem::size_of::<u32>()) } as *const R;
    unsafe { std::slice::from_raw_parts(rows, count) }
}

#[cfg(windows)]
fn tcp_v4_listener_owner(port: u16) -> Option<u32> {
    let buffer = query_ip_helper_table(|table, size| unsafe {
        GetExtendedTcpTable(table, size, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_ALL, 0)
    })?;
    let rows = unsafe { table_rows::<MIB_TCPROW_OWNER_PID>(&buffer) };

    rows.iter()
        .find(|row| tcp_v4_row_is_listener(row) && decode_table_port(row.dwLocalPort) == port)
        .map(|row| row.dwOwningPid)
}

#[cfg(windows)]
fn tcp_v6_listener_owner(port: u16) -> Option<u32> {
    let buffer = query_ip_helper_table(|table, size| unsafe {
        GetExtendedTcpTable(table, size, 0, AF_INET6 as u32, TCP_TABLE_OWNER_PID_ALL, 0)
    })?;
    let rows = unsafe { table_rows::<MIB_TCP6ROW_OWNER_PID>(&buffer) };

    rows.iter()
        .find(|row| tcp_v6_row_is_listener(row) && decode_table_port(row.dwLocalPort) == port)
        .map(|row| row.dwOwningPid)
}

#[cfg(windows)]
fn udp_v4_owner(port: u16) -> Option<u32> {
    let buffer = query_ip_helper_table(|table, size| unsafe {
        GetExtendedUdpTable(table, size, 0, AF_INET as u32, UDP_TABLE_OWNER_PID, 0)
    })?;
    let rows = unsafe { table_rows::<MIB_UDPROW_OWNER_PID>(&buffer) };

    rows.iter()
        .find(|row| decode_table_port(row.dwLocalPort) == port)
        .map(|row| row.dwOwningPid)
}

#[cfg(windows)]
fn udp_v6_owner(port: u16) -> Option<u32> {
    let buffer = query_ip_helper_table(|table, size| unsafe {
        GetExtendedUdpTable(table, size, 0, AF_INET6 as u32, UDP_TABLE_OWNER_PID, 0)
    })?;
    let rows = unsafe { table_rows::<MIB_UDP6ROW_OWNER_PID>(&buffer) };

    rows.iter()
        .find(|row| decode_table_port(row.dwLocalPort) == port)
        .map(|row| row.dwOwningPid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, UdpSocket};

    fn ephemeral_tcp_listener() -> (TcpListener, u16) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral port");
        let port = listener.local_addr().expect("Failed to get local addr").port();
        (listener, port)
    }

    fn enabled_mapping(port: u16, protocol: InboundProtocol) -> PortMapping {
        PortMapping {
            id: format!("mapping-{port}"),
            port,
            protocol,
            enabled: true,
            ..PortMapping::default()
        }
    }

    #[test]
    fn test_tcp_listener_blocks_port_and_releases_it() {
        let (listener, port) = ephemeral_tcp_listener();

        assert!(!is_port_available(port, PortTransport::Tcp, false, None));
        assert!(!is_port_available(port, PortTransport::TcpAndUdp, true, None));
        drop(listener);

        let mut available = false;
        for _ in 0..20 {
            if is_port_available(port, PortTransport::Tcp, false, None) {
                available = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(available, "Port {port} should become available after dropping the listener");
    }

    #[test]
    fn test_udp_only_conflict_does_not_block_tcp_transports() {
        let udp_socket = UdpSocket::bind("127.0.0.1:0").expect("Failed to bind ephemeral UDP port");
        let port = udp_socket.local_addr().expect("Failed to get local addr").port();

        assert!(
            is_port_available(port, PortTransport::Tcp, false, None),
            "An HTTP listener must stay bindable while only UDP is held on port {port}"
        );
        assert!(
            !is_port_available(port, PortTransport::TcpAndUdp, false, None),
            "A mixed listener needs both transports and must see the UDP conflict on port {port}"
        );

        #[cfg(windows)]
        {
            assert!(find_port_conflict(port, PortTransport::Tcp, None).is_none());
            let conflict = find_port_conflict(port, PortTransport::TcpAndUdp, None).expect("UDP conflict expected");
            assert_eq!(conflict.transport, ConflictTransport::Udp);
            assert_eq!(conflict.owner_pid, std::process::id());
        }
    }

    #[cfg(windows)]
    #[test]
    fn test_ipv6_listener_is_detected() {
        let listener = TcpListener::bind("[::1]:0").expect("Failed to bind ephemeral IPv6 port");
        let port = listener.local_addr().expect("Failed to get local addr").port();

        let conflict = find_port_conflict(port, PortTransport::Tcp, None).expect("IPv6 listener must be detected");
        assert_eq!(conflict.transport, ConflictTransport::Tcp);
        assert_eq!(conflict.owner_pid, std::process::id());
    }

    #[cfg(windows)]
    #[test]
    fn test_own_core_pid_is_never_a_conflict() {
        let (_listener, port) = ephemeral_tcp_listener();
        let own_pid = std::process::id();

        assert!(find_port_conflict(port, PortTransport::TcpAndUdp, Some(own_pid)).is_none());
        assert!(find_port_conflict(port, PortTransport::Tcp, None).is_some());
    }

    #[test]
    fn test_first_recoverable_port_respects_enabled_state_and_protocol() {
        const DISABLED_PORT: u16 = 1;
        let (listener, occupied_port) = ephemeral_tcp_listener();

        let mappings = vec![
            enabled_mapping(occupied_port, InboundProtocol::Mixed),
            PortMapping {
                enabled: false,
                ..enabled_mapping(DISABLED_PORT, InboundProtocol::Mixed)
            },
        ];

        assert_eq!(
            first_recoverable_port(&[occupied_port], &mappings, false, 0),
            None,
            "A port still held by another process must not be reported as recoverable"
        );
        assert_eq!(
            first_recoverable_port(&[DISABLED_PORT], &mappings, false, 0),
            None,
            "A disabled mapping must never be re-bound by the watchdog"
        );

        drop(listener);
        assert_eq!(
            first_recoverable_port(&[occupied_port], &mappings, false, 0),
            Some(occupied_port)
        );
    }
}
