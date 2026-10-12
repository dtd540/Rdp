namespace AudioBridge.Sidecar;

public sealed record AudioEndpointRoleBaseline(int Role, string? EndpointId, string? EndpointName, bool HasSavedValue);
public sealed record SpotifyRouteBaseline(int Pid, string ProcessName, List<AudioEndpointRoleBaseline> Endpoints);

public sealed record VoiceMeeterBaseline(
    int Kind,
    string MicrophoneDevice,
    string A1Output,
    string MusicEndpoint,
    int MusicStrip,
    float MicMute,
    float MicA1,
    float MicB1,
    float MicGain,
    float MusicMute,
    float MusicA1,
    float MusicB1,
    float MusicGain,
    float A1Mute,
    float B1Mute);

public sealed record AudioBaseline(
    DateTimeOffset CapturedAt,
    List<SpotifyRouteBaseline> SpotifyRoutes,
    VoiceMeeterBaseline VoiceMeeter,
    double MusicVolumeDb,
    bool MusicMutedToVrchat,
    bool DuckingEnabled);

public static class AudioBaselineManager
{
    private static readonly int[] Roles = { 0, 1, 2 };

    public static AudioBaseline Capture(
        VoiceMeeterApi api,
        VmConfig config,
        AppRouter router,
        double musicVolumeDb,
        bool musicMutedToVrchat,
        bool duckingEnabled)
    {
        if (!api.TryGetKind(out var kind, out _, out _))
            throw new InvalidOperationException("VoiceMeeter must be running to save the complete audio setup.");

        var musicEndpoint = CoreAudio.FindByNameContains("VoiceMeeter Aux Input", "render")
                            ?? CoreAudio.FindByNameContains("VoiceMeeter Input", "render")
                            ?? throw new InvalidOperationException("VoiceMeeter music input was not found.");
        var strip = VmLayout.ForKind(kind).VirtStart + (musicEndpoint.Name.Contains("Aux", StringComparison.OrdinalIgnoreCase) ? 1 : 0);
        var micDevice = RequiredString(api, "Strip[0].device.name");
        var a1Output = RequiredString(api, "Bus[0].device.name");
        var b1 = VmLayout.ForKind(kind).B1Index;
        var voiceMeeter = new VoiceMeeterBaseline(
            kind, micDevice, a1Output, musicEndpoint.Name, strip,
            RequiredFloat(api, "Strip[0].Mute"),
            RequiredFloat(api, "Strip[0].A1"),
            RequiredFloat(api, "Strip[0].B1"),
            RequiredFloat(api, "Strip[0].Gain"),
            RequiredFloat(api, $"Strip[{strip}].Mute"),
            RequiredFloat(api, $"Strip[{strip}].A1"),
            RequiredFloat(api, $"Strip[{strip}].B1"),
            (float)config.MusicGainDb,
            RequiredFloat(api, "Bus[0].Mute"),
            RequiredFloat(api, $"Bus[{b1}].Mute"));

        var endpoints = CoreAudio.ListEndpoints(force: true);
        var pids = CoreAudio.ScanSettings().SpotifySessions.Select(session => session.Pid).Where(pid => pid > 0).Distinct().ToList();
        if (pids.Count == 0)
        {
            try { pids.AddRange(System.Diagnostics.Process.GetProcessesByName("Spotify").Select(process => process.Id)); }
            catch { }
        }

        var spotifyRoutes = pids.Distinct().Select(pid => new SpotifyRouteBaseline(
            pid,
            "Spotify",
            Roles.Select(role =>
            {
                string? endpointId = null;
                var found = router.Available && router.TryGetAppEndpoint(checked((uint)pid), role, out endpointId);
                var endpointName = endpointId is null ? null : endpoints.FirstOrDefault(endpoint =>
                    string.Equals(endpoint.Id, endpointId, StringComparison.OrdinalIgnoreCase))?.Name;
                return new AudioEndpointRoleBaseline(role, found ? endpointId : null, endpointName, found);
            }).ToList())).ToList();

        return new AudioBaseline(DateTimeOffset.UtcNow, spotifyRoutes, voiceMeeter, config.UserGainDb, musicMutedToVrchat, duckingEnabled);
    }

    public static ConfigResult Restore(AudioBaseline baseline, VoiceMeeterApi api, VmConfig config, DuckingMonitor duck, AppRouter router)
    {
        var result = new ConfigResult();
        duck.Stop();

        if (!router.Available)
        {
            result.Add("spotify-routing", false, router.UnavailableReason ?? "Windows per-app audio routing is unavailable.");
            result.Finish();
            return result;
        }

        var vmResult = config.RestoreBaseline(baseline.VoiceMeeter);
        result.Steps.AddRange(vmResult.Steps);
        if (vmResult.Ok)
        {
            config.RestoreControlState(baseline.MusicVolumeDb, baseline.DuckingEnabled);
            config.ConfigureDucking(baseline.DuckingEnabled, -42, 12);
            if (baseline.DuckingEnabled)
            {
                try { duck.Start(baseline.VoiceMeeter.MicrophoneDevice); result.Add("ducking", true, "Microphone ducking restored."); }
                catch (Exception ex) { result.Add("ducking", false, ex.Message); }
            }
            else result.Add("ducking", true, "Microphone ducking remains off, as saved.");
        }

        {
            var currentPids = CoreAudio.ScanSettings().SpotifySessions.Select(session => session.Pid).Where(pid => pid > 0).Select(pid => checked((uint)pid));
            var savedPids = baseline.SpotifyRoutes.Select(route => route.Pid).Where(pid => pid > 0).Select(pid => checked((uint)pid));
            var targets = currentPids.Concat(savedPids).Distinct().ToList();
            var failures = new List<string>();
            foreach (var pid in targets)
            {
                var saved = baseline.SpotifyRoutes.FirstOrDefault(route => route.Pid == pid)
                            ?? baseline.SpotifyRoutes.FirstOrDefault();
                foreach (var role in Roles)
                {
                    var savedRole = saved?.Endpoints.FirstOrDefault(endpoint => endpoint.Role == role);
                    if (savedRole is null || !savedRole.HasSavedValue) continue;
                    var endpointId = savedRole.EndpointId;
                    try { router.SetAppEndpointRole(pid, role, endpointId); }
                    catch (Exception ex) { failures.Add($"PID {pid}, role {role}: {ex.Message}"); }
                }
            }
            result.Add("spotify-routing", failures.Count == 0,
                targets.Count == 0 ? "No Spotify audio sessions were running; per-app routing was left unchanged."
                    : failures.Count == 0 ? $"Restored Spotify's saved Windows output for {targets.Count} process(es)."
                    : string.Join(" · ", failures));
        }

        result.Finish();
        return result;
    }

    private static string RequiredString(VoiceMeeterApi api, string parameter) =>
        api.WaitForString(parameter, 4000)
            ?? throw new InvalidOperationException($"Could not read VoiceMeeter setting {parameter}. VoiceMeeter may still be starting — open it and save again.");

    private static float RequiredFloat(VoiceMeeterApi api, string parameter) =>
        api.TryGetFloat(parameter, out var value)
            ? value
            : throw new InvalidOperationException($"Could not read VoiceMeeter setting {parameter}.");
}
