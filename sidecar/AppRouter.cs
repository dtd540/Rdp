using System.Runtime.InteropServices;

namespace AudioBridge.Sidecar;

public sealed class AppRouter : IDisposable
{
    private const int PtrSize = 8;
    private const int SetSlot = 25;
    private const int GetSlot = 26;

    private static readonly Guid IidPreH1H2 = new("2a59116d-6c4f-45e0-a74f-707e3fef9258");
    private static readonly Guid IidH1H2 = new("ab3d4648-e242-459f-b02f-541c70306324");
    private static readonly Guid Iid16299 = new("32aa8e18-6496-4e24-9f94-b800e7eccc45");

    private static readonly Guid[] KnownIids = { IidPreH1H2, IidH1H2, Iid16299 };

    private const int S_OK = 0;

    [DllImport("api-ms-win-core-winrt-string-l1-1-0.dll", CharSet = CharSet.Unicode)]
    private static extern int WindowsCreateString(string source, int length, out IntPtr hstring);

    [DllImport("api-ms-win-core-winrt-string-l1-1-0.dll")]
    private static extern int WindowsDeleteString(IntPtr hstring);

    [DllImport("api-ms-win-core-winrt-string-l1-1-0.dll")]
    private static extern IntPtr WindowsGetStringRawBuffer(IntPtr hstring, out uint length);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetPersistedDelegate(IntPtr self, uint pid, int flow, int role, IntPtr deviceIdHstring);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetPersistedDelegate(IntPtr self, uint pid, int flow, int role, out IntPtr deviceIdHstring);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int QueryInterfaceDelegate(IntPtr self, ref Guid iid, out IntPtr obj);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetIidsDelegate(IntPtr self, IntPtr count, ref IntPtr iids);

    private IntPtr _iface;
    private bool _available;
    private string? _unavailableReason;

    public bool Available => _available;
    public string? UnavailableReason => _unavailableReason;

    public AppRouter()
    {
        try
        {
            Initialize();
        }
        catch (Exception ex)
        {
            _available = false;
            _unavailableReason = ex.Message;
            Rpc.Log("error", "AppRouter init failed: " + ex);
        }
    }

