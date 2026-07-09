namespace StandaloneBridge.ComBridge;

public sealed class ZkResult<T>
{
    public bool ok { get; private init; }
    public T? data { get; private init; }
    public string? error { get; private init; }
    public int? errorCode { get; private init; }

    public static ZkResult<T> Success(T data) => new() { ok = true, data = data };

    public static ZkResult<T> Failure(string error, int errorCode) =>
        new() { ok = false, error = error, errorCode = errorCode };
}
