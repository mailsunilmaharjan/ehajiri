namespace StandaloneBridge.Sync;

/// <summary>
/// sync-config.json — dropped next to StandaloneBridge.exe at a remote site
/// to switch it into remote-sync mode (see RemoteSyncAgent). Generated from
/// Settings → StandAlone Device → "Generate Sync Token" in the eHajiri UI
/// (server/routes/standaloneDevices.js's POST /devices/:id/sync-token).
/// </summary>
public sealed class SyncAgentConfig
{
    public string deviceIp { get; set; } = "";
    public int devicePort { get; set; } = 4370;
    public string? commPassword { get; set; }
    public string serverUrl { get; set; } = "";
    public string syncToken { get; set; } = "";
    public int pollIntervalSec { get; set; } = 60;
}
