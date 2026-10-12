namespace AudioBridge.Sidecar;

public sealed record ConfigStep(string Name, bool Ok, string? Detail);

public sealed class ConfigResult
{
    public bool Ok { get; set; }
    public List<ConfigStep> Steps { get; set; } = new();
    public void Add(string name, bool ok, string? detail = null) => Steps.Add(new ConfigStep(name, ok, detail));
    public void Finish() => Ok = Steps.All(s => s.Ok);
}

public sealed record VmLayout(int HwStrips, int VirtStart, int PhysBuses)
{
    public int B1Index => PhysBuses;
    public static VmLayout ForKind(int kind) => kind switch
    {
        1 => new VmLayout(2, 2, 1),
        2 => new VmLayout(3, 3, 3),
        3 => new VmLayout(5, 5, 5),
        _ => new VmLayout(5, 5, 5)
    };
}

public sealed class VmConfig
{
    private readonly VoiceMeeterApi _api;
    private readonly object _gate = new();

    public int MusicStrip { get; private set; } = -1;
    public string? MicName { get; private set; }
    public string MusicEndpointHint { get; private set; } = "";
    public double UserGainDb { get { lock (_gate) return _userGainDb; } }
    public bool MusicToVrchat { get { lock (_gate) return MusicStrip >= 0 && _api.TryGetFloat($"Strip[{MusicStrip}].B1", out var value) && value > 0.5f; } }

    private double _userGainDb = 0;
    private double _duckOffsetDb = 0;
    private bool _duckingEnabled;
    private double _duckThresholdDb = -42;
    private double _duckReductionDb = 12;

    public VmConfig(VoiceMeeterApi api) => _api = api;

    public ConfigResult Apply(string? micEndpointName, string? speakersEndpointName)
    {
        var r = new ConfigResult();

        if (!_api.TryGetKind(out var kind, out var kindName, out var version))
        {
            r.Add("engine", false, "VoiceMeeter audio engine is not responding. Open VoiceMeeter and try again.");
            r.Finish();
            return r;
        }
        r.Add("engine", true, $"{kindName} {VoiceMeeterApi.FormatVersion(version)}");

        var speakerName = speakersEndpointName ?? CoreAudio.GetDefaultEndpoint(
            NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.Role.Multimedia)?.Name;
        var a1Target = string.IsNullOrWhiteSpace(speakerName)
            ? null
            : CoreAudio.FindByName(speakerName, "render") ?? CoreAudio.FindByNameContains(speakerName, "render");
        if (a1Target is null || CoreAudio.IsVirtualRender(a1Target.Name))
        {
            r.Add("a1-output", false, "No physical A1 playback target was selected or detected. No VoiceMeeter routing was changed; select your headphones/speakers and scan again.");
            r.Finish();
            return r;
        }

        var currentA1 = _api.WaitForString("Bus[0].device.name", 1500) ?? "";
        VoiceMeeterApi.VmOutputDevice? a1Device = null;
        if (!OutputDeviceMatches(currentA1, a1Target.Name))
        {
            try
            {
                a1Device = _api.ListOutputDevices()
                    .Where(device => OutputDeviceMatches(device.Name, a1Target.Name) || OutputDeviceMatches(device.HardwareId, a1Target.Id))
                    .OrderBy(device => device.Driver == 4 ? 0 : device.Driver == 8 ? 1 : device.Driver == 1 ? 2 : 3)
                    .FirstOrDefault();
            }
            catch (Exception ex)
            {
                r.Add("a1-output", false, $"Could not scan VoiceMeeter playback devices: {ex.Message}. No routing was changed.");
                r.Finish();
                return r;
            }

            if (a1Device is null)
            {
                r.Add("a1-output", false, $"Could not match Windows output '{a1Target.Name}' to a VoiceMeeter A1 device. No routing was changed; select it manually on A1 and scan again.");
                r.Finish();
                return r;
            }
        }
        r.Add("a1-output-scan", true, $"Windows playback target: {a1Target.Name}; VoiceMeeter A1 {(a1Device is null ? "already matches" : $"can select {a1Device.Name}")}");

        var layout = VmLayout.ForKind(kind);

        var musicEp = CoreAudio.FindByNameContains("VoiceMeeter Aux Input", "render")
                      ?? CoreAudio.FindByNameContains("VoiceMeeter Input", "render");
        if (musicEp is null)
        {
            r.Add("music-endpoint", false, "No VoiceMeeter virtual input endpoint found (driver may need a reboot after install).");
            r.Finish();
            return r;
        }
        var isAux = musicEp.Name.Contains("Aux", StringComparison.OrdinalIgnoreCase);
        MusicStrip = layout.VirtStart + (isAux ? 1 : 0);
        MusicEndpointHint = musicEp.Name;
        r.Add("music-endpoint", true, $"{musicEp.Name} → strip {MusicStrip + 1}");

        var outputOk = ApplyA1Output(a1Target.Name, a1Device, out var outputDetail);
        r.Add("a1-output", outputOk, outputDetail);
        if (!outputOk)
        {
            r.Finish();
            return r;
        }

        var micName = micEndpointName ?? CoreAudio.ListEndpoints()
            .FirstOrDefault(e => e.Direction == "capture" && !CoreAudio.IsVirtualCapture(e.Name))?.Name;
        MicName = micName;
        r.Add("mic-device", ApplyMicDevice(micName, out var micDetail), micDetail);

        var strip0 = "Strip[0].";
        var stripM = $"Strip[{MusicStrip}].";
        var routingOk = true;
        routingOk &= SetAndVerifyFloat(strip0 + "Mute", 0);
        routingOk &= SetAndVerifyFloat(strip0 + "A1", 0);
        routingOk &= SetAndVerifyFloat(strip0 + "B1", 1);
        routingOk &= SetAndVerifyFloat(stripM + "Mute", 0);
        routingOk &= SetAndVerifyFloat(stripM + "A1", 1);
        routingOk &= SetAndVerifyFloat(stripM + "B1", 1);
        r.Add("strip-routing", routingOk, routingOk
            ? $"mic strip {0}: B1 only · music strip {MusicStrip}: A1+B1 (verified)"
            : $"VoiceMeeter rejected or did not retain a strip send/mute setting (music strip {MusicStrip}, B1 send required). Check the strip buttons manually.");

        var b1 = layout.B1Index;
        var a1Ok = SetAndVerifyFloat("Bus[0].Mute", 0);
        var b1Ok = SetAndVerifyFloat($"Bus[{b1}].Mute", 0);
        var busOk = a1Ok && b1Ok;
        var busDetail = $"A1 = Bus[0], B1 = Bus[{b1}]";
        if (!a1Ok || !b1Ok)
            busDetail += " · Could not unmute/verify A1 or B1";
        r.Add("buses", busOk, busDetail);

        r.Finish();
        return r;
    }

