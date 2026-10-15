import { V86 } from "./vendor/libv86.mjs";
import { Terminal } from "./vendor/xterm.mjs";
import { FitAddon } from "./vendor/addon-fit.mjs";
import { SerializeAddon } from "./vendor/addon-serialize.mjs";
import { packSession, sessionStore, unpackSession } from "./storage.js";

const status = document.querySelector("#status");
const saved = document.querySelector("#saved");
const saveButton = document.querySelector("#save");
const exportButton = document.querySelector("#export");
const resetButton = document.querySelector("#reset");
const term = new Terminal({
  cursorBlink: true, fontSize: 14, scrollback: 2000, allowTransparency: true,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  theme: { background: "#00000000", foreground: "#dce7f5", cursor: "#7dd3fc", selectionBackground: "#30415b" },
});
const fit = new FitAddon();
const serialize = new SerializeAddon();
term.loadAddon(fit);
term.loadAddon(serialize);
term.open(document.querySelector("#terminal-screen"));
fit.fit();
const encoder = new TextEncoder();
let emulator;
let image;
let ready = false;
let dirty = false;
let revision = 0;
let saving;
let storageAvailable = true;
let lastSave = 0;
let bootOutput = "";
let pendingInput = "";

function resize() {
  fit.fit();
  emulator?.bus.send("virtio-console0-resize", [term.cols, term.rows]);
}
new ResizeObserver(resize).observe(document.querySelector("#terminal"));
term.onData((data) => {
  if (!ready) return;
  dirty = true;
  revision++;
  if (saving) { pendingInput += data; return; }
  emulator.bus.send("virtio-console0-input-bytes", encoder.encode(data));
});

function flushInput() {
  if (!pendingInput) return;
  emulator.bus.send("virtio-console0-input-bytes", encoder.encode(pendingInput));
  pendingInput = "";
}

function enableControls() {
  saveButton.disabled = !ready || !storageAvailable || !!saving;
  exportButton.disabled = !ready || !!saving;
  resetButton.disabled = !ready || !!saving;
  document.querySelector("#restore").disabled = !ready || !!saving;
}

async function snapshot() {
  await emulator.stop();
  try {
    const state = await emulator.save_state();
    const metadata = { format: 1, ...image, terminal: serialize.serialize(), cols: term.cols, rows: term.rows, savedAt: Date.now() };
    return await packSession(state, metadata);
  } finally {
    emulator.run();
  }
}

