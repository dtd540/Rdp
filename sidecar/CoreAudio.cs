using NAudio.CoreAudioApi;

namespace AudioBridge.Sidecar;

public sealed record AudioEndpointInfo(
    string Id,
    string Name,
    string Direction,
    bool IsDefault);

public sealed record AudioSessionInfo(
    int Pid,
    string ProcessName,
    string DisplayName,
    string State);

public sealed record AudioSessionRouteInfo(
    int Pid,
    string ProcessName,
    string EndpointId,
    string EndpointName,
    string State);

public sealed record AudioSettingsScan(
    DateTimeOffset ScannedAt,
    AudioEndpointInfo? ConsolePlayback,
    AudioEndpointInfo? DefaultPlayback,
    AudioEndpointInfo? CommunicationsPlayback,
    AudioEndpointInfo? ConsoleMicrophone,
    AudioEndpointInfo? DefaultMicrophone,
    AudioEndpointInfo? CommunicationsMicrophone,
    List<AudioEndpointInfo> PhysicalPlaybackOutputs,
    List<AudioSessionRouteInfo> SpotifySessions);

/// <summary>Endpoint + session discovery over the MMDevice API.</summary>
public static class CoreAudio
{
    public static AudioEndpointInfo? GetDefaultEndpoint(DataFlow flow, Role role)
    {
        using var enumerator = new MMDeviceEnumerator();
        try
        {
            using var endpoint = enumerator.GetDefaultAudioEndpoint(flow, role);
            return new AudioEndpointInfo(
                endpoint.ID,
                endpoint.FriendlyName,
                flow == DataFlow.Render ? "render" : "capture",
                true);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Read-only snapshot of Windows defaults and active/inactive Spotify session routes.</summary>
    public static AudioSettingsScan ScanSettings()
    {
        var endpoints = ListEndpoints();
        AudioEndpointInfo? EndpointFor(DataFlow flow, Role role)
        {
            var endpoint = GetDefaultEndpoint(flow, role);
            return endpoint is null
                ? null
                : endpoints.FirstOrDefault(e => string.Equals(e.Id, endpoint.Id, StringComparison.OrdinalIgnoreCase)) ?? endpoint;
        }

        var spotifySessions = new List<AudioSessionRouteInfo>();
        foreach (var endpoint in endpoints.Where(e => e.Direction == "render"))
        {
            try
            {
                foreach (var session in ListSessions(endpoint.Id).Where(s =>
                             string.Equals(s.ProcessName, "Spotify", StringComparison.OrdinalIgnoreCase)))
                    spotifySessions.Add(new AudioSessionRouteInfo(
                        session.Pid, session.ProcessName, endpoint.Id, endpoint.Name, session.State));
            }
            catch
            {
                // An endpoint may disappear or reject session enumeration during the scan.
            }
        }

        return new AudioSettingsScan(
            DateTimeOffset.UtcNow,
            EndpointFor(DataFlow.Render, Role.Console),
            EndpointFor(DataFlow.Render, Role.Multimedia),
            EndpointFor(DataFlow.Render, Role.Communications),
            EndpointFor(DataFlow.Capture, Role.Console),
            EndpointFor(DataFlow.Capture, Role.Multimedia),
            EndpointFor(DataFlow.Capture, Role.Communications),
            endpoints.Where(e => e.Direction == "render" && !IsVirtualRender(e.Name)).ToList(),
            spotifySessions);
    }

    public static List<AudioEndpointInfo> ListEndpoints()
    {
        using var enumerator = new MMDeviceEnumerator();
        var result = new List<AudioEndpointInfo>();

        foreach (var flow in new[] { DataFlow.Render, DataFlow.Capture })
        {
            MMDevice defaultDev;
            try
            {
                defaultDev = enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia);
            }
            catch
            {
                defaultDev = null!;
            }

            var collection = enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active);
            foreach (var dev in collection)
            {
                try
                {
                    result.Add(new AudioEndpointInfo(
                        dev.ID,
                        dev.FriendlyName,
                        flow == DataFlow.Render ? "render" : "capture",
                        defaultDev is not null && dev.ID == defaultDev.ID));
                }
                finally
                {
                    dev.Dispose();
                }
            }
            defaultDev?.Dispose();
        }
        return result;
    }

    public static AudioEndpointInfo? FindById(string id, string? direction = null) =>
        ListEndpoints().FirstOrDefault(e =>
            (direction is null || e.Direction == direction) &&
            string.Equals(e.Id, id, StringComparison.OrdinalIgnoreCase));

    public static bool DeviceNamesMatch(string first, string second)
    {
        static string Normalize(string value)
        {
            var trimmed = value.Trim();
            var colon = trimmed.IndexOf(':');
            if (colon is > 0 and < 8 && new[] { "WDM", "KS", "MME", "ASIO" }.Contains(trimmed[..colon], StringComparer.OrdinalIgnoreCase))
                trimmed = trimmed[(colon + 1)..];
            return string.Concat(trimmed.Where(char.IsLetterOrDigit)).ToLowerInvariant();
        }

        var a = Normalize(first);
        var b = Normalize(second);
        return a.Length > 0 && b.Length > 0 && a == b;
    }

