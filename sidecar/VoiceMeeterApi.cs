using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace AudioBridge.Sidecar;

public sealed class VoiceMeeterApi : IDisposable
{

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Login", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_Login();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Logout", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_Logout();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_RunVoicemeeter", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_RunVoicemeeter(long type);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_GetVoicemeeterType", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_GetVoicemeeterType(out int type);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_GetVoicemeeterVersion", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_GetVoicemeeterVersion(out int ver);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_IsParametersDirty", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_IsParametersDirty();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_SetParameterFloat", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_SetParameterFloat(string param, float value);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_GetParameterFloat", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_GetParameterFloat(string param, out float value);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_SetParameterStringA", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_SetParameterStringA(string param, string value);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_GetParameterStringA", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_GetParameterStringA(string param, byte[] buffer);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Input_GetDeviceNumber", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_Input_GetDeviceNumber();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Input_GetDeviceDescA", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_Input_GetDeviceDescA(long index, ref int type, byte[] name, byte[] hardwareId);

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Output_GetDeviceNumber", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_Output_GetDeviceNumber();

    [DllImport("VoicemeeterRemote64.dll", EntryPoint = "VBVMR_Output_GetDeviceDescA", CharSet = CharSet.Ansi, ExactSpelling = true)]
    private static extern int VBVMR_Output_GetDeviceDescA(long index, ref int type, byte[] name, byte[] hardwareId);

    private static readonly object ResolverGate = new();
    private static string? _resolvedDll;
    private static bool _resolverInstalled;

