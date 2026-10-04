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
                if (!stream.Running) return;
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
        }
    }

    private static float PeakFromBuffer(byte[] buffer, int bytesRecorded, WaveFormat fmt)
    {
        if (bytesRecorded <= 0) return -100f;
        var bytesPerSample = fmt.BitsPerSample / 8;
        if (bytesPerSample <= 0) return -100f;
        var channels = Math.Max(1, fmt.Channels);
        var samples = bytesRecorded / bytesPerSample;
        var peak = 0.0;

        if (fmt.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            var floats = new float[samples];
            Buffer.BlockCopy(buffer, 0, floats, 0, samples * 4);
            foreach (var f in floats)
            {
                var a = Math.Abs(f);
                if (a > peak) peak = a;
            }
        }
        else if (fmt.BitsPerSample == 16)
        {
            for (var i = 0; i + 1 < samples; i++)
            {
                var v = Math.Abs(BitConverter.ToInt16(buffer, i * 2)) / 32768.0;
                if (v > peak) peak = v;
            }
        }
        else if (fmt.BitsPerSample == 32)
        {
            var ints = new int[samples];
            Buffer.BlockCopy(buffer, 0, ints, 0, samples * 4);
            foreach (var i in ints)
            {
                var a = Math.Abs(i / (double)int.MaxValue);
                if (a > peak) peak = a;
            }
        }

        _ = channels;
        if (peak <= 0.0000001) return -100f;
        return (float)Math.Max(-100.0, 20.0 * Math.Log10(peak));
    }

    // Throttle per endpoint to ~10 Hz.
    private readonly Dictionary<string, long> _lastEmit = new(StringComparer.OrdinalIgnoreCase);

    private void Emit(string endpointId, float peakDb)
    {
        var now = Environment.TickCount64;
        lock (_gate)
        {
            if (_lastEmit.TryGetValue(endpointId, out var last) && now - last < 100) return;
            _lastEmit[endpointId] = now;
        }
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
        }
    }
}
