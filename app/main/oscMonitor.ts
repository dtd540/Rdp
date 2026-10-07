import { createSocket, type RemoteInfo, type Socket } from 'dgram';

export interface AfkOscEvent { address: string; value: boolean }

/**
 * Listens for VRChat's outbound OSC on a local port and reports
 * /avatar/parameters/AFK transitions. Read-only: nothing is ever sent from
 * this socket, and the port is loopback-only. The listener stays off until
 * the user explicitly starts it.
 */
export class OscAfkMonitor {
  private socket: Socket | null = null;
  private readonly listeners = new Set<(event: AfkOscEvent) => void>();
  private lastValue: boolean | null = null;

  get active(): boolean { return this.socket !== null; }

  start(port: number): void {
    if (this.socket) {
      if (this.socket.address().port === port) return;
      this.stop();
    }
    const socket = createSocket('udp4');
    socket.on('message', (buffer: Buffer, _info: RemoteInfo) => {
      const event = parseAfkPacket(buffer);
      if (!event || event.value === this.lastValue) return;
      this.lastValue = event.value;
      for (const listener of this.listeners) {
        try { listener(event); } catch { /* a bad consumer cannot break the monitor */ }
      }
    });
    socket.on('error', () => this.stop());
    socket.bind(port, '127.0.0.1');
    this.socket = socket;
  }

  stop(): void {
    this.lastValue = null;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try { socket.close(); } catch { /* already closed */ }
  }

  subscribe(listener: (event: AfkOscEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Parses the single-address, single-boolean OSC packet shape VRChat sends for avatar parameters. */
export function parseAfkPacket(buffer: Buffer): AfkOscEvent | null {
  const text = buffer.toString('latin1');
  const parts = text.split('\0');
  const address = parts[0];
  if (address !== '/avatar/parameters/AFK') return null;
  // Type tags live after the padded address and padded ",T" section.
  const tagsIndex = buffer.indexOf(',T', address.length + 1);
  if (tagsIndex === -1) return null;
  const payload = buffer.subarray(tagsIndex + 4);
  const value = payload.length > 0 && payload[0] === 1;
  return { address, value };
}

export const oscAfkMonitor = new OscAfkMonitor();
