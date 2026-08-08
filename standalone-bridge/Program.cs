// StandAlone SDK code (legacy ZKTeco zkemkeeper.dll COM control) — DISABLED
// BY DEFAULT on the Node side. This process is only ever spawned by
// server/services/standaloneBridgeLauncher.js, which is itself gated behind
// FLAG_KEYS.standaloneDevice (default OFF — Settings -> Role Management ->
// Module Controls). On a fresh install this .exe never even starts.
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using StandaloneBridge.ComBridge;
using StandaloneBridge.Http;
using StandaloneBridge.Sync;

// Remote-sync mode: a config file dropped next to this exe (see
// Sync/RemoteSyncAgent.cs) means it's running standalone at a site, holding
// the device connection itself and pushing logs out over the network,
// instead of the default HTTP-server mode below (which the Electron-spawned
// copy of this same exe uses so the co-located Node server can pull from it
// over loopback). Checked first and never falls through — the two modes are
// mutually exclusive for a given install.
var syncConfigPath = Path.Combine(AppContext.BaseDirectory, "sync-config.json");
if (File.Exists(syncConfigPath))
{
    var config = JsonSerializer.Deserialize<SyncAgentConfig>(File.ReadAllText(syncConfigPath))
        ?? throw new InvalidOperationException("sync-config.json is empty or invalid");
    await RemoteSyncAgent.RunAsync(config);
    return;
}

var startedAt = DateTime.UtcNow;
var sessions = new SessionManager();

int port = PickFreePort();

var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{port}/");
listener.Start();

WritePortFile(port);
Console.WriteLine($"[StandaloneBridge] listening on http://127.0.0.1:{port} (pid {Environment.ProcessId})");

Console.CancelKeyPress += (_, _) => listener.Stop();
AppDomain.CurrentDomain.ProcessExit += (_, _) => listener.Stop();

while (listener.IsListening)
{
    HttpListenerContext ctx;
    try
    {
        ctx = await listener.GetContextAsync();
    }
    catch (HttpListenerException)
    {
        break; // listener was stopped
    }

    _ = Routes.DispatchAsync(ctx, sessions, startedAt).ContinueWith(t =>
    {
        if (t.Exception != null)
            Console.Error.WriteLine($"[StandaloneBridge] request error: {t.Exception.Message}");
    });
}

static int PickFreePort()
{
    var tmp = new TcpListener(IPAddress.Loopback, 0);
    tmp.Start();
    int port = ((IPEndPoint)tmp.LocalEndpoint).Port;
    tmp.Stop();
    return port;
}

static void WritePortFile(int port)
{
    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "eHajiri");
    Directory.CreateDirectory(dir);
    var path = Path.Combine(dir, "standalone-bridge-port.json");
    var json = JsonSerializer.Serialize(new { port, pid = Environment.ProcessId });
    File.WriteAllText(path, json);
}
