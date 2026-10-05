using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioBridge.Sidecar;

/// <summary>
/// Live peak meters. Render endpoints use WASAPI loopback; capture endpoints
/// (mic, "VoiceMeeter Output") are opened as normal capture clients.
/// Emits <c>meter.update</c> events at ~10 Hz per endpoint.
/// </summary>
public sealed class MeterService : IDisposable
{
    private sealed class Stream : IDisposable
    {
        public WasapiCapture? Capture;
        public volatile bool Running;
        public void Dispose()
        {
            Running = false;
            try { Capture?.StopRecording(); } catch { /* ignore */ }
            try { Capture?.Dispose(); } catch { /* ignore */ }
        }
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, Stream> _streams = new(StringComparer.OrdinalIgnoreCase);

    public void Start(string endpointId)
    {
        lock (_gate)
        {
            if (_streams.ContainsKey(endpointId)) return;

            using var enumerator = new MMDeviceEnumerator();
            MMDevice dev;
            try
            {
                dev = enumerator.GetDevice(endpointId);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Unknown endpoint {endpointId}: {ex.Message}");
            }

            WasapiCapture capture;
            try
            {
                capture = dev.DataFlow == DataFlow.Render
                    ? new WasapiLoopbackCapture(dev)
                    : new WasapiCapture(dev, useEventSync: false, audioBufferMillisecondsLength: 100);
            }
            catch (Exception ex)
            {
                dev.Dispose();
                throw new InvalidOperationException($"Cannot open meter on endpoint: {ex.Message}");
            }

            var stream = new Stream { Capture = capture, Running = true };
            capture.DataAvailable += (_, e) =>
            {
                // Loopback can deliver audio buffers far faster than the 10 Hz
                // meter refresh rate. Gate before scanning PCM so skipped frames
                // cost only a short lock/clock read rather than a full buffer walk.
                if (!stream.Running || !TryScheduleSample(endpointId)) return;
                var peak = PeakFromBuffer(e.Buffer, e.BytesRecorded, capture.WaveFormat);
                Emit(endpointId, peak);
            };
            capture.RecordingStopped += (_, _) =>
            {
                // Device unplugged / engine restart: drop the stream so it can be restarted.
                lock (_gate) { _streams.Remove(endpointId); }
                try { capture.Dispose(); } catch { /* ignore */ }
            };

            try
            {
                capture.StartRecording();
            }
            catch (Exception ex)
            {
                capture.Dispose();
                dev.Dispose();
                throw new InvalidOperationException($"Cannot start meter: {ex.Message}");
            }

            dev.Dispose();
            _streams[endpointId] = stream;
        }
    }

    public void Stop(string endpointId)
    {
        lock (_gate)
        {
            if (_streams.Remove(endpointId, out var s)) s.Dispose();
            _lastEmit.Remove(endpointId);
        }
    }

    /// <summary>
    /// Peak of one captured buffer in dBFS. Reads the bytes in place — the
    /// capture callback runs ~10x/sec per stream, so copying each buffer into a
    /// freshly allocated array was the main source of GC pressure in the sidecar.
    /// </summary>
    internal static float PeakFromBuffer(byte[] buffer, int bytesRecorded, WaveFormat fmt)
    {
        if (buffer.Length == 0 || bytesRecorded <= 0) return -100f;
        var bitsPerSample = fmt.BitsPerSample;
        if (bitsPerSample <= 0) return -100f;
        var bytesPerSample = bitsPerSample / 8;
        if (bytesPerSample <= 0) return -100f;

        // Only whole samples that actually fit in this buffer.
        var usable = Math.Min(buffer.Length, bytesRecorded) / bytesPerSample * bytesPerSample;
        float peak = 0f;

        if (fmt.Encoding == WaveFormatEncoding.IeeeFloat && bitsPerSample == 32)
        {
            foreach (var f in MemoryMarshal.Cast<byte, float>(buffer.AsSpan(0, usable)))
            {
                var a = Math.Abs(f);
                if (a > peak) peak = a;
            }
        }
        else if (bitsPerSample == 16)
        {
            foreach (var s in MemoryMarshal.Cast<byte, short>(buffer.AsSpan(0, usable)))
            {
                var a = Math.Abs(s / 32768f);
                if (a > peak) peak = a;
            }
        }
        else if (bitsPerSample == 32)
        {
            foreach (var i in MemoryMarshal.Cast<byte, int>(buffer.AsSpan(0, usable)))
            {
                var a = Math.Abs(i / (float)int.MaxValue);
                if (a > peak) peak = a;
            }
        }
        else
        {
            return -100f;
        }

        if (peak <= 0.0000001f) return -100f;
        return Math.Max(-100f, 20f * MathF.Log10(peak));
    }

    // Throttle per endpoint to ~10 Hz.
    private readonly Dictionary<string, long> _lastEmit = new(StringComparer.OrdinalIgnoreCase);

    private bool TryScheduleSample(string endpointId)
    {
        var now = Environment.TickCount64;
        lock (_gate)
        {
            if (_lastEmit.TryGetValue(endpointId, out var last) && now - last < 100) return false;
            _lastEmit[endpointId] = now;
            return true;
        }
    }

    private static void Emit(string endpointId, float peakDb)
    {
        var now = Environment.TickCount64;
        Rpc.EmitEvent("meter.update", new
        {
            endpointId,
            peakDb = Math.Round(peakDb, 1),
            timestamp = now
        });
    }

    public void Dispose()
    {
        lock (_gate)
        {
            foreach (var s in _streams.Values) s.Dispose();
            _streams.Clear();
            _lastEmit.Clear();
        }
    }
}
