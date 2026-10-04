using NAudio.Wave;

namespace AudioBridge.Sidecar;

/// <summary>
/// Renders a test tone to an endpoint. Used by the wizard's diagnostics and as a
/// guaranteed-live audio session when verifying per-app routing (Windows refuses
/// SetPersistedDefaultAudioEndpoint for processes that aren't rendering audio).
/// </summary>
public static class Diagnostics
{
    private static readonly object Gate = new();
    private static WasapiOut? _out;
    private static SignalGeneratorProvider? _gen;

    public static object PlayTone(string? endpointName, double seconds)
    {
        lock (Gate)
        {
            StopLocked();
            var ep = string.IsNullOrWhiteSpace(endpointName)
                ? CoreAudio.ListEndpoints().FirstOrDefault(e => e.Direction == "render" && e.IsDefault)
                : CoreAudio.FindByName(endpointName, "render") ?? CoreAudio.FindByNameContains(endpointName, "render");
            if (ep is null) throw new InvalidOperationException($"render endpoint '{endpointName}' not found");

            using var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            var dev = enumerator.GetDevice(ep.Id);
            try
            {
                var format = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
                _out = new WasapiOut(dev, NAudio.CoreAudioApi.AudioClientShareMode.Shared, false, 50);
                _gen = new SignalGeneratorProvider(format, TimeSpan.FromSeconds(Math.Clamp(seconds, 0.5, 15)));
                _out.Init(_gen);
                _out.Play();
            }
            finally
            {
                dev.Dispose();
            }
            return new { playing = true, endpoint = ep.Name };
        }
    }

    public static object Stop()
    {
        lock (Gate) StopLocked();
        return new { stopped = true };
    }

    private static void StopLocked()
    {
        try { _out?.Stop(); } catch { /* ignore */ }
        try { _out?.Dispose(); } catch { /* ignore */ }
        _out = null;
        _gen = null;
    }

    /// <summary>440 Hz sine at -12 dBFS with 30 ms fade-in/out, looping until duration elapses.</summary>
    private sealed class SignalGeneratorProvider : ISampleProvider
    {
        private readonly WaveFormat _format;
        private readonly double _durationSec;
        private long _pos;
        private readonly long _totalSamples;
        private readonly DateTime _start = DateTime.UtcNow;

        public SignalGeneratorProvider(WaveFormat format, TimeSpan duration)
        {
            _format = format;
            _durationSec = duration.TotalSeconds;
            _totalSamples = (long)(duration.TotalSeconds * format.SampleRate);
        }

        public WaveFormat WaveFormat => _format;

        public int Read(float[] buffer, int offset, int count)
        {
            if ((DateTime.UtcNow - _start).TotalSeconds >= _durationSec || _pos >= _totalSamples)
            {
                Array.Clear(buffer, offset, count);
                return count; // keep stream alive until WasapiOut is stopped by caller/timeout
            }
            var freq = 440.0;
            var amp = 0.25f; // ≈ -12 dBFS
            for (var i = 0; i < count; i++)
            {
                var t = (double)(_pos + i) / _format.SampleRate;
                var fade = Math.Clamp(Math.Min(t / 0.03, (_durationSec - t) / 0.03), 0, 1);
                var sample = amp * (float)(Math.Sin(2 * Math.PI * freq * t) * fade);
                buffer[offset + i] = sample;
            }
            _pos += count;
            return count;
        }
    }
}
