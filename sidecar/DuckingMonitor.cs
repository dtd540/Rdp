using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioBridge.Sidecar;

/// <summary>
/// Captures the microphone directly and ducks the music strip while speech is detected.
/// Hysteresis: instant duck above threshold, release only after 600 ms of quiet
/// (6 dB below threshold) so words don't make the music pump.
/// </summary>
public sealed class DuckingMonitor : IDisposable
{
    private readonly VmConfig _config;
    private readonly object _gate = new();
    private WasapiCapture? _capture;
    private string? _endpointId;
    private long _lastLoudTick;
    private bool _ducked;
    private long _lastEvalTick;

    public DuckingMonitor(VmConfig config) => _config = config;

    public string? EndpointId { get { lock (_gate) return _endpointId; } }

    public void Start(string? preferredMicName)
    {
        lock (_gate)
        {
            StopLocked();

            var ep = ResolveMic(preferredMicName)
                     ?? throw new InvalidOperationException("No microphone endpoint available for ducking");

            using var enumerator = new MMDeviceEnumerator();
            var dev = enumerator.GetDevice(ep.Id);
            WasapiCapture capture;
            try
            {
                capture = new WasapiCapture(dev, useEventSync: false, audioBufferMillisecondsLength: 100);
            }
            catch (Exception ex)
            {
                dev.Dispose();
                throw new InvalidOperationException($"Cannot open mic for ducking: {ex.Message}");
            }

            capture.DataAvailable += (_, e) => OnAudio(e.Buffer, e.BytesRecorded, capture.WaveFormat);
            capture.RecordingStopped += (_, _) =>
            {
                lock (_gate)
                {
                    if (ReferenceEquals(_capture, capture))
                    {
                        _capture = null;
                        _endpointId = null;
                        _config.SetDucked(false);
                    }
                }
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
                throw new InvalidOperationException($"Cannot start mic capture: {ex.Message}");
            }
            dev.Dispose();

            _capture = capture;
            _endpointId = ep.Id;
            _ducked = false;
            _lastLoudTick = 0;
        }
    }

    private static AudioEndpointInfo? ResolveMic(string? preferredMicName)
    {
        var eps = CoreAudio.ListEndpoints().Where(e => e.Direction == "capture").ToList();
        if (!string.IsNullOrWhiteSpace(preferredMicName))
        {
            var match = eps.FirstOrDefault(e =>
                string.Equals(e.Name, preferredMicName, StringComparison.OrdinalIgnoreCase));
            if (match is not null && !CoreAudio.IsVirtualCapture(match.Name))
                return match;
        }
        // Default capture, never a virtual cable (would feedback).
        return eps.FirstOrDefault(e => e.IsDefault && !CoreAudio.IsVirtualCapture(e.Name))
               ?? eps.FirstOrDefault(e => !CoreAudio.IsVirtualCapture(e.Name));
    }

    private void OnAudio(byte[] buffer, int bytesRecorded, WaveFormat fmt)
    {
        if (!_config.DuckingEnabled) return;

        // Evaluate at ~20 Hz max.
        var now = Environment.TickCount64;
        if (now - _lastEvalTick < 50)
        {
            // still need loud-detection data on skipped frames; just skip eval
        }
        _lastEvalTick = now;

        var peak = MeterServicePeak(buffer, bytesRecorded, fmt);
        var threshold = _config.DuckThresholdDb;

        if (peak > threshold)
        {
            _lastLoudTick = now;
            if (!_ducked)
            {
                _ducked = true;
                _config.SetDucked(true);
            }
        }
        else if (_ducked && now - _lastLoudTick > 600 && peak < threshold - 6)
        {
            _ducked = false;
            _config.SetDucked(false);
        }
    }

    private static float MeterServicePeak(byte[] buffer, int bytesRecorded, WaveFormat fmt)
    {
        if (bytesRecorded <= 0) return -100f;
        var bytesPerSample = fmt.BitsPerSample / 8;
        if (bytesPerSample <= 0) return -100f;
        var samples = bytesRecorded / bytesPerSample;
        var peak = 0.0;
        if (fmt.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            var floats = new float[samples];
            Buffer.BlockCopy(buffer, 0, floats, 0, samples * 4);
            foreach (var f in floats) { var a = Math.Abs(f); if (a > peak) peak = a; }
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
            foreach (var i in ints) { var a = Math.Abs(i / (double)int.MaxValue); if (a > peak) peak = a; }
        }
        return peak <= 1e-7 ? -100f : (float)Math.Max(-100.0, 20.0 * Math.Log10(peak));
    }

    public void Stop()
    {
        lock (_gate) StopLocked();
    }

    private void StopLocked()
    {
        if (_capture is { } c)
        {
            _capture = null;
            _endpointId = null;
            try { c.StopRecording(); } catch { /* ignore */ }
            try { c.Dispose(); } catch { /* ignore */ }
            _config.SetDucked(false);
        }
    }

    public void Dispose() => Stop();
}
