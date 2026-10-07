using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Text.Json;

namespace AudioBridge.Sidecar;

public static class Program
{
    private static MeterService _meters = null!;
    private static VoiceMeeterApi? _vm;
    private static VmConfig? _cfg;
    private static DuckingMonitor? _duck;
    private static AppRouter? _router;
    private static readonly object ServiceGate = new();

    private static VoiceMeeterApi Vm
    {
        get
        {
            lock (ServiceGate)
            {
                if (_vm is null)
                {
                    _vm = new VoiceMeeterApi();
                    _cfg = new VmConfig(_vm);
                    _duck = new DuckingMonitor(_cfg);
                }
                return _vm;
            }
        }
    }

    private static VmConfig Cfg
    {
        get { Vm.ToString(); lock (ServiceGate) return _cfg!; }
    }

    public static int Main()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.InputEncoding = System.Text.Encoding.UTF8;
        _meters = new MeterService();

        Rpc.Log("info", $"sidecar started pid={Environment.ProcessId}");

        string? line;
        while ((line = Console.In.ReadLine()) is not null)
        {
            if (line.Trim().Length == 0) continue;
            Rpc.Request? req;
            try
            {
                req = JsonSerializer.Deserialize<Rpc.Request>(line, Rpc.JsonOptions);
            }
            catch (Exception ex)
            {
                Rpc.Log("warn", $"bad request: {ex.Message}");
                continue;
            }
            if (req is null || string.IsNullOrEmpty(req.Method)) continue;

            var captured = req;
            ThreadPool.QueueUserWorkItem(_ => Handle(captured));
        }