    private bool SetAndVerifyFloat(string parameter, float expected)
    {
        if (!_api.TrySetFloat(parameter, expected)) return false;
        return _api.TryGetFloat(parameter, out var actual) && Math.Abs(actual - expected) < 0.01f;
    }

    private bool ApplyA1Output(string endpointName, VoiceMeeterApi.VmOutputDevice? match, out string detail)
    {
        var current = _api.WaitForString("Bus[0].device.name", 1500) ?? "";
        if (OutputDeviceMatches(endpointName, current))
        {
            detail = $"A1 monitoring output: {current}";
            return true;
        }
        if (match is null)
        {
            detail = $"No VoiceMeeter A1 device matched '{endpointName}'.";
            return false;
        }

        try
        {
            _api.SetString($"Bus[0].device.{match.DriverName}", match.Name);
        }
        catch (Exception ex)
        {
            detail = $"Could not assign A1 to '{match.Name}': {ex.Message}.";
            return false;
        }

        // Selecting a device makes VoiceMeeter rebuild the audio engine; poll
        // until it reports the new output instead of giving up after one read.
        var verified = _api.WaitForString("Bus[0].device.name", 4000);
        if (verified is not null && OutputDeviceMatches(verified, match.Name))
        {
            detail = $"A1 monitoring output set to {verified}";
            return true;
        }

        detail = verified is null
            ? $"VoiceMeeter did not report an A1 output after selecting '{match.Name}'. Check A1 in VoiceMeeter and try again."
            : $"VoiceMeeter did not confirm A1 output '{match.Name}'.";
        return false;
    }

    private static bool OutputDeviceMatches(string first, string second) =>
        CoreAudio.DeviceNamesMatch(first, second);

