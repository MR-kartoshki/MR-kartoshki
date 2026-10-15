import asyncio
import ipaddress
import logging
import os
import signal
import socket
import struct
import time
from collections import Counter

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

ORIGIN = os.environ.get("RELAY_ORIGIN", "https://portfolio.iaske.net")
HOST = os.environ.get("RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("RELAY_PORT", "8765"))
TRUSTED_PROXY = os.environ.get("RELAY_TRUSTED_PROXY", "127.0.0.1")
WINDOW = 128
MAX_STREAMS = 32
BANDWIDTH = 2 * 1024 * 1024
clients = Counter()
budgets = {}


async def throttle(client, length):
    now = time.monotonic()
    start, used = budgets.get(client, (now, 0))
    if now - start >= 1:
        start, used = now, 0
    used += length
    budgets[client] = start, used
    delay = used / BANDWIDTH - (now - start)
    if delay > 0:
        await asyncio.sleep(delay)


async def public_connection(host, port):
    if port in (0, 25, 465, 587):
        raise ValueError("Port unavailable")
    addresses = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for family, _, _, _, address in addresses:
        ip = ipaddress.ip_address(address[0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global or ip.is_multicast:
            continue
        try:
            # Connect to the validated address, without a second DNS lookup.
            return await asyncio.open_connection(address[0], port, family=family)
        except OSError:
            continue
    raise OSError("No reachable public address")


async def handshake(connection, request):
    if request.path == "/health" and "Upgrade" not in request.headers:
        return connection.respond(200, "Browser Linux relay is running.\n")
    if request.path != "/wisp/":
        return connection.respond(404, "Not found\n")
    if request.headers.get("Origin") != ORIGIN:
        return connection.respond(403, "Origin unavailable\n")
    if sum(clients.values()) >= 64:
        return connection.respond(503, "Relay busy\n")


async def relay(ws):
    peer = ws.remote_address[0]
    client = ws.request.headers.get("CF-Connecting-IP", peer) if peer == TRUSTED_PROXY else peer
    if clients[client] >= 3:
        await ws.close(1008, "Too many sessions")
        return
    clients[client] += 1
    streams = {}

    async def send(kind, stream, payload):
        await ws.send(struct.pack("<BI", kind, stream) + payload)

    async def upload(writer, stream, queue):
        packets = 0
        while True:
            data = await queue.get()
            await throttle(client, len(data))
            writer.write(data)
            await writer.drain()
            packets += 1
            if packets % (WINDOW // 2) == 0:
                await send(3, stream, struct.pack("<I", WINDOW - queue.qsize()))

    async def download(reader, stream):
        while data := await reader.read(65536):
            await throttle(client, len(data))
            await send(2, stream, data)

    async def connect(stream, host, port, queue):
        writer = None
        tasks = []
        reason = 2
        try:
            async with asyncio.timeout(15):
                reader, writer = await public_connection(host, port)
            tasks = [asyncio.create_task(upload(writer, stream, queue)), asyncio.create_task(download(reader, stream))]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except (OSError, TimeoutError, ValueError):
            reason = 0x42
        except ConnectionClosed:
            pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if writer:
                writer.close()
                try:
                    await writer.wait_closed()
                except OSError:
                    pass
            streams.pop(stream, None)
            try:
                await send(4, stream, bytes([reason]))
            except ConnectionClosed:
                pass

    try:
        await send(3, 0, struct.pack("<I", WINDOW))
        async for packet in ws:
            if not isinstance(packet, bytes) or len(packet) < 5:
                await ws.close(1008, "Invalid packet")
                break
            kind, stream = struct.unpack("<BI", packet[:5])
            data = packet[5:]
            if not stream:
                await ws.close(1008, "Invalid stream")
                break
            if kind == 1:
                if stream in streams or len(streams) >= MAX_STREAMS or not 4 <= len(data) <= 258:
                    await ws.close(1008, "Invalid connection")
                    break
                stream_type, port = struct.unpack("<BH", data[:3])
                if stream_type != 1:
                    await send(4, stream, b"\x42")
                    continue
                host = data[3:].decode("ascii")
                queue = asyncio.Queue(WINDOW)
                task = asyncio.create_task(connect(stream, host, port, queue))
                streams[stream] = task, queue
            elif kind == 2 and stream in streams:
                streams[stream][1].put_nowait(data)
            elif kind == 4 and stream in streams:
                streams[stream][0].cancel()
            elif kind not in (2, 3, 4):
                await ws.close(1008, "Invalid packet type")
                break
    except (UnicodeError, asyncio.QueueFull):
        await ws.close(1008, "Invalid packet")
    except ConnectionClosed:
        pass
    finally:
        tasks = [task for task, _ in streams.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        clients[client] -= 1
        if not clients[client]:
            del clients[client]
            budgets.pop(client, None)


async def main():
    stop = asyncio.get_running_loop().create_future()
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, lambda: stop.done() or stop.set_result(None))
    async with serve(relay, HOST, PORT, process_request=handshake, compression=None,
                     max_size=65541, max_queue=16, server_header=None):
        logging.info("Relay listening on %s:%s", HOST, PORT)
        await stop


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("websockets.server").setLevel(logging.WARNING)
    asyncio.run(main())
