using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using StandaloneBridge.ComBridge;
using StandaloneBridge.Http;

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
