const database = new Promise((resolve, reject) => {
  const request = indexedDB.open("browser-linux", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("sessions");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("Close other terminal tabs to update storage."));
});

export async function sessionStore(action, value) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", action === "get" ? "readonly" : "readwrite");
    const store = transaction.objectStore("sessions");
    const request = action === "put" ? store.put(value, "current") : store[action]("current");
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || request.error);
    transaction.onerror = () => reject(transaction.error || request.error);
  });
}

export async function packSession(state, metadata) {
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, header.length, true);
  const blob = new Blob([size, header, state]);
  return new Response(blob.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

export async function unpackSession(blob) {
  const data = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  if (data.byteLength < 4) throw new Error("Invalid backup.");
  const headerSize = new DataView(data).getUint32(0, true);
  if (headerSize > 4 * 1024 * 1024 || headerSize + 4 >= data.byteLength) throw new Error("Invalid backup.");
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, headerSize)));
  if (metadata.format !== 1 || !/^[a-f0-9]{16}$/.test(metadata.version)
      || metadata.base !== `/vm-assets/${metadata.version}/` || metadata.memory !== 268435456
      || typeof metadata.terminal !== "string" || !Number.isInteger(metadata.cols) || metadata.cols < 2 || metadata.cols > 1000
      || !Number.isInteger(metadata.rows) || metadata.rows < 2 || metadata.rows > 1000) throw new Error("Invalid backup.");
  return { metadata, state: data.slice(headerSize + 4) };
}
