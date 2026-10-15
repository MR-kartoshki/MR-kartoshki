import socket
import unittest
from unittest.mock import AsyncMock, patch

import server


class PublicConnections(unittest.IsolatedAsyncioTestCase):
    async def test_private_and_mapped_addresses_are_never_connected(self):
        addresses = [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 80)),
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("10.0.0.63", 80)),
            (socket.AF_INET6, socket.SOCK_STREAM, 0, "", ("::ffff:192.168.1.1", 80, 0, 0)),
        ]
        with patch.object(server.asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=addresses)), \
                patch.object(server.asyncio, "open_connection", AsyncMock()) as connect:
            with self.assertRaises(OSError):
                await server.public_connection("private.example", 80)
            connect.assert_not_awaited()

    async def test_public_address_is_connected_without_resolving_hostname_again(self):
        address = (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 443))
        with patch.object(server.asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=[address])), \
                patch.object(server.asyncio, "open_connection", AsyncMock(return_value=("reader", "writer"))) as connect:
            self.assertEqual(await server.public_connection("example.org", 443), ("reader", "writer"))
            connect.assert_awaited_once_with("93.184.215.14", 443, family=socket.AF_INET)

    async def test_mail_ports_are_blocked_before_dns(self):
        for port in (0, 25, 465, 587):
            with self.assertRaises(ValueError):
                await server.public_connection("example.org", port)


if __name__ == "__main__":
    unittest.main()
