using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioBridge.Sidecar;

public sealed class DuckingMonitor : IDisposable
{
    private readonly VmConfig _config;
    private readonly object _gate = new();
    private WasapiCapture? _capture;
    private string? _endpointId;
    private long _lastLoudTick;
    private bool _ducked;

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
                try { capture.Dispose(); } catch { }
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
        return eps.FirstOrDefault(e => e.IsDefault && !CoreAudio.IsVirtualCapture(e.Name))
               ?? eps.FirstOrDefault(e => !CoreAudio.IsVirtualCapture(e.Name));
    }

    private void OnAudio(byte[] buffer, int bytesRecorded, WaveFormat fmt)
    {
        if (!_config.DuckingEnabled) return;

        var now = Environment.TickCount64;
        var peak = MeterService.PeakFromBuffer(buffer, bytesRecorded, fmt);
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
            try { c.StopRecording(); } catch { }
            try { c.Dispose(); } catch { }
            _config.SetDucked(false);
        }
    }

    public void Dispose() => Stop();
}
