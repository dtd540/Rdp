import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import https from 'https';
import { shell } from 'electron';

export interface InstallResult {
  ok: boolean;
  phase: 'already-installed' | 'launched' | 'downloaded' | 'opened-page' | 'failed';
  detail: string;
}

const OFFICIAL_PAGE = 'https://vb-audio.com/Voicemeeter/';

/**
 * Candidate direct-download URLs for the official installer (zip or exe).
 * Probed with a ranged GET; only content that looks like an archive or an
 * MZ executable is executed — anything else falls through to the official page.
 */
const DOWNLOAD_CANDIDATES = [
  'https://download.vb-audio.com/Download_VOICEMEETER/VoicemeeterSetup_v1130.zip',
  'https://download.vb-audio.com/Download_VOICEMEETER/Voicemeeter8Setup.exe',
  'https://download.vb-audio.com/Download_VOICEMEETER/VoicemeeterSetup.exe'
];

function localInstallerCandidates(): string[] {
  const out: string[] = [];
  const folders = [
    'C:\\Program Files (x86)\\VB\\Voicemeeter',
    'C:\\Program Files\\VB\\Voicemeeter',
    path.join(process.env.USERPROFILE ?? '', 'Downloads')
  ];
  const wanted = /^voicemeeter.*\.(exe|zip)$/i;
  for (const dir of folders) {
    try {
      if (!existsSync(dir)) continue;
      const hits = readdirSync(dir)
        .filter((f) => wanted.test(f))
        .map((f) => path.join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      out.push(...hits);
    } catch {
      /* ignore unreadable folders */
    }
  }
  return out;
}

function runInstaller(file: string): InstallResult {
  try {
    spawn(file, [], { cwd: path.dirname(file), stdio: 'ignore', detached: true, windowsHide: false }).unref();
    return { ok: true, phase: 'launched', detail: `started ${path.basename(file)} — approve the UAC prompt` };
  } catch (err) {
    return { ok: false, phase: 'failed', detail: (err as Error).message };
  }
}

function download(url: string, dest: string, redirects = 5): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'VRChatMusicBridge/0.1' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return resolve(false);
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(download(next, dest, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const ws = createWriteStream(dest);
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > 120 * 1024 * 1024) {
          req.destroy();
          ws.end();
          try {
            unlinkSync(dest);
          } catch {
            /* ignore */
          }
          resolve(false);
        }
      });
      res.pipe(ws);
      ws.on('finish', () => resolve(bytes > 1024 * 1024));
      ws.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(60_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function looksLikeExecutable(file: string): boolean {
  try {
    const fd = require('fs').openSync(file, 'r');
    const buf = Buffer.alloc(2);
    require('fs').readSync(fd, buf, 0, 2, 0);
    require('fs').closeSync(fd);
    return buf.toString('latin1') === 'MZ';
  } catch {
    return false;
  }
}

async function downloadAndRun(): Promise<InstallResult> {
  const dir = path.join(tmpdir(), 'vcbridge');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (const url of DOWNLOAD_CANDIDATES) {
    const dest = path.join(dir, path.basename(new URL(url).pathname));
    // eslint-disable-next-line no-await-in-loop
    const ok = await download(url, dest);
    if (!ok) continue;

    if (dest.toLowerCase().endsWith('.zip')) {
      try {
        const { execFileSync } = require('child_process') as typeof import('child_process');
        const unzipDir = path.join(dir, 'unzipped');
        execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Force -Path "${dest}" -DestinationPath "${unzipDir}"`
        ]);
        const setup = readdirSync(unzipDir)
          .filter((f) => /\.exe$/i.test(f))
          .map((f) => path.join(unzipDir, f))
          .find((f) => /setup/i.test(path.basename(f)));
        if (setup) return runInstaller(setup);
      } catch (err) {
        continue;
      }
    } else if (looksLikeExecutable(dest)) {
      return runInstaller(dest);
    }
  }

  // Nothing verified — open the official page so the user can download manually.
  await shell.openExternal(OFFICIAL_PAGE);
  return {
    ok: true,
    phase: 'opened-page',
    detail: `Opened ${OFFICIAL_PAGE} — download and run the installer, then click "I installed it".`
  };
}

export async function installVoiceMeeter(): Promise<InstallResult> {
  const local = localInstallerCandidates();
  if (local.length > 0) {
    return runInstaller(local[0]);
  }
  return downloadAndRun();
}
