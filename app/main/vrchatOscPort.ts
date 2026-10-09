import { execFile } from 'child_process';

interface PortProbe {
  running: boolean;
  configuredPorts: unknown;
  boundPorts: unknown;
}

const WINDOWS_PROBE = String.raw`$ErrorActionPreference='Stop'; $processes=@(Get-CimInstance Win32_Process -Filter "Name = 'VRChat.exe'"); $configured=@(); $bound=@(); foreach($process in $processes) { if($process.CommandLine -match '(?i)--osc=(\d+):') { $port=[int]$Matches[1]; if($port -ge 1024 -and $port -le 65535) { $configured += $port } }; try { $bound += Get-NetUDPEndpoint -OwningProcess $process.ProcessId -ErrorAction Stop | Where-Object { $_.LocalPort -ge 9000 -and $_.LocalPort -le 9999 } | Select-Object -ExpandProperty LocalPort } catch {} }; [pscustomobject]@{ running=($processes.Count -gt 0); configuredPorts=@($configured); boundPorts=@($bound) } | ConvertTo-Json -Compress -Depth 3`;

function ports(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((port): port is number => typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535))];
}

export function selectVrchatOscReceivePort(probe: PortProbe): number | undefined {
  if (!probe.running) return undefined;
  const configured = ports(probe.configuredPorts);
  if (configured.length === 1) return configured[0];
  if (configured.length > 1) return undefined;
  const bound = ports(probe.boundPorts);
  return bound.length === 1 ? bound[0] : undefined;
}

export function detectVrchatOscReceivePort(): Promise<{ port?: number; detail: string }> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ detail: 'Automatic VRChat OSC port detection is only available on Windows.' });
  }

  const encodedProbe = Buffer.from(WINDOWS_PROBE, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedProbe], {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 256 * 1024
    }, (error, stdout) => {
      if (error) {
        resolve({ detail: `Could not inspect VRChat OSC settings: ${error.message}` });
        return;
      }
      try {
        const probe = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as PortProbe;
        if (!probe.running) {
          resolve({ detail: 'VRChat is not running. Start VRChat, then detect the port again.' });
          return;
        }
        const port = selectVrchatOscReceivePort(probe);
        if (port !== undefined) {
          resolve({ port, detail: `Detected VRChat OSC receive port ${port}.` });
          return;
        }
        resolve({ detail: 'VRChat is running, but its OSC receive port could not be identified unambiguously.' });
      } catch {
        resolve({ detail: 'Could not read VRChat OSC settings from Windows.' });
      }
    });
  });
}