    public static AudioEndpointInfo? FindRenderEndpointByDeviceName(string name)
    {
        var endpoints = ListEndpoints().Where(e => e.Direction == "render").ToList();
        var matched = endpoints.FirstOrDefault(e => DeviceNamesMatch(e.Name, name));
        if (matched is not null) return matched;

        // VoiceMeeter may prefix the selected device name with its driver type.
        var colon = name.IndexOf(':');
        if (colon is > 0 and < 8 && new[] { "WDM", "KS", "MME", "ASIO" }.Contains(name[..colon], StringComparer.OrdinalIgnoreCase))
        {
            var unprefixed = name[(colon + 1)..].Trim();
            return endpoints.FirstOrDefault(e => DeviceNamesMatch(e.Name, unprefixed));
        }
        return null;
    }

    public static AudioEndpointInfo? FindByName(string name, string? direction = null)
    {
        var n = name.Trim();
        return ListEndpoints().FirstOrDefault(e =>
            (direction is null || e.Direction == direction) &&
            string.Equals(e.Name, n, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>True for virtual playback devices, never a physical listening output.</summary>
    public static bool IsVirtualRender(string name) =>
        name.Contains("VoiceMeeter", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Virtual Audio Cable", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase) ||
        name.StartsWith("CABLE", StringComparison.OrdinalIgnoreCase);

    /// <summary>True for VoiceMeeter / VB-Cable / other virtual capture endpoints — never a real mic.</summary>
    public static bool IsVirtualCapture(string name) =>
        name.Contains("VoiceMeeter", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Virtual Audio Cable", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase) ||
        name.StartsWith("CABLE", StringComparison.OrdinalIgnoreCase);

    /// <summary>Sub-search: endpoint whose name contains the fragment (e.g. "VoiceMeeter Aux Input").</summary>
    public static AudioEndpointInfo? FindByNameContains(string fragment, string? direction = null) =>
        ListEndpoints().FirstOrDefault(e =>
            (direction is null || e.Direction == direction) &&
            e.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase));

    public static List<AudioSessionInfo> ListSessions(string endpointId)
    {
        using var enumerator = new MMDeviceEnumerator();
        using var dev = enumerator.GetDevice(endpointId);
        var mgr = dev.AudioSessionManager;
        try
        {
            mgr.RefreshSessions();
            var result = new List<AudioSessionInfo>();
            var sessions = mgr.Sessions;
            for (var i = 0; i < sessions.Count; i++)
            {
                var s = sessions[i];
                try
                {
                    int pid;
                    try
                    {
                        pid = unchecked((int)s.GetProcessID);
                    }
                    catch
                    {
                        pid = -1;
                    }

                    string procName = "system";
                    if (pid > 0)
                    {
                        try
                        {
                            procName = System.Diagnostics.Process.GetProcessById(pid).ProcessName;
                        }
                        catch
                        {
                            procName = $"pid:{pid}";
                        }
                    }

                    var state = s.State.ToString() switch
                    {
                        "AudioSessionStateActive" => "active",
                        "AudioSessionStateInactive" => "inactive",
                        _ => "expired"
                    };
                    result.Add(new AudioSessionInfo(
                        pid,
                        procName,
                        string.IsNullOrEmpty(s.DisplayName) ? procName : s.DisplayName,
                        state));
                }
                finally
                {
                    s.Dispose();
                }
            }
            return result;
        }
        finally
        {
            try { mgr.Dispose(); } catch { /* ignore */ }
        }
    }

    /// <summary>First session on the endpoint owned by the named process (name without .exe).</summary>
    public static AudioSessionInfo? FindSessionByProcess(string endpointId, string processName)
    {
        var target = processName.Trim();
        if (target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            target = target[..^4];
        var matches = ListSessions(endpointId)
            .Where(s => string.Equals(s.ProcessName, target, StringComparison.OrdinalIgnoreCase))
            .ToList();
        // A process may have multiple sessions on an endpoint; prefer a live stream
        // over an older inactive session so verification reflects actual playback/capture.
        return matches.FirstOrDefault(s => s.State == "active") ?? matches.FirstOrDefault();
    }

    /// <summary>
    /// Resolve the PID that actually owns the named process's Windows audio session.
    /// Do not fall back to an arbitrary same-named process: Spotify/Electron commonly
    /// have helper processes, and persisting a route against one of those reports
    /// success without moving the process that is rendering audio.
    /// </summary>
    public static int? FindPidByProcess(string processName)
    {
        var target = processName.Trim();
        if (target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            target = target[..^4];

        var sessions = new List<AudioSessionInfo>();
        foreach (var ep in ListEndpoints().Where(e => e.Direction == "render"))
        {
            sessions.AddRange(ListSessions(ep.Id).Where(s =>
                s.Pid > 0 && string.Equals(s.ProcessName, target, StringComparison.OrdinalIgnoreCase)));
        }

        // Prefer the session currently rendering. Inactive sessions still identify
        // the correct owner, but are a fallback when the app is paused.
        return sessions.FirstOrDefault(s => s.State == "active")?.Pid
               ?? sessions.FirstOrDefault()?.Pid;
    }
}