    public static string? DiscoverDll()
    {
        var dllName = Environment.Is64BitProcess ? "VoicemeeterRemote64.dll" : "VoicemeeterRemote.dll";

        foreach (var env in new[] { "ProgramFiles(x86)", "ProgramFiles", "ProgramW6432" })
        {
            var pf = Environment.GetEnvironmentVariable(env);
            if (string.IsNullOrWhiteSpace(pf)) continue;
            var dir = Path.Combine(pf, "VB", "Voicemeeter");
            var candidate = Path.Combine(dir, dllName);
            if (File.Exists(candidate)) return candidate;
        }

        foreach (var tail in new[]
                     {
                         @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}",
                         @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}"
                     })
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(tail);
                var uninstall = key?.GetValue("UninstallString") as string;
                if (string.IsNullOrWhiteSpace(uninstall)) continue;
                var dir = Path.GetDirectoryName(uninstall.Trim('"'));
                if (dir is null) continue;
                var candidate = Path.Combine(dir, dllName);
                if (File.Exists(candidate)) return candidate;
            }
            catch
            {
            }
        }
        return null;
    }

    private static void EnsureResolver()
    {
        lock (ResolverGate)
        {
            if (_resolverInstalled) return;
            var dll = DiscoverDll() ?? throw new FileNotFoundException("VoiceMeeter remote API DLL not found");
            _resolvedDll = dll;
            NativeLibrary.SetDllImportResolver(typeof(VoiceMeeterApi).Assembly, (name, asm, path) =>
            {
                if (!name.Equals("VoicemeeterRemote64.dll", StringComparison.OrdinalIgnoreCase) &&
                    !name.Equals("VoicemeeterRemote.dll", StringComparison.OrdinalIgnoreCase))
                    return IntPtr.Zero;
                return NativeLibrary.Load(_resolvedDll);
            });
            _resolverInstalled = true;
        }
    }

    public static bool IsInstalled => DiscoverDll() is not null;
    public static string? DllPath => DiscoverDll();

    public static string? ProgramFolder
    {
        get
        {
            var dll = DiscoverDll();
            return dll is null ? null : Path.GetDirectoryName(dll);
        }
    }

    private readonly object _gate = new();
    private bool _loggedIn;

    private void EnsureLogin()
    {
        lock (_gate)
        {
            if (_loggedIn) return;
            EnsureResolver();
            var rc = VBVMR_Login();
            if (rc == -1) throw new InvalidOperationException("VoiceMeeter API: cannot get client (unexpected)");
            if (rc == -2) { _loggedIn = true; return; }
            if (rc < 0) throw new InvalidOperationException($"VoiceMeeter API login failed: {rc}");
            _loggedIn = true;
        }
    }

    public bool TryGetKind(out int kind, out string kindName, out int version)
    {
        kind = 0; kindName = ""; version = 0;
        try
        {
            EnsureLogin();
        }
        catch
        {
            return false;
        }
        lock (_gate)
        {
            if (VBVMR_GetVoicemeeterType(out var k) != 0) return false;
            if (VBVMR_GetVoicemeeterVersion(out var v) != 0) v = 0;
            kind = k;
            kindName = k switch { 1 => "Voicemeeter", 2 => "Banana", 3 => "Potato", _ => $"Unknown({k})" };
            version = v;
            return true;
        }
    }

    public bool WaitForEngine(int timeoutMs = 8000)
    {
        var deadline = Environment.TickCount64 + timeoutMs;
        while (Environment.TickCount64 < deadline)
        {
            if (TryGetKind(out _, out _, out _)) return true;
            Thread.Sleep(150);
        }
        return false;
    }

    public void Launch()
    {
        EnsureLogin();
        var folder = ProgramFolder ?? throw new InvalidOperationException("VoiceMeeter folder not found");
        var exe = Directory.EnumerateFiles(folder, "Voicemeeter*.exe")
            .Where(f => !f.Contains("Setup", StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f)
            .FirstOrDefault()
            ?? throw new FileNotFoundException("Voicemeeter executable not found in " + folder);

        if (System.Diagnostics.Process.GetProcessesByName("Voicemeeter").Length > 0) return;

        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(exe)
        {
            WorkingDirectory = folder,
            UseShellExecute = true
        });

        if (!WaitForEngine())
        {
            foreach (var type in new long[] { 6, 5, 4 })
            {
                try
                {
                    if (VBVMR_RunVoicemeeter(type) == 0 && WaitForEngine(5000)) return;
                }
                catch
                {
                }
            }
            throw new InvalidOperationException("VoiceMeeter did not start (engine not responding)");
        }
    }

    private void SleepForDirtyCycle() => Thread.Sleep(30);

    private void WaitUntilClean()
    {
        var deadline = Environment.TickCount64 + 1000;
        while (Environment.TickCount64 < deadline)
        {
            int rc;
            try { rc = VBVMR_IsParametersDirty(); } catch { return; }
            if (rc != 1) return;
            Thread.Sleep(2);
        }
    }

    public float GetFloat(string param)
    {
        EnsureLogin();
        lock (_gate)
        {
            SleepForDirtyCycle();
            WaitUntilClean();
            var rc = VBVMR_GetParameterFloat(param, out var v);
            if (rc != 0) throw new InvalidOperationException($"Get {param} failed: {rc}");
            return v;
        }
    }

    public bool TryGetFloat(string param, out float value)
    {
        value = 0;
        try { value = GetFloat(param); return true; } catch { return false; }
    }

    public void SetFloat(string param, float value)
    {
        EnsureLogin();
        lock (_gate)
        {
            SleepForDirtyCycle();
            var rc = VBVMR_SetParameterFloat(param, value);
            if (rc != 0) throw new InvalidOperationException($"Set {param}={value} failed: {rc}");
        }
    }

    public bool TrySetFloat(string param, float value)
    {
        try { SetFloat(param, value); return true; } catch { return false; }
    }

    public string GetString(string param)
    {
        EnsureLogin();
        lock (_gate)
        {
            SleepForDirtyCycle();
            WaitUntilClean();
            var buff = new byte[512];
            var rc = VBVMR_GetParameterStringA(param, buff);
            if (rc != 0) throw new InvalidOperationException($"Get {param} failed: {rc}");
            var end = Array.IndexOf(buff, (byte)0);
            return System.Text.Encoding.ASCII.GetString(buff, 0, end < 0 ? buff.Length : end);
        }
    }

    public bool TryGetString(string param, out string value)
    {
        value = "";
        try { value = GetString(param); return true; } catch { return false; }
    }

    public void SetString(string param, string value)
    {
        EnsureLogin();
        lock (_gate)
        {
            SleepForDirtyCycle();
            var rc = VBVMR_SetParameterStringA(param, value);
            if (rc != 0) throw new InvalidOperationException($"Set {param} failed: {rc}");
        }
    }

    private static string DriverNameFor(int driver) => driver switch
    {
        1 => "mme",
        4 => "wdm",
        8 => "ks",
        256 => "asio",
        _ => $"drv{driver}"
    };

    public sealed record VmInputDevice(int Index, int Driver, string Name, string HardwareId)
    {
        public string DriverName => DriverNameFor(Driver);
    }

    public sealed record VmOutputDevice(int Index, int Driver, string Name, string HardwareId)
    {
        public string DriverName => DriverNameFor(Driver);
    }

    private static string DecodeDeviceText(byte[] bytes)
    {
        var end = Array.IndexOf(bytes, (byte)0);
        return System.Text.Encoding.ASCII.GetString(bytes, 0, end < 0 ? bytes.Length : end);
    }

    public List<VmOutputDevice> ListOutputDevices()
    {
        EnsureLogin();
        lock (_gate)
        {
            var count = VBVMR_Output_GetDeviceNumber();
            var result = new List<VmOutputDevice>();
            for (long i = 0; i < count; i++)
            {
                var type = 0;
                var name = new byte[512];
                var hardwareId = new byte[512];
                if (VBVMR_Output_GetDeviceDescA(i, ref type, name, hardwareId) == 0)
                    result.Add(new VmOutputDevice((int)i, type, DecodeDeviceText(name), DecodeDeviceText(hardwareId)));
            }
            return result;
        }
    }

    public List<VmInputDevice> ListInputDevices()
    {
        EnsureLogin();
        lock (_gate)
        {
            var count = VBVMR_Input_GetDeviceNumber();
            var result = new List<VmInputDevice>();
            if (count <= 0) return result;
            for (long i = 0; i < count; i++)
            {
                var type = 0;
                var name = new byte[512];
                var hw = new byte[512];
                if (VBVMR_Input_GetDeviceDescA(i, ref type, name, hw) != 0) continue;
                result.Add(new VmInputDevice((int)i, type, DecodeDeviceText(name), DecodeDeviceText(hw)));
            }
            return result;
        }
    }

    public static string FormatVersion(int v) =>
        $"{(v >> 24) & 0xFF}.{(v >> 16) & 0xFF}.{(v >> 8) & 0xFF}.{v & 0xFF}";

    public void Logout()
    {
        lock (_gate)
        {
            if (!_loggedIn) return;
            try { VBVMR_Logout(); } catch { }
            _loggedIn = false;
        }
    }

    public void Dispose() => Logout();

    private static readonly Assembly ThisAsm = typeof(VoiceMeeterApi).Assembly;
}
