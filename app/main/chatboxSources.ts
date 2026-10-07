import { execFile } from 'child_process';
import type { NetworkRates } from './netStats';
export interface WindowsChatboxSources {
  windowTitle: string | null;
  battery: { percent: number; charging: boolean } | null;
  media: { title: string; artist?: string; status: string; source?: string; positionSeconds?: number; durationSeconds?: number } | null;
}

const EMPTY: WindowsChatboxSources = { windowTitle: null, battery: null, media: null };
let cached: WindowsChatboxSources | null = null;
let cachedAt = 0;
let cachedFor = '';
let pending: { key: string; promise: Promise<WindowsChatboxSources> } | null = null;

export interface ChatboxSourceRequest {
  windowTitle?: boolean;
  media?: boolean;
  battery?: boolean;
  network?: boolean;
}

export function chatboxSourcePayload(wanted: ChatboxSourceRequest, sources: WindowsChatboxSources, rates: NetworkRates): Partial<WindowsChatboxSources & NetworkRates> {
  const payload: Partial<WindowsChatboxSources & NetworkRates> = {};
  if (wanted.windowTitle === true) payload.windowTitle = sources.windowTitle;
  if (wanted.media === true) payload.media = sources.media;
  if (wanted.battery === true) payload.battery = sources.battery;
  if (wanted.network === true) {
    payload.receiveBytesPerSecond = rates.receiveBytesPerSecond;
    payload.sendBytesPerSecond = rates.sendBytesPerSecond;
  }
  return payload;
}

export async function windowsChatboxSources(wanted: ChatboxSourceRequest = {}): Promise<WindowsChatboxSources> {
  if (process.platform !== 'win32') return EMPTY;
  const key = JSON.stringify({ windowTitle: wanted.windowTitle === true, media: wanted.media === true, battery: wanted.battery === true });
  if (cached && cachedFor === key && Date.now() - cachedAt < 8000) return cached;
  if (pending?.key === key) return pending.promise;
  const script = String.raw`
$WantWindow = $${wanted.windowTitle === true ? 'true' : 'false'}
$WantMedia = $${wanted.media === true ? 'true' : 'false'}
$WantBattery = $${wanted.battery === true ? 'true' : 'false'}
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$result = @{ windowTitle = $null; battery = $null; media = $null }
if ($WantWindow) { try {
  Add-Type -Namespace Vcmb -Name User32 -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr hWnd, System.Text.StringBuilder text, int count);'
  $hwnd = [Vcmb.User32]::GetForegroundWindow()
  $titleBuilder = New-Object System.Text.StringBuilder 512
  [void][Vcmb.User32]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
  if ($titleBuilder.Length -gt 0) { $result.windowTitle = $titleBuilder.ToString().Substring(0, [Math]::Min(160, $titleBuilder.Length)) }
} catch {} }
if ($WantBattery) { try {
  $battery = Get-CimInstance Win32_Battery | Select-Object -First 1
  if ($battery) { $result.battery = @{ percent = [int]$battery.EstimatedChargeRemaining; charging = ($battery.BatteryStatus -in 2,6,7,8,9) } }
} catch {} }
if ($WantMedia) { try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } | Select-Object -First 1
  $operation = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  $managerTask = $asTask.MakeGenericMethod($managerType).Invoke($null, [object[]]@($operation))
  [void]$managerTask.Wait(2500)
  if ($managerTask.IsCompleted) {
    $manager = $managerTask.Result
    $session = $manager.GetCurrentSession()
    if ($session) {
      $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
      $propsOperation = $session.TryGetMediaPropertiesAsync()
      $propsTask = $asTask.MakeGenericMethod($propsType).Invoke($null, [object[]]@($propsOperation))
      [void]$propsTask.Wait(1800)
      if ($propsTask.IsCompleted) {
        $props = $propsTask.Result
        $timeline = $session.GetTimelineProperties()
        $playback = $session.GetPlaybackInfo()
        $state = switch ([string]$playback.PlaybackStatus) { 'Playing' { 'playing' } 'Paused' { 'paused' } default { 'stopped' } }
        $sourceName = [string]$session.SourceAppUserModelId
        if ($sourceName -match '([^!]+)!') { $sourceName = $Matches[1] }
        $result.media = @{ title = [string]$props.Title; artist = [string]$props.Artist; source = $sourceName; status = $state; positionSeconds = [Math]::Max(0, $timeline.Position.TotalSeconds); durationSeconds = [Math]::Max(0, $timeline.EndTime.TotalSeconds) }
      }
    }
  }
} catch {} }

$result | ConvertTo-Json -Compress -Depth 4
`;
  const promise = new Promise<WindowsChatboxSources>((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000, maxBuffer: 64 * 1024 }, (_error, stdout) => {
    let result: WindowsChatboxSources = EMPTY;
    try {
      const parsed = JSON.parse(stdout.slice(Math.max(0, stdout.indexOf('{')), stdout.lastIndexOf('}') + 1)) as { windowTitle?: unknown; battery?: { percent?: unknown; charging?: unknown } | null; media?: { title?: unknown; artist?: unknown; status?: unknown; source?: unknown; positionSeconds?: unknown; durationSeconds?: unknown } | null };
      const battery = parsed.battery && Number.isFinite(parsed.battery.percent) ? { percent: Math.max(0, Math.min(100, Number(parsed.battery.percent))), charging: parsed.battery.charging === true } : null;
      const rawMedia = parsed.media;
      const media = rawMedia && typeof rawMedia.title === 'string' && rawMedia.title.trim() ? {
        title: rawMedia.title.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 100),
        artist: typeof rawMedia.artist === 'string' ? rawMedia.artist.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80) : '',
        status: ['playing', 'paused', 'stopped'].includes(String(rawMedia.status)) ? String(rawMedia.status) : '',
        source: typeof rawMedia.source === 'string' ? rawMedia.source.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80) : '',
        positionSeconds: Number.isFinite(rawMedia.positionSeconds) ? Number(rawMedia.positionSeconds) : undefined,
        durationSeconds: Number.isFinite(rawMedia.durationSeconds) ? Number(rawMedia.durationSeconds) : undefined
      } : null;
      result = { windowTitle: typeof parsed.windowTitle === 'string' ? parsed.windowTitle.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160) : null, battery, media };
    } catch { }
    cached = result;
    cachedFor = key;
    cachedAt = Date.now();
    resolve(result);
  }));
  pending = { key, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}

export function resetWindowsChatboxCacheForTests(): void {
  cached = null;
  cachedAt = 0;
  cachedFor = '';
  pending = null;
}
