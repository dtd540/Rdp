// Controlled experiment: does SetPersistedDefaultAudioEndpoint succeed when the
// target process is *actively rendering audio* (our own tone generator)?
import { spawn, execSync } from 'child_process';

const exe = execSync(
  'find sidecar/bin -name AudioBridge.Sidecar.exe',
  { encoding: 'utf8' }
).trim().split('\n')[0];

const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let nextId = 1;
let buf = '';

child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    console.log('<<', line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function call(method, params) {
  const id = nextId++;
  const line = JSON.stringify({ id, method, params });
  console.log('>>', line);
  child.stdin.write(line + '\n');
  return new Promise((res) => pending.set(id, res));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const eps = await call('endpoints.list');
const render = (eps.result ?? []).filter((e) => e.direction === 'render');
console.log('\nRENDER ENDPOINTS:');
render.forEach((e) => console.log(`  ${e.isDefault ? '[default] ' : '          '}${e.name}  ${e.id}`));

const target = render.length > 1 ? render.find((e) => !e.isDefault) ?? render[0] : render[0];
console.log(`\nTarget: ${target.name}`);

// 1) Without active audio session
const before = await call('route.app', { pid: 0, endpointName: target.name });
console.log('\nROUTE (idle, no audio):', JSON.stringify(before.result ?? before.error));

// 2) Start tone -> our pid is now actively rendering
const tone = await call('diag.playTone', { seconds: 20 });
console.log('TONE:', JSON.stringify(tone.result ?? tone.error));
await sleep(1200);

const during = await call('route.app', { pid: 0, endpointName: target.name });
console.log('ROUTE (tone playing):', JSON.stringify(during.result ?? during.error));

await call('diag.stopTone');
child.kill();
process.exit(0);
