using System.Text.Json;
using System.Text.Json.Serialization;

namespace AudioBridge.Sidecar;

/// <summary>Newline-delimited JSON-RPC framing shared with the Electron main process.</summary>
public static class Rpc
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public sealed class Request
    {
        public long Id { get; set; }
        public string Method { get; set; } = "";
        public JsonElement? Params { get; set; }
    }

    public sealed class Response
    {
        public long Id { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public object? Result { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public RpcError? Error { get; set; }
    }

    public sealed class RpcError
    {
        public int Code { get; set; }
        public string Message { get; set; } = "";
    }

    public sealed class Event
    {
        public string Method { get; set; } = "";
        public object? Params { get; set; }
    }

    public static int MethodNotFound => -32601;
    public static int AppError => -32000;

    private static readonly object OutLock = new();

    /// <summary>Write one line to stdout. stdout carries ONLY RPC; logs go to stderr.</summary>
    public static void Write(object message)
    {
        var line = JsonSerializer.Serialize(message, message.GetType(), JsonOptions);
        lock (OutLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    public static void EmitEvent(string method, object? parms) =>
        Write(new Event { Method = method, Params = parms });

    public static void Log(string level, string message) =>
        Console.Error.WriteLine($"[{level}] {message}");

    public static T? Param<T>(JsonElement? parms, string name)
    {
        if (parms is null || parms.Value.ValueKind != JsonValueKind.Object) return default;
        if (!parms.Value.TryGetProperty(name, out var el)) return default;
        try
        {
            return el.Deserialize<T>(JsonOptions);
        }
        catch
        {
            return default;
        }
    }
}
