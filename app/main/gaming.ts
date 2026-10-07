import { execFile } from 'child_process';
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import { WORLD_ID, type PcSnapshot, type RecentWorld } from '@shared/gaming';

function cpuTimes(): { idle: number; total: number } {
  return os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}
let previousCpu = cpuTimes();
let snapshotCache: PcSnapshot | undefined;
let snapshotAt = 0;
let pendingSnapshot: Promise<PcSnapshot> | null = null;

const GAMING_PROCESSES = new Set(['vrchat', 'steam', 'steamvr', 'vrserver', 'vrmonitor', 'discord', 'obs64', 'obs32', 'spotify', 'voicemeeter', 'voicemeeterpro', 'voicemeeter8', 'oculusclient', 'virtualdesktop.streamer']);
let appStartedAt = Date.now();
export function appUptimeSeconds(): number { return Math.max(0, (Date.now() - appStartedAt) / 1000); }

export function vrchatIsRunning(snapshot?: PcSnapshot): boolean {
  const source = snapshot ?? snapshotCache;
  return Boolean(source?.running.some((item) => item.name.toLowerCase() === 'vrchat'));
}

function windowsStatus(): Promise<Pick<PcSnapshot, 'drives' | 'running'>> {
  if (process.platform !== 'win32') return Promise.resolve({ drives: [], running: [] });
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $d=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{path=$_.DeviceID;free=[double]$_.FreeSpace;total=[double]$_.Size} }); $p=@(Get-Process | Select-Object @{n='name';e={$_.ProcessName}},@{n='pid';e={$_.Id}}); @{drives=$d;running=$p}|ConvertTo-Json -Compress -Depth 4";
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
    if (error) return reject(error);
    try {
      const data = JSON.parse(stdout) as Pick<PcSnapshot, 'drives' | 'running'>;
      resolve({ drives: data.drives ?? [], running: (data.running ?? []).filter((p) => GAMING_PROCESSES.has(p.name.toLowerCase())) });
    } catch (error) { reject(error); }
  }));
}

export async function pcSnapshot(): Promise<PcSnapshot> {
  if (snapshotCache && Date.now() - snapshotAt < 10000) return snapshotCache;
  if (pendingSnapshot) return pendingSnapshot;
  pendingSnapshot = (async () => {
    const current = cpuTimes();
    const total = current.total - previousCpu.total;
    const idle = current.idle - previousCpu.idle;
    previousCpu = current;
    const windows = await windowsStatus();
    const snapshot: PcSnapshot = {
      sampledAt: new Date().toISOString(), cpuName: os.cpus()[0]?.model ?? 'Unknown CPU',
      cpuCores: os.cpus().length, cpuPercent: total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : null,
      memoryUsed: os.totalmem() - os.freemem(), memoryTotal: os.totalmem(), uptimeSeconds: os.uptime(),
      platform: `${os.type()} ${os.release()} · ${os.arch()}`, ...windows
    };
    snapshotCache = snapshot;
    snapshotAt = Date.now();
    return snapshot;
  })();
  try { return await pendingSnapshot; } finally { pendingSnapshot = null; }
}

export function vrchatLogFolder(): string {
  return path.join(process.env.USERPROFILE ?? os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat');
}

export function parseRecentWorlds(text: string): RecentWorld[] {
  const worlds: RecentWorld[] = [];
  let latest: RecentWorld | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = /\[Behaviour\]\s+Joining (wrld_[0-9a-f-]{36})(?::([^\s]+))?/i.exec(line);
    if (match && WORLD_ID.test(match[1])) {
      latest = { worldId: match[1], instanceId: match[2], name: match[1] };
      worlds.push(latest);
    } else if (latest) {
      const name = /\[Behaviour\]\s+Entering Room:\s*(.+)/i.exec(line)?.[1];
      if (name) latest.name = name.trim().slice(0, 100);
    }
  }
  const seen = new Set<string>();
  return worlds.reverse().filter((w) => {
    const key = `${w.worldId}:${w.instanceId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

export function recentVrchatWorlds(): { worlds: RecentWorld[]; detail: string } {
  const folder = vrchatLogFolder();
  if (!existsSync(folder)) return { worlds: [], detail: 'No VRChat log folder found. Start VRChat at least once on this Windows account.' };
  const files = readdirSync(folder).filter((file) => /^output_log_.*\.txt$/i.test(file)).map((file) => ({ file, at: statSync(path.join(folder, file)).mtimeMs })).sort((a, b) => b.at - a.at);
  if (!files[0]) return { worlds: [], detail: 'No VRChat session logs found.' };
  const file = path.join(folder, files[0].file);
  const size = statSync(file).size;
  const buffer = Buffer.alloc(Math.min(size, 2 * 1024 * 1024));
  const descriptor = openSync(file, 'r');
  let count: number;
  try { count = readSync(descriptor, buffer, 0, buffer.length, Math.max(0, size - buffer.length)); } finally { closeSync(descriptor); }
  const worlds = parseRecentWorlds(buffer.subarray(0, count).toString('utf8'));
  return { worlds, detail: `Read only world transitions from the latest local log (last ${Math.ceil(buffer.length / 1024)} KB). Never uploaded.` };
}

export { chatboxPacket } from './osc';
export { sendChatbox } from './osc';
