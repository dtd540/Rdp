// Diagnostic matrix for SetPersistedDefaultAudioEndpoint:
//   foreign-active pid -> VAC (real change), then restore to default
//   foreign-idle   pid -> default (no disruption)
//   second sidecar playing a tone -> VAC, then restore
import { spawn, execSync } from 'child_process';

const exe = execSync('find sidecar/bin -name AudioBridge.Sidecar.exe', { encoding: 'utf8' }).trim().split('\n')[0];

function makeSidecar(tag) {
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
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method === 'log') {
        console.log(`[${tag}] ${msg.params?.message ?? line}`);
      }
    }
  });
  const call = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    return new Promise((res) => pending.set(id, res));
  };
  return { child, call, kill: () => child.kill() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = makeSidecar('A');

const eps = (await A.call('endpoints.list')).result;
const render = eps.filter((e) => e.direction === 'render');
const def = render.find((e) => e.isDefault);
const vac = render.find((e) => /Virtual Audio Cable/i.test(e.name)) ?? render[1];

// Collect sessions across all endpoints
const sessions = [];
for (const ep of eps) {
  const r = await A.call('sessions.list', { endpointId: ep.id });
  for (const s of r.result ?? []) sessions.push({ ...s, ep: ep.name });
}
console.log('\n== SESSIONS ==');
for (const s of sessions) console.log(`  pid=${s.pid} ${s.processName} [${s.state}] on ${s.ep}`);

const active = [...new Map(sessions.filter((s) => s.state === 'active').map((s) => [s.pid, s])).values()];
const idle = [...new Map(sessions.filter((s) => s.state !== 'active').map((s) => [s.pid, s])).values()];
const activeForeign = active.filter((s) => s.pid !== A.child.pid && !/virtual|voicemeeter|cable/i.test(s.processName));
const idleForeign = idle.filter((s) => s.pid !== A.child.pid);

async function tryRoute(tag, pid, target) {
  const r = await A.call('route.app', { pid, endpointName: target.name });
  const out = r.result ?? r.error;
  console.log(`\n[${tag}] pid=${pid} -> ${target.name}`);
  console.log(`   ${JSON.stringify(out)}`);
  return out;
}
async function restore(pid) {
  await A.call('route.app', { pid, endpointName: def.name });
}

// 1) foreign ACTIVE process: real change (VAC) then restore
const a1 = activeForeign[0];
if (a1) {
  const ok = await tryRoute('foreign-active', a1.pid, vac);
  if (ok?.ok) await restore(a1.pid);
}

// 2) foreign IDLE process: set to default (no audible change either way)
const i1 = idleForeign[0];
if (i1) await tryRoute('foreign-idle', i1.pid, def);

// 3) fresh process actively rendering a tone (not the caller): VAC then restore
const B = makeSidecar('B');
await B.call('diag.playTone', { seconds: 15 });
await sleep(1200);
const okB = await tryRoute('other-tone', B.child.pid, vac);
if (okB?.ok) await restore(B.child.pid);
await B.call('diag.stopTone');
B.kill();

A.kill();
process.exit(0);
