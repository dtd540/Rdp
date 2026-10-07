import { createSocket } from 'dgram';
import { validateChatText } from '@shared/gaming';

export const CHATBOX_INTERVAL_MS = 1500;

export function oscString(value: string): Buffer {
  const bytes = Buffer.from(`${value}\0`, 'utf8');
  const packet = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
  bytes.copy(packet);
  return packet;
}

export function localOscPort(value: unknown = 9000): number {
  if (value === undefined) return 9000;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('OSC port must be an integer between 1024 and 65535.');
  return value;
}

export function chatboxPacket(text: string, sound = false, sendImmediately = true): Buffer {
  return Buffer.concat([
    oscString('/chatbox/input'),
    oscString(`,s${sendImmediately ? 'T' : 'F'}${sound ? 'T' : 'F'}`),
    oscString(text === '' ? '' : validateChatText(text))
  ]);
}

export function typingPacket(typing: boolean): Buffer {
  return Buffer.concat([oscString('/chatbox/typing'), oscString(typing ? ',T' : ',F')]);
}

/** A reusable sender with an injectable transport for byte-level/integration testing. */
export class ChatboxSender {
  private lastChatAt = -Infinity;
  private lastTypingAt = -Infinity;
  constructor(private readonly transmit: (packet: Buffer, port: number) => Promise<void> = sendLocalPacket, private readonly clock: () => number = Date.now) {}

  async send(input: unknown): Promise<void> {
    if (!input || typeof input !== 'object') throw new Error('Invalid chatbox request.');
    const request = input as { text?: unknown; sound?: unknown; send?: unknown; clear?: unknown; port?: unknown; host?: unknown };
    if (request.host !== undefined && request.host !== '127.0.0.1' && request.host !== 'localhost') throw new Error('OSC chatbox is restricted to this PC.');
    for (const key of ['sound', 'send', 'clear'] as const) {
      if (request[key] !== undefined && typeof request[key] !== 'boolean') throw new Error(`Invalid ${key === 'sound' ? 'notification' : key} setting.`);
    }
    const port = localOscPort(request.port);
    const text = request.clear === true ? '' : validateChatText(request.text);
    if (this.clock() - this.lastChatAt < CHATBOX_INTERVAL_MS) throw new Error('Wait 1.5 seconds between chatbox messages.');
    // Record before awaiting so concurrent callers cannot bypass the rate limit.
    this.lastChatAt = this.clock();
    await this.transmit(chatboxPacket(text, request.clear ? false : request.sound === true, request.send !== false), port);
  }

  async typing(input: unknown): Promise<void> {
    if (!input || typeof input !== 'object') throw new Error('Invalid typing request.');
    const request = input as { typing?: unknown; port?: unknown };
    if (typeof request.typing !== 'boolean') throw new Error('Typing state must be true or false.');
    const port = localOscPort(request.port);
    if (this.clock() - this.lastTypingAt < 200 && request.typing) throw new Error('Typing updates are too frequent.');
    this.lastTypingAt = this.clock();
    await this.transmit(typingPacket(request.typing), port);
  }
}

/** No arbitrary destination, no OSC listeners, and no unused sockets left open. */
export function sendLocalPacket(packet: Buffer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    let finished = false;
    const finish = (error?: Error | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('OSC send timed out.')), 3000);
    socket.once('error', finish);
    socket.send(packet, localOscPort(port), '127.0.0.1', finish);
  });
}

export const chatboxSender = new ChatboxSender();
export const sendChatbox = (input: unknown): Promise<void> => chatboxSender.send(input);