async function save() {
  if (!ready || !storageAvailable) return;
  if (saving) return saving;
  saving = (async () => {
    saved.textContent = "Saving…";
    try {
      const savedRevision = revision;
      const blob = await snapshot();
      await sessionStore("put", blob);
      lastSave = Date.now();
      dirty = revision !== savedRevision;
      saved.textContent = `Saved at ${new Date(lastSave).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } catch (error) {
      saved.textContent = `Save failed: ${error.message}. Download a backup.`;
      console.error("VM save failed", error);
    } finally {
      saving = undefined;
      flushInput();
      enableControls();
    }
  })();
  enableControls();
  return saving;
}
saveButton.addEventListener("click", save);
exportButton.addEventListener("click", async () => {
  if (saving) return;
  saving = snapshot();
  enableControls();
  try {
    const blob = await saving;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `alpine-${new Date().toISOString().slice(0, 10)}.browser-linux`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    saved.textContent = `Backup failed: ${error.message}`;
  } finally {
    saving = undefined;
    flushInput();
    enableControls();
  }
});
document.querySelector("#restore").addEventListener("click", () => document.querySelector("#import").click());
document.querySelector("#import").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || saving) return;
  try {
    await unpackSession(file);
    if (!confirm("Replace this machine with the selected backup? Unsaved changes will be lost.")) return;
    if (saving) await saving;
    await emulator?.stop();
    await sessionStore("put", file);
    dirty = false;
    location.reload();
  } catch (error) {
    emulator?.run();
    saved.textContent = `Could not restore: ${error.message}`;
  }
});
const resetDialog = document.querySelector("#reset-dialog");
resetButton.addEventListener("click", () => resetDialog.showModal());
resetDialog.addEventListener("close", async () => {
  if (resetDialog.returnValue !== "reset") return;
  if (saving) await saving;
  await emulator?.stop();
  try {
    await sessionStore("delete");
    dirty = false;
    location.reload();
  } catch (error) {
    emulator?.run();
    saved.textContent = `Could not reset: ${error.message}`;
  }
});
setInterval(() => { if (dirty && !document.hidden) void save(); }, 60_000);
document.addEventListener("visibilitychange", () => { if (document.hidden && dirty) void save(); });
window.addEventListener("beforeunload", (event) => {
  if (dirty || saving) { event.preventDefault(); event.returnValue = ""; }
});

async function boot() {
  if (!navigator.locks) throw new Error("This browser does not support the storage lock needed for a persistent VM.");
  await navigator.locks.request("browser-linux-session", { ifAvailable: true }, async (lock) => {
    if (!lock) {
      status.textContent = "This machine is already open in another tab. Close it there and reload.";
      return;
    }
    let session;
    try {
      const blob = await sessionStore("get");
      if (blob) session = await unpackSession(blob);
    } catch (error) {
      storageAvailable = false;
      saved.textContent = `Local storage unavailable: ${error.message}. Use Download backup.`;
    }
    const response = await fetch("./image.json");
    if (!response.ok) throw new Error("Could not load the machine configuration.");
    const currentImage = await response.json();
    image = session?.metadata || currentImage;
    if (image.v86 !== currentImage.v86) throw new Error("This saved machine needs a different emulator version. Keep your backup and reset the machine.");
    status.textContent = session ? "Restoring saved machine…" : "Booting Alpine Linux…";
    if (session) {
      term.resize(image.cols, image.rows);
      await new Promise((resolve) => term.write(image.terminal, resolve));
    }
    emulator = new V86({
      wasm_path: `${image.base}v86.wasm`,
      memory_size: image.memory, vga_memory_size: 2 * 1024 * 1024,
      bios: { url: `${image.base}seabios.bin` }, vga_bios: { url: `${image.base}vgabios.bin` },
      filesystem: { basefs: `${image.base}fs.json`, baseurl: `${image.base}rootfs/` },
      bzimage_initrd_from_filesystem: true,
      cmdline: "rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose modules=virtio_pci console=ttyS0,115200 console=hvc0 tsc=reliable",
      virtio_console: { type: "none" },
      net_device: { type: "virtio", relay_url: "wisps://relay.iaske.net/wisp/", dns_method: "doh" },
      preserve_mac_from_state_image: true,
      autostart: false,
    });
    emulator.add_listener("virtio-console0-output-bytes", (bytes) => {
      term.write(bytes);
      if (!ready) {
        bootOutput = (bootOutput + new TextDecoder().decode(bytes)).slice(-1000);
        if (bootOutput.includes("root@browser:")) {
          ready = true;
          status.textContent = `Alpine ${image.alpine} · root@browser`;
          dirty = true;
          resize();
          enableControls();
        }
      }
    });
    emulator.add_listener("9p-write-end", () => { dirty = true; revision++; });
    emulator.add_listener("download-error", () => { status.textContent = "Machine download failed. Check your connection and reload."; });
    await new Promise((resolve) => emulator.add_listener("emulator-ready", resolve));
    if (session) {
      await emulator.restore_state(session.state);
      ready = true;
      dirty = false;
      lastSave = image.savedAt;
      status.textContent = `Alpine ${image.alpine} · root@browser · restored`;
      saved.textContent = `Restored save from ${new Date(lastSave).toLocaleString()}`;
      enableControls();
    }
    emulator.run();
    resize();
    // Keep the cross-tab lock for the lifetime of this page.
    await new Promise(() => {});
  });
}
boot().catch((error) => {
  status.textContent = error.message;
  resetButton.disabled = false;
  console.error("VM boot failed", error);
});