    private bool ApplyMicDevice(string? micName, out string detail)
    {
        detail = "";
        if (string.IsNullOrWhiteSpace(micName))
        {
            detail = "No microphone endpoint found.";
            return false;
        }

        var currentMic = _api.WaitForString("Strip[0].device.name", 1500);
        if (currentMic is not null && DeviceMatches(currentMic, micName))
        {
            detail = $"strip 1 already on {currentMic}";
            return true;
        }

        var devices = _api.ListInputDevices();
        var match = devices
            .Where(d => DeviceMatches(d.Name, micName))
            .OrderBy(d => d.Driver == 4 ? 0 : d.Driver == 8 ? 1 : d.Driver == 1 ? 2 : 3)
            .FirstOrDefault();

        if (match is null)
        {
            detail = $"“{micName}” not visible to VoiceMeeter — select it manually on Hardware Strip 1.";
            return false;
        }

        var param = $"Strip[0].device.{match.DriverName}";
        try
        {
            _api.SetString(param, match.Name);
        }
        catch (Exception ex)
        {
            detail = $"device set failed: {ex.Message}";
            return false;
        }

        var verify = _api.WaitForString("Strip[0].device.name", 4000);
        if (verify is not null && DeviceMatches(verify, micName))
        {
            detail = $"strip 1 → {verify}";
            return true;
        }
        detail = $"set attempted (driver {match.DriverName}) but not confirmed — verify on Hardware Strip 1.";
        return false;
    }

