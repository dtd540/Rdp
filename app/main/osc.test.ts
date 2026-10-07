import { createSocket } from 'dgram';
import { describe, expect, it, vi } from 'vitest';
import { ChatboxSender, chatboxPacket, localOscPort, sendLocalPacket, typingPacket } from './osc';

describe('original OSC transport', () => {
  it('encodes send versus draft and typing/clear booleans', () => {
    expect(chatboxPacket('hello', false, false).subarray(16, 24).toString()).toContain(',sFF');
    expect(chatboxPacket('', false).subarray(24).equals(Buffer.alloc(4))).toBe(true);
    expect(typingPacket(true).toString()).toContain(',T');
    expect(typingPacket(false).toString()).toContain(',F');
  });
  it('rejects remote hosts, invalid ports and invalid message options', async () => {
    const transport = vi.fn(async (_packet: Buffer, _port: number) => {});
    const sender = new ChatboxSender(transport);
    await expect(sender.send({ text: 'hello', host: 'example.com' })).rejects.toThrow('this PC');
    await expect(sender.send({ text: 'hello', port: 0 })).rejects.toThrow('port');
    await expect(sender.send({ text: 'hello', send: 'yes' })).rejects.toThrow('send');
    for (const port of [NaN, 1, 65536, 9000.5, '9000']) expect(() => localOscPort(port)).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('rate-limits concurrent sends and permits a later clear operation', async () => {
    let now = 10000;
    const transport = vi.fn(async (_packet: Buffer, _port: number) => {});
    const sender = new ChatboxSender(transport, () => now);
    await sender.send({ text: 'first' });
    await expect(sender.send({ text: 'second' })).rejects.toThrow('1.5');
    now += 1500;
    await sender.send({ clear: true, port: 9123 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][1]).toBe(9123);
  });
  it('delivers exact packets to a real local UDP receiver, without contacting VRChat', async () => {
    const receiver = createSocket('udp4');
    try {
      await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve));
      const port = receiver.address().port;
      const received = new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No UDP packet received')), 2000);
        receiver.once('message', (packet) => { clearTimeout(timer); resolve(packet); });
      });
      const sender = new ChatboxSender(sendLocalPacket);
      await sender.send({ text: 'Test 😀', sound: false, port });
      expect(await received).toEqual(chatboxPacket('Test 😀', false));
    } finally { receiver.close(); }
  });
});