    private void Initialize()
    {
        var audioSes = NativeLibrary.Load("AudioSes.dll");
        if (!NativeLibrary.TryGetExport(audioSes, "DllGetActivationFactory", out var factoryAddr))
        {
            _unavailableReason = "AudioSes.dll does not export DllGetActivationFactory";
            return;
        }
        var getFactory = Marshal.GetDelegateForFunctionPointer<DllGetActivationFactoryDelegate>(factoryAddr);

        const string classNameStr = "Windows.Media.Internal.AudioPolicyConfig";
        if (WindowsCreateString(classNameStr, classNameStr.Length, out var className) != S_OK)
        {
            _unavailableReason = "WindowsCreateString failed";
            return;
        }
        IntPtr factory;
        int hr;
        try
        {
            hr = getFactory(className, out factory);
        }
        finally
        {
            WindowsDeleteString(className);
        }
        if (hr != S_OK || factory == IntPtr.Zero)
        {
            _unavailableReason = $"DllGetActivationFactory failed: 0x{hr:X8}";
            return;
        }

        var vtable = Marshal.ReadIntPtr(factory);
        var qiPtr = Marshal.ReadIntPtr(vtable, 0);
        var qi = Marshal.GetDelegateForFunctionPointer<QueryInterfaceDelegate>(qiPtr);

        var getIidsPtr = Marshal.ReadIntPtr(vtable, 8 * 3);
        var getIids = Marshal.GetDelegateForFunctionPointer<GetIidsDelegate>(getIidsPtr);

        IntPtr countBuf = IntPtr.Zero, iidsOut = IntPtr.Zero, iidsAlloc = IntPtr.Zero;
        try
        {
            countBuf = Marshal.AllocHGlobal(8);
            iidsAlloc = Marshal.AllocHGlobal(8);
            iidsOut = iidsAlloc;
            Marshal.WriteInt64(countBuf, 0);
            Marshal.WriteInt64(iidsAlloc, 0);
            hr = getIids(factory, countBuf, ref iidsOut);
            if (hr != S_OK)
            {
                _unavailableReason = $"IInspectable.GetIids failed: 0x{hr:X8}";
                return;
            }
            var total = Marshal.ReadInt32(countBuf);
            var arr = iidsOut;
            Rpc.Log("info", $"GetIids total={total} arr=0x{arr.ToInt64():X16}");
            if (total <= 0 || arr == IntPtr.Zero || arr.ToInt64() < 0x10000)
            {
                _unavailableReason = $"AudioPolicyConfig reports no usable IIDs (total={total})";
                return;
            }
            var lastPtr = arr + 16 * (total - 1);
            var bytes = new byte[16];
            Marshal.Copy(lastPtr, bytes, 0, 16);
            var reported = new Guid(bytes);
            Rpc.Log("info", $"AudioPolicyConfig reports {total} IIDs; last = {reported:B}" +
                            (Array.IndexOf(KnownIids, reported) >= 0 ? " (known)" : " (UNKNOWN — trying anyway)"));

            hr = qi(factory, ref reported, out _iface);
            if (hr != S_OK || _iface == IntPtr.Zero)
            {
                foreach (var candidate in new[] { IidH1H2, IidPreH1H2, Iid16299 })
                {
                    if (candidate == reported) continue;
                    var tmp = candidate;
                    hr = qi(factory, ref tmp, out _iface);
                    if (hr == S_OK && _iface != IntPtr.Zero)
                    {
                        Rpc.Log("info", $"AudioPolicyConfig fallback QI succeeded with {candidate:B}");
                        break;
                    }
                }
            }
            if (hr != S_OK || _iface == IntPtr.Zero)
            {
                _unavailableReason = $"AudioPolicyConfig QI failed on this Windows build: 0x{hr:X8}";
                return;
            }
        }
        finally
        {
            if (countBuf != IntPtr.Zero) Marshal.FreeHGlobal(countBuf);
            if (iidsAlloc != IntPtr.Zero) Marshal.FreeHGlobal(iidsAlloc);
            Marshal.Release(factory);
        }
        _available = true;
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int DllGetActivationFactoryDelegate(IntPtr hstring, out IntPtr factory);

    private const int ERender = 0;

    private const string MmdevapiToken = @"\\?\SWD#MMDEVAPI#";
    private const string DevInterfaceRender = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
    private const string DevInterfaceCapture = "#{2eef81be-33fa-4800-9670-1cd474972c3f}";

    private static string ToDevicePath(string endpointId, int flow) =>
        endpointId.StartsWith(MmdevapiToken, StringComparison.OrdinalIgnoreCase)
            ? endpointId
            : MmdevapiToken + endpointId + (flow == ERender ? DevInterfaceRender : DevInterfaceCapture);

    private static string UnpackDevicePath(string path)
    {
        var s = path;
        if (s.StartsWith(MmdevapiToken, StringComparison.OrdinalIgnoreCase))
            s = s[MmdevapiToken.Length..];
        if (s.EndsWith(DevInterfaceRender, StringComparison.OrdinalIgnoreCase))
            s = s[..^DevInterfaceRender.Length];
        else if (s.EndsWith(DevInterfaceCapture, StringComparison.OrdinalIgnoreCase))
            s = s[..^DevInterfaceCapture.Length];
        return s;
    }

    public void SetAppEndpoint(uint pid, string endpointId)
    {
        if (!_available) throw new InvalidOperationException(_unavailableReason ?? "routing API unavailable");

        var vtable = Marshal.ReadIntPtr(_iface);
        var setPtr = Marshal.ReadIntPtr(vtable, PtrSize * SetSlot);
        var set = Marshal.GetDelegateForFunctionPointer<SetPersistedDelegate>(setPtr);

        var devicePath = ToDevicePath(endpointId, ERender);
        if (WindowsCreateString(devicePath, devicePath.Length, out var hs) != S_OK)
            throw new InvalidOperationException("WindowsCreateString(endpointId) failed");

        int hr;
        try
        {
            hr = S_OK;
            foreach (var role in new[] { 0, 1, 2 })
            {
                hr = set(_iface, pid, ERender, role, hs);
                if (hr != S_OK) break;
            }
        }
        finally
        {
            WindowsDeleteString(hs);
        }

        var readBack = TryGetAppEndpoint(pid, out var got);
        if (readBack)
        {
            var gotId = got == null ? null : UnpackDevicePath(got);
            if (string.Equals(gotId, endpointId, StringComparison.OrdinalIgnoreCase)) return;
            throw new InvalidOperationException(
                $"persisted endpoint mismatch (got '{got ?? "null"}', want '{endpointId}')");
        }
        if (hr != S_OK)
            throw new InvalidOperationException($"SetPersistedDefaultAudioEndpoint failed: 0x{hr:X8}");
    }

    public bool TryGetAppEndpoint(uint pid, out string? endpointId)
    {
        endpointId = null;
        if (!_available) return false;
        var vtable = Marshal.ReadIntPtr(_iface);
        var getPtr = Marshal.ReadIntPtr(vtable, PtrSize * GetSlot);
        var get = Marshal.GetDelegateForFunctionPointer<GetPersistedDelegate>(getPtr);
        var hr = get(_iface, pid, ERender, 1, out var hs);
        if (hr != S_OK || hs == IntPtr.Zero) return false;
        try
        {
            var buf = WindowsGetStringRawBuffer(hs, out var len);
            endpointId = len == 0 ? null : Marshal.PtrToStringUni(buf, (int)len);
            return true;
        }
        finally
        {
            WindowsDeleteString(hs);
        }
    }

    public void Dispose()
    {
        if (_iface != IntPtr.Zero)
        {
            try { Marshal.Release(_iface); } catch { }
            _iface = IntPtr.Zero;
        }
    }
}
