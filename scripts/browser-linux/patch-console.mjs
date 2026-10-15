import { readFile, writeFile } from "node:fs/promises";

const filename = "terminal/vendor/libv86.mjs";
let source = await readFile(filename, "utf8");
const replacements = [
  // Linux expects columns before rows in the resize control message.
  ["[a,5,0,c,b],e,0);this.Send(2,d,e)", "[a,5,0,b,c],e,0);this.Send(2,d,e)"],
  ["notification:{initial_port:47360,single_handler:!1,handlers:[()=>{},c=>", "notification:{initial_port:47360,single_handler:!1,handlers:[c=>drainConsoleInput(this,c),c=>"],
  ["var f=this.virtio.queues[d];\nf.has_request()&&(f=f.pop_request(),this.Send(d,f,new Uint8Array(e)))", "this.pending_console_input ||= {}; (this.pending_console_input[d] ||= []).push({data:new Uint8Array(e),offset:0});drainConsoleInput(this,d)"],
  ["a[3]=this.ports;return a};Nc.prototype.set_state", "a[3]=this.ports;a[4]=Object.entries(this.pending_console_input||{}).map(([id,chunks])=>[Number(id),chunks.map(chunk=>[chunk.data,chunk.offset])]);return a};Nc.prototype.set_state"],
  ["this.cols=a[2];this.ports=a[3]};Nc.prototype.reset", "this.cols=a[2];this.ports=a[3];this.pending_console_input={};for(const[id,chunks]of a[4]||[])this.pending_console_input[id]=chunks.map(([data,offset])=>({data,offset}))};Nc.prototype.reset"],
  ["Nc.prototype.reset=function(){this.virtio.reset()}", "Nc.prototype.reset=function(){this.pending_console_input={};this.virtio.reset()}"],
];
for (const [before, after] of replacements) {
  if (source.split(before).length !== 2) throw new Error("Pinned v86 console changed; review the console patch.");
  source = source.replace(before, after);
}

// Upstream drops input when no guest receive descriptor is available.
source += `
function drainConsoleInput(device, queueId) {
  const pending = device.pending_console_input?.[queueId];
  if (!pending?.length) return;
  const queue = device.virtio.queues[queueId];
  while (pending.length && queue.has_request()) {
    const buffer = queue.pop_request();
    const chunk = pending[0];
    const length = Math.min(buffer.length_writable, chunk.data.length - chunk.offset);
    device.Send(queueId, buffer, chunk.data.subarray(chunk.offset, chunk.offset + length));
    chunk.offset += length;
    if (chunk.offset === chunk.data.length) pending.shift();
  }
}
`;
await writeFile(filename, source);
