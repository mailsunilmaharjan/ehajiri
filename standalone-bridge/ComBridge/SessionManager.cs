using System.Collections.Concurrent;

namespace StandaloneBridge.ComBridge;

/// <summary>
/// One bridge process can manage many standalone devices at once; each gets
/// its own CZKEM instance (DeviceSession) keyed by the Postgres device id
/// Node passes in, but all of them share the single STA thread.
/// </summary>
public sealed class SessionManager
{
    private readonly StaDispatcher _sta = new();
    private readonly ConcurrentDictionary<int, DeviceSession> _sessions = new();

    public DeviceSession GetOrCreate(int deviceId) =>
        _sessions.GetOrAdd(deviceId, _ => new DeviceSession(_sta));
}