    private static bool DeviceMatches(string vmDeviceName, string endpointFriendlyName)
    {
        if (string.IsNullOrWhiteSpace(vmDeviceName) || string.IsNullOrWhiteSpace(endpointFriendlyName)) return false;
        var a = vmDeviceName.Trim();
        var b = endpointFriendlyName.Trim();
        static string Normalize(string s)
        {
            var i = s.LastIndexOf('(');
            if (i >= 0 && s.EndsWith(')')) s = s[..i];
            return string.Concat(s.Where(char.IsLetterOrDigit)).ToLowerInvariant();
        }
        if (a.Equals(b, StringComparison.OrdinalIgnoreCase) || Normalize(a) == Normalize(b)) return true;
        static string Core(string s)
        {
            var i = s.LastIndexOf('(');
            return (i >= 0 && s.EndsWith(')') ? s[..i] : s).Trim();
        }
        var ca = Core(a);
        var cb = Core(b);
        if (string.IsNullOrWhiteSpace(ca) || string.IsNullOrWhiteSpace(cb)) return false;
        if (ca.Equals(cb, StringComparison.OrdinalIgnoreCase)) return true;
        if (ca.Contains(cb, StringComparison.OrdinalIgnoreCase)) return true;
        if (cb.Contains(ca, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public void SetUserGain(double db)
    {
        lock (_gate)
        {
            _userGainDb = Math.Clamp(db, -60, 12);
            ApplyGain();
        }
    }

    public void ConfigureDucking(bool enabled, double thresholdDb, double reductionDb)
    {
        lock (_gate)
        {
            _duckingEnabled = enabled;
            _duckThresholdDb = thresholdDb;
            _duckReductionDb = reductionDb;
            if (!enabled) _duckOffsetDb = 0;
            ApplyGain();
        }
    }

    public bool DuckingEnabled { get { lock (_gate) return _duckingEnabled; } }
    public double DuckThresholdDb { get { lock (_gate) return _duckThresholdDb; } }
    public double MusicGainDb { get { lock (_gate) return _userGainDb + _duckOffsetDb; } }

    public void SetDucked(bool ducked)
    {
        lock (_gate)
        {
            var target = ducked && _duckingEnabled ? -_duckReductionDb : 0.0;
            if (Math.Abs(target - _duckOffsetDb) < 0.01) return;
            _duckOffsetDb = target;
            ApplyGain();
        }
    }

    private void ApplyGain()
    {
        if (MusicStrip < 0) return;
        var total = _userGainDb + _duckOffsetDb;
        _api.TrySetFloat($"Strip[{MusicStrip}].Gain", (float)total);
    }

    public bool SetBusMute(int bus, bool mute) => _api.TrySetFloat($"Bus[{bus}].Mute", mute ? 1 : 0);

    public bool SetMusicToVrchat(bool on)
    {
        lock (_gate)
        {
            if (MusicStrip < 0) return false;
            return _api.TrySetFloat($"Strip[{MusicStrip}].B1", on ? 1 : 0);
        }
    }

    public ConfigResult RestoreBaseline(VoiceMeeterBaseline baseline)
    {
        var result = new ConfigResult();
        if (!_api.TryGetKind(out var kind, out _, out _) || kind != baseline.Kind)
        {
            result.Add("voicemeeter", false, "VoiceMeeter is not running the same edition captured in this audio snapshot.");
            result.Finish();
            return result;
        }

        var musicEndpoint = CoreAudio.FindByName(baseline.MusicEndpoint, "render");
        var musicStrip = musicEndpoint is null ? -1 : VmLayout.ForKind(kind).VirtStart +
            (musicEndpoint.Name.Contains("Aux", StringComparison.OrdinalIgnoreCase) ? 1 : 0);
        if (musicStrip != baseline.MusicStrip)
        {
            result.Add("voicemeeter", false, "The saved VoiceMeeter music input is missing or its strip changed. No saved VoiceMeeter settings were restored.");
            result.Finish();
            return result;
        }

        var currentA1 = _api.TryGetString("Bus[0].device.name", out var a1) ? a1 : "";
        var a1Device = _api.ListOutputDevices().FirstOrDefault(device =>
            OutputDeviceMatches(device.Name, baseline.A1Output) || OutputDeviceMatches(device.HardwareId, baseline.A1Output));
        if (!OutputDeviceMatches(currentA1, baseline.A1Output) && a1Device is null)
        {
            result.Add("voicemeeter", false, $"Saved A1 output '{baseline.A1Output}' is not available in VoiceMeeter. No saved VoiceMeeter settings were restored.");
            result.Finish();
            return result;
        }

        var mic = _api.ListInputDevices().FirstOrDefault(device => DeviceMatches(device.Name, baseline.MicrophoneDevice));
        var currentMic = _api.TryGetString("Strip[0].device.name", out var micName) ? micName : "";
        if (!DeviceMatches(currentMic, baseline.MicrophoneDevice) && mic is null)
        {
            result.Add("voicemeeter", false, $"Saved microphone '{baseline.MicrophoneDevice}' is not available in VoiceMeeter. No saved VoiceMeeter settings were restored.");
            result.Finish();
            return result;
        }

        if (!OutputDeviceMatches(currentA1, baseline.A1Output) && a1Device is not null)
            _api.SetString($"Bus[0].device.{a1Device.DriverName}", a1Device.Name);
        if (!DeviceMatches(currentMic, baseline.MicrophoneDevice) && mic is not null)
            _api.SetString($"Strip[0].device.{mic.DriverName}", mic.Name);

        var checks = new List<bool>
        {
            SetAndVerifyFloat("Strip[0].Mute", baseline.MicMute),
            SetAndVerifyFloat("Strip[0].A1", baseline.MicA1),
            SetAndVerifyFloat("Strip[0].B1", baseline.MicB1),
            SetAndVerifyFloat("Strip[0].Gain", baseline.MicGain),
            SetAndVerifyFloat($"Strip[{musicStrip}].Mute", baseline.MusicMute),
            SetAndVerifyFloat($"Strip[{musicStrip}].A1", baseline.MusicA1),
            SetAndVerifyFloat($"Strip[{musicStrip}].B1", baseline.MusicB1),
            SetAndVerifyFloat($"Strip[{musicStrip}].Gain", baseline.MusicGain),
            SetAndVerifyFloat("Bus[0].Mute", baseline.A1Mute),
            SetAndVerifyFloat($"Bus[{VmLayout.ForKind(kind).B1Index}].Mute", baseline.B1Mute)
        };
        var restoredA1 = _api.WaitForString("Bus[0].device.name", 4000);
        var restoredMic = _api.WaitForString("Strip[0].device.name", 4000);
        var deviceOk = restoredA1 is not null && OutputDeviceMatches(restoredA1, baseline.A1Output) &&
                       restoredMic is not null && DeviceMatches(restoredMic, baseline.MicrophoneDevice);
        var allOk = checks.All(ok => ok) && deviceOk;
        result.Add("voicemeeter", allOk, allOk ? "Saved VoiceMeeter input devices, sends, mutes, gains, and monitor output restored." : "One or more VoiceMeeter settings could not be restored and verified.");
        if (allOk)
        {
            MusicStrip = musicStrip;
            MicName = baseline.MicrophoneDevice;
            MusicEndpointHint = baseline.MusicEndpoint;
            _userGainDb = Math.Clamp(baseline.MusicGain, -60, 12);
            _duckOffsetDb = 0;
            _duckingEnabled = false;
        }
        result.Finish();
        return result;
    }

    public void RestoreControlState(double userGainDb, bool duckingEnabled)
    {
        lock (_gate)
        {
            _userGainDb = Math.Clamp(userGainDb, -60, 12);
            _duckOffsetDb = 0;
            _duckingEnabled = duckingEnabled;
            ApplyGain();
        }
    }
}