        Rpc.Log("info", "stdin closed — exiting");
        Cleanup();
        return 0;
    }

    private static void Handle(Rpc.Request req)
    {
        try
        {
            var result = Dispatch(req.Method, req.Params);
            Rpc.Write(new Rpc.Response { Id = req.Id, Result = result });
        }
        catch (Exception ex)
        {
            Rpc.Write(new Rpc.Response
            {
                Id = req.Id,
                Error = new Rpc.RpcError { Code = Rpc.AppError, Message = ex.Message }
            });
        }
    }

    private static object? Dispatch(string method, JsonElement? parms) => method switch
    {
        "ping" => "pong",

        "endpoints.list" => CoreAudio.ListEndpoints(Rpc.Param<bool?>(parms, "force") ?? false),
        "audio.scanSettings" => AudioScanSettings(),

        "sessions.list" => CoreAudio.ListSessions(Req(parms, "endpointId")),

        "sessions.findByProcess" => CoreAudio.FindSessionByProcess(
            Req(parms, "endpointId"), Req(parms, "processName")),

        "meter.start" => StartMeter(Req(parms, "endpointId")),
        "meter.stop" => StopMeter(Req(parms, "endpointId")),

        "vm.state" => VmState(),
        "vm.launch" => VmLaunch(),
        "vm.applyConfig" => Cfg.Apply(
            Rpc.Param<string>(parms, "micEndpointName"),
            Rpc.Param<string>(parms, "speakersEndpointName")),
        "vm.routingState" => VmRoutingState(),
        "vm.setStripGain" => SetStripGain(parms),
        "vm.setBusMute" => Cfg.SetBusMute(
            Rpc.Param<int>(parms, "bus"), Rpc.Param<bool>(parms, "mute")),
        "vm.setMusicToVrchat" => Cfg.SetMusicToVrchat(Rpc.Param<bool>(parms, "on")),
        "vm.setDucking" => SetDucking(parms),
        "vm.shutdown" => VmShutdown(),

        "route.app" => RouteApp(parms),
        "route.settingsDeepLink" => OpenSettings(),

        "net.stats" => NetStats(),

        "diag.playTone" => Diagnostics.PlayTone(
            Rpc.Param<string>(parms, "endpointName"),
            Rpc.Param<double?>(parms, "seconds") ?? 6),
        "diag.stopTone" => Diagnostics.Stop(),

        _ => throw new KeyNotFoundException($"method not found: {method}")
    };

    private static string Req(JsonElement? parms, string name) =>
        Rpc.Param<string>(parms, name) ?? throw new ArgumentException($"missing param {name}");

    private static object StartMeter(string endpointId)
    {
        _meters.Start(endpointId);
        return new { started = true };
    }

    private static object StopMeter(string endpointId)
    {
        _meters.Stop(endpointId);
        return new { stopped = true };
    }

    private static object VmState()
    {
        var installed = VoiceMeeterApi.IsInstalled;
        var running = false;
        string? kind = null;
        if (installed)
        {
            try
            {
                running = Vm.TryGetKind(out _, out kind, out _);
                if (!running) kind = null;
            }
            catch
            {
            }
        }
        return new
        {
            installed,
            running,
            kind,
            dllPath = VoiceMeeterApi.DllPath
        };
    }

    private static object VmLaunch()
    {
        Vm.Launch();
        return new { launched = true };
    }

    private static object AudioScanSettings()
    {
        var scan = CoreAudio.ScanSettings();
        var vmRunning = Vm.TryGetKind(out _, out var kindName, out _);
        var a1OutputName = vmRunning && Vm.TryGetString("Bus[0].device.name", out var selectedA1Output)
            ? selectedA1Output
            : null;
        var a1Endpoint = !string.IsNullOrWhiteSpace(a1OutputName)
            ? CoreAudio.FindRenderEndpointByDeviceName(a1OutputName)
            : null;
        return new
        {
            scannedAt = scan.ScannedAt,
            consolePlayback = scan.ConsolePlayback,
            defaultPlayback = scan.DefaultPlayback,
            communicationsPlayback = scan.CommunicationsPlayback,
            consoleMicrophone = scan.ConsoleMicrophone,
            defaultMicrophone = scan.DefaultMicrophone,
            communicationsMicrophone = scan.CommunicationsMicrophone,
            physicalPlaybackOutputs = scan.PhysicalPlaybackOutputs,
            spotifySessions = scan.SpotifySessions,
            voiceMeeter = new { running = vmRunning, kind = vmRunning ? kindName : null, a1OutputName, a1MatchesWindowsPlaybackDefault = a1Endpoint is not null && a1Endpoint.Id == scan.DefaultPlayback?.Id }
        };
    }

    private static object VmRoutingState()
    {
        if (!Vm.TryGetKind(out var kind, out var kindName, out _))
            return new { running = false, detail = "VoiceMeeter audio engine is not responding." };

        var layout = VmLayout.ForKind(kind);
        var musicEp = CoreAudio.FindByNameContains("VoiceMeeter Aux Input", "render")
                      ?? CoreAudio.FindByNameContains("VoiceMeeter Input", "render");
        var musicStrip = musicEp is null
            ? -1
            : layout.VirtStart + (musicEp.Name.Contains("Aux", StringComparison.OrdinalIgnoreCase) ? 1 : 0);
        var b1 = layout.B1Index;

        var micToB1 = musicStrip >= 0 && Vm.TryGetFloat("Strip[0].B1", out var micSend) && micSend > 0.5f;
        var musicToB1 = musicStrip >= 0 && Vm.TryGetFloat($"Strip[{musicStrip}].B1", out var musicSend) && musicSend > 0.5f;
        var musicUnmuted = musicStrip >= 0 && Vm.TryGetFloat($"Strip[{musicStrip}].Mute", out var musicMute) && musicMute < 0.5f;
        var b1Unmuted = Vm.TryGetFloat($"Bus[{b1}].Mute", out var b1Mute) && b1Mute < 0.5f;
        var musicToA1 = musicStrip >= 0 && Vm.TryGetFloat($"Strip[{musicStrip}].A1", out var musicA1Send) && musicA1Send > 0.5f;
        var a1Unmuted = Vm.TryGetFloat("Bus[0].Mute", out var a1Mute) && a1Mute < 0.5f;
        var a1OutputName = Vm.TryGetString("Bus[0].device.name", out var selectedA1Output) ? selectedA1Output : null;
        var a1Endpoint = !string.IsNullOrWhiteSpace(a1OutputName)
            ? CoreAudio.FindRenderEndpointByDeviceName(a1OutputName)
            : null;
        var outputName = CoreAudio.FindByName("VoiceMeeter Output", "capture")?.Name;
        return new
        {
            running = true,
            kind = kindName,
            musicEndpoint = musicEp?.Name,
            musicStrip,
            b1BusIndex = b1,
            virtualMic = outputName,
            a1OutputName,
            musicToA1,
            a1Unmuted,
            monitoringOk = musicToA1 && a1Unmuted && a1Endpoint is not null,
            a1MatchesWindowsPlaybackDefault = a1Endpoint is not null && a1Endpoint.IsDefault,
            micToB1,
            musicToB1,
            musicUnmuted,
            b1Unmuted,
            ok = musicStrip >= 0 && micToB1 && musicToB1 && musicUnmuted && b1Unmuted,
            detail = $"{kindName}: music strip {musicStrip}, B1 = Bus[{b1}], virtual mic = {outputName ?? "not detected"}",
            monitoringDetail = $"music → A1: {(musicToA1 ? "on" : "off")}, A1 {(a1Unmuted ? "unmuted" : "muted")}, output: {a1OutputName ?? "not selected"}{(a1Endpoint is null ? " (output endpoint not verified in Windows)" : "")}"
        };
    }

    private static object SetStripGain(JsonElement? parms)
    {
        var strip = Rpc.Param<int?>(parms, "strip") ?? -1;
        var db = Rpc.Param<double>(parms, "db");
        if (strip >= 0)
        {
            Vm.TrySetFloat($"Strip[{strip}].Gain", (float)db);
        }
        else
        {
            Cfg.SetUserGain(db);
        }
        return new { applied = true };
    }

    private static object SetDucking(JsonElement? parms)
    {
        var enabled = Rpc.Param<bool>(parms, "enabled");
        var threshold = Rpc.Param<double?>(parms, "thresholdDb") ?? -42;
        var reduction = Rpc.Param<double?>(parms, "reductionDb") ?? 12;
        Cfg.ConfigureDucking(enabled, threshold, reduction);
        if (enabled)
        {
            try
            {
                _duck!.Start(Cfg.MicName);
                Rpc.Log("info", $"ducking started on {_duck.EndpointId}");
            }
            catch (Exception ex)
            {
                Rpc.Log("error", $"ducking start failed: {ex.Message}");
                return new { enabled = false, detail = ex.Message };
            }
        }
        else
        {
            _duck!.Stop();
        }
        return new { enabled };
    }

    private static object VmShutdown()
    {
        lock (ServiceGate)
        {
            try { _duck?.Dispose(); } catch { }
            try { _vm?.Dispose(); } catch { }
            _duck = null;
            _vm = null;
            _cfg = null;
        }
        return new { ok = true };
    }

    private static object RouteApp(JsonElement? parms)
    {
        var endpointName = Req(parms, "endpointName");
        var pidParam = Rpc.Param<int?>(parms, "pid");
        var processName = Rpc.Param<string>(parms, "processName");

        var ep = CoreAudio.FindByName(endpointName, "render")
                 ?? CoreAudio.FindByNameContains(endpointName, "render");
        if (ep is null)
            return new { ok = false, method = "manual", detail = $"endpoint '{endpointName}' not found" };

        var candidates = new List<uint>();
        int? resolvedPid = null;
        if (!string.IsNullOrWhiteSpace(processName))
        {
            resolvedPid = CoreAudio.FindPidByProcess(processName);
            if (resolvedPid is > 0) candidates.Add((uint)resolvedPid.Value);
        }
        if (pidParam is > 0 && !candidates.Contains((uint)pidParam.Value))
            candidates.Add((uint)pidParam.Value);
        else if (pidParam == 0 && !candidates.Contains((uint)Environment.ProcessId))
            candidates.Add((uint)Environment.ProcessId);
        if (candidates.Count == 0)
            return new { ok = false, method = "manual", detail = $"No live audio-session PID found for '{processName ?? "target"}'. Start playback in the target app, then retry." };

        lock (ServiceGate)
        {
            _router ??= new AppRouter();
            if (!_router.Available)
                return new { ok = false, method = "manual", detail = _router.UnavailableReason ?? "routing API unavailable" };

            string? lastError = null;
            foreach (var pid in candidates)
            {
                try
                {
                    _router.SetAppEndpoint(pid, ep.Id);
                    return new
                    {
                        ok = true,
                        method = "api",
                        pid,
                        processName = processName ?? "current app",
                        detail = $"Audio-session owner pid {pid} → {ep.Name}"
                    };
                }
                catch (Exception ex)
                {
                    lastError = ex.Message;
                    Rpc.Log("warn", $"route pid {pid} failed: {ex.Message}");
                }
            }
            return new { ok = false, method = "manual", detail = lastError ?? "routing failed" };
        }
    }

    private static readonly string[] VirtualLinkMarkers =
    {
        "loopback", "teredo", "isatap", "vpn", "warp", "tunnel", "virtual",
        "hyper-v", "vethernet", "pseudo", "radmin", "zerotier", "wan miniport"
    };

    private static bool IsPhysicalLink(NetworkInterface nic)
    {
        if (nic.OperationalStatus != OperationalStatus.Up) return false;
        if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) return false;
        if (nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel) return false;
        var label = (nic.Name + " " + nic.Description).ToLowerInvariant();
        foreach (var marker in VirtualLinkMarkers)
            if (label.Contains(marker)) return false;
        return true;
    }

    private static object NetStats()
    {
        long received = 0;
        long sent = 0;
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (!IsPhysicalLink(nic)) continue;
            try
            {
                var stats = nic.GetIPStatistics();
                received += stats.BytesReceived;
                sent += stats.BytesSent;
            }
            catch
            {
            }
        }
        return new { receivedBytes = received, sentBytes = sent, sampledAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
    }

    private static object OpenSettings()
    {
        foreach (var uri in new[] { "ms-settings:apps-volume", "ms-settings:sound" })
        {
            try
            {
                Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
                return new { opened = uri };
            }
            catch
            {
            }
        }
        throw new InvalidOperationException("could not open Windows Settings");
    }

    private static void Cleanup()
    {
        try { _meters.Dispose(); } catch { }
        try { VmShutdown(); } catch { }
        lock (ServiceGate) { _router?.Dispose(); }
    }
}
