using System.Net.Http.Headers;
using System.Net.Http.Json;
using StandaloneBridge.ComBridge;
using StandaloneBridge.Models;

namespace StandaloneBridge.Sync;

/// <summary>
/// Remote-sync mode — selected by Program.cs when a sync-config.json sits
/// next to the exe (see that file). Unlike the default HTTP-server mode
/// (used by the Electron-spawned bridge, where the co-located Node server
/// calls in over loopback — see standaloneDeviceService.js), this mode holds
/// the device connection itself and pushes fetched logs OUT to a eHajiri
/// server's /api/standalone-sync/logs, since that server (possibly hosted
/// centrally, per CLAUDE.md) may have no network path back to this machine
/// at all — this machine only needs outbound HTTPS to reach it.
///
/// One DeviceSession, one device, run forever — this exe is meant to be one
/// instance per site/device, not a multi-device manager like SessionManager.
/// </summary>
public static class RemoteSyncAgent
{
    public static async Task RunAsync(SyncAgentConfig config)
    {
        var sta     = new StaDispatcher();
        var session = new DeviceSession(sta);
        using var http = new HttpClient { BaseAddress = new Uri(config.serverUrl) };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.syncToken);

        var pollDelay = TimeSpan.FromSeconds(Math.Max(config.pollIntervalSec, 10));
        string? serialNumber = null;

        Log($"Remote sync agent starting — device {config.deviceIp}:{config.devicePort} -> {config.serverUrl}");

        while (true)
        {
            try
            {
                if (!session.IsConnected)
                {
                    var connect = await session.ConnectAsync(new ConnectRequest
                    {
                        ip = config.deviceIp, port = config.devicePort, password = config.commPassword,
                    });
                    if (!connect.ok)
                    {
                        Log($"Connect failed: {connect.error}");
                        await Task.Delay(pollDelay);
                        continue;
                    }
                    Log("Connected to device");
                }

                if (serialNumber == null)
                {
                    var info = await session.GetInfoAsync();
                    if (info.ok) serialNumber = info.data?.serialNumber;
                }

                var logs = await session.GetLogsAsync();
                if (!logs.ok)
                {
                    Log($"GetLogs failed: {logs.error}");
                }
                else
                {
                    // Same "implausible year" defensiveness as the local pull path
                    // (standaloneAttendanceSync.js) — a device whose clock was never
                    // set can report garbage dates for old buffer entries; skip just
                    // those rather than failing the whole batch.
                    var records = new List<object>();
                    foreach (var l in logs.data!)
                    {
                        DateTime checkTime;
                        try { checkTime = new DateTime(l.year, l.month, l.day, l.hour, l.minute, l.second); }
                        catch { continue; }
                        records.Add(new
                        {
                            pin        = l.enrollNumber.ToString(),
                            checkTime  = checkTime.ToString("yyyy-MM-ddTHH:mm:ss"),
                            checkType  = l.inOutMode,
                            verifyType = l.verifyMode,
                            workCode   = l.workCode,
                        });
                    }

                    if (records.Count > 0)
                    {
                        var resp = await http.PostAsJsonAsync("/api/standalone-sync/logs", new { serialNumber, records });
                        var body = await resp.Content.ReadAsStringAsync();
                        Log(resp.IsSuccessStatusCode
                            ? $"Synced {records.Count} log(s) — {body}"
                            : $"Server rejected sync ({(int)resp.StatusCode}): {body}");
                    }
                }
            }
            catch (Exception ex)
            {
                // Never let a device hiccup or network blip kill the loop — retry next tick.
                Log($"Cycle error: {ex.Message}");
            }

            await Task.Delay(pollDelay);
        }
    }

    private static void Log(string message)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}";
        Console.WriteLine(line);
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "eHajiri");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "sync-agent.log"), line + Environment.NewLine);
        }
        catch { /* logging must never crash the loop */ }
    }
}
