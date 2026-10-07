import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import path from 'path';

export class SidecarClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private intentionalStop = false;

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  private resolveSidecarPath(): string {
    const exe = 'AudioBridge.Sidecar.exe';
    const candidates = process.env.VCB_SIDECAR_PATH
      ? [process.env.VCB_SIDECAR_PATH]
      : [
          path.join(process.resourcesPath ?? '', 'sidecar', exe),
          path.join(__dirname, '..', '..', '..', 'sidecar', 'bin', 'Release', 'net8.0-windows', exe),
          path.join(__dirname, '..', '..', '..', 'sidecar', 'bin', exe),
          path.join(process.cwd(), 'sidecar', 'bin', 'Release', 'net8.0-windows', exe),
          path.join(process.cwd(), 'sidecar', 'bin', exe)
        ];
    for (const c of candidates) {
      if (c && c !== exe && existsSync(c)) return c;
    }
    throw new Error(
      `sidecar executable not found (looked in: ${candidates.filter(Boolean).join(' | ')}). ` +
        `Run "npm run sidecar:build" first.`
    );
  }

  start(): void {
    if (this.running) return;
    const exePath = this.resolveSidecarPath();
    this.intentionalStop = false;
    this.buf = '';

    const proc = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.proc = proc;

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) this.emit('log', line);
      }
    });

    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.failAllPending(new Error(`sidecar exited (code ${code})`));
      if (!this.intentionalStop) this.emit('down', code);
    });
    proc.on('error', (err) => {
      if (this.proc === proc) this.proc = null;
      this.failAllPending(err);
      this.emit('down', (err as Error).message);
    });

    this.emit('up');
  }

  stop(): void {
    this.intentionalStop = true;
    if (this.proc) {
      try {
        this.proc.stdin?.end();
        this.proc.kill();
      } catch {
      }
      this.proc = null;
    }
    this.failAllPending(new Error('sidecar stopped'));
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit('log', `unparseable sidecar line: ${line.slice(0, 200)}`);
        continue;
      }
      if ('id' in msg && (msg.result !== undefined || msg.error !== undefined)) {
        const id = msg.id as number;
        const p = this.pending.get(id);
        if (!p) continue;
        this.pending.delete(id);
        if (msg.error) {
          const e = msg.error as { code?: number; message?: string };
          p.reject(new Error(e.message ?? `rpc error ${e.code}`));
        } else {
          p.resolve(msg.result);
        }
      } else if ('method' in msg) {
        this.emit('event', msg.method as string, msg.params);
      }
    }
  }

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.running) this.start();
    const proc = this.proc;
    if (!proc || !proc.stdin?.writable) throw new Error('sidecar not running');
    const id = this.nextId++;
    const payload = JSON.stringify(params === undefined ? { id, method } : { id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      proc.stdin!.write(payload + '\n', (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`rpc timeout: ${method}`));
        }
      }, 30_000);
      timer.unref?.();
    });
  }

  async tryCall<T = unknown>(method: string, params?: unknown): Promise<T | null> {
    try {
      return await this.call<T>(method, params);
    } catch {
      return null;
    }
  }
}
