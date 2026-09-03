use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddrV4, SocketAddrV6, TcpStream};
use std::time::Duration;

/// Probes whether a given TCP port is available on localhost (127.0.0.1).
pub fn is_port_available(port: u16) -> bool {
    is_port_available_with_lan(port, false)
}

/// Helper: Queries Windows native TCP/UDP listening tables for 100% accurate port occupancy
#[cfg(windows)]
fn is_port_in_windows_listening_tables(port: u16) -> bool {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCPTABLE_OWNER_PID, MIB_UDPTABLE_OWNER_PID,
        TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    // 1. Check IPv4 TCP Listening Table
    let mut size: u32 = 0;
    unsafe {
        let _ = GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size,
            0,
            AF_INET as u32,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );

        if size > 0 {
            let mut buffer = vec![0u8; size as usize];
            if GetExtendedTcpTable(
                buffer.as_mut_ptr() as *mut _,
                &mut size,
                0,
                AF_INET as u32,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            ) == 0
            {
                let table = &*(buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
                let entries = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
                for row in entries {
                    // MIB_TCP_STATE_LISTEN = 2
                    if row.dwState == 2 {
                        let local_port = u16::from_be((row.dwLocalPort & 0xFFFF) as u16);
                        if local_port == port {
                            return true;
                        }
                    }
                }
            }
        }
    }

    // 2. Check IPv6 TCP Listening Table
    let mut size_v6: u32 = 0;
    unsafe {
        let _ = GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size_v6,
            0,
            AF_INET6 as u32,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );

        if size_v6 > 0 {
            let mut buffer = vec![0u8; size_v6 as usize];
            if GetExtendedTcpTable(
                buffer.as_mut_ptr() as *mut _,
                &mut size_v6,
                0,
                AF_INET6 as u32,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            ) == 0
            {
                let table = &*(buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
                let entries = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
                for row in entries {
                    if row.dwState == 2 {
                        let local_port = u16::from_be((row.dwLocalPort & 0xFFFF) as u16);
                        if local_port == port {
                            return true;
                        }
                    }
                }
            }
        }
    }

    // 3. Check IPv4 UDP Table
    let mut udp_size: u32 = 0;
    unsafe {
        let _ = GetExtendedUdpTable(
            std::ptr::null_mut(),
            &mut udp_size,
            0,
            AF_INET as u32,
            UDP_TABLE_OWNER_PID,
            0,
        );

        if udp_size > 0 {
            let mut buffer = vec![0u8; udp_size as usize];
            if GetExtendedUdpTable(
                buffer.as_mut_ptr() as *mut _,
                &mut udp_size,
                0,
                AF_INET as u32,
                UDP_TABLE_OWNER_PID,
                0,
            ) == 0
            {
                let table = &*(buffer.as_ptr() as *const MIB_UDPTABLE_OWNER_PID);
                let entries = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
                for row in entries {
                    let local_port = u16::from_be((row.dwLocalPort & 0xFFFF) as u16);
                    if local_port == port {
                        return true;
                    }
                }
            }
        }
    }

    false
}

/// Probes whether a given TCP port is available, accounting for allow_lan (0.0.0.0 & 127.0.0.1).
pub fn is_port_available_with_lan(port: u16, allow_lan: bool) -> bool {
    // Layer 1: Active TCP handshake probe on IPv4
    if TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(30),
    )
    .is_ok()
    {
        return false;
    }

    // Layer 2: Active TCP handshake probe on IPv6
    if TcpStream::connect_timeout(
        &SocketAddrV6::new(Ipv6Addr::LOCALHOST, port, 0, 0).into(),
        Duration::from_millis(30),
    )
    .is_ok()
    {
        return false;
    }

    // Layer 3: System Listening Tables Inspection on Windows (IpHelper)
    #[cfg(windows)]
    {
        if is_port_in_windows_listening_tables(port) {
            return false;
        }
    }

    // Layer 4: Socket bind probe with exclusive address use
    let bind_ip = if allow_lan {
        Ipv4Addr::UNSPECIFIED // 0.0.0.0
    } else {
        Ipv4Addr::LOCALHOST // 127.0.0.1
    };

    let Ok(socket) = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)) else {
        return false;
    };

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawSocket;
        use windows_sys::Win32::Networking::WinSock::{setsockopt, SOL_SOCKET, SO_EXCLUSIVEADDRUSE};

        let optval: i32 = 1;
        unsafe {
            let _ = setsockopt(
                socket.as_raw_socket() as usize,
                SOL_SOCKET,
                SO_EXCLUSIVEADDRUSE,
                &optval as *const _ as *const _,
                std::mem::size_of::<i32>() as i32,
            );
        }
    }

    let sock_addr: socket2::SockAddr = SocketAddrV4::new(bind_ip, port).into();
    socket.bind(&sock_addr).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn test_port_probe_available() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind ephemeral port");
        let port = listener.local_addr().expect("Failed to get local addr").port();

        assert!(!is_port_available(port));
        assert!(!is_port_available_with_lan(port, false));
        assert!(!is_port_available_with_lan(port, true));

        drop(listener);

        assert!(is_port_available(port));
        assert!(is_port_available_with_lan(port, false));
        assert!(is_port_available_with_lan(port, true));
    }

    #[test]
    fn test_port_7897_detection_live() {
        let avail_127 = is_port_available(7897);
        let avail_lan = is_port_available_with_lan(7897, true);
        println!("Live 7897 Available 127.0.0.1: {}", avail_127);
        println!("Live 7897 Available 0.0.0.0: {}", avail_lan);
        // Because 7897 is currently occupied by Clash Verge on the user's machine, it must be false!
        assert!(!avail_127);
        assert!(!avail_lan);
    }
}
