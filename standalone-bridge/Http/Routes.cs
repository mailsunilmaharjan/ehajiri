using System.Net;
using StandaloneBridge.ComBridge;
using StandaloneBridge.Models;

namespace StandaloneBridge.Http;

public static class Routes
{
    public static async Task DispatchAsync(HttpListenerContext ctx, SessionManager sessions, DateTime startedAt)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        var segments = req.Url!.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        var method = req.HttpMethod;

        try
        {
            // GET /health
            if (segments.Length == 1 && segments[0] == "health" && method == "GET")
            {
                await JsonHelpers.WriteJsonAsync(res, new
                {
                    ok = true,
                    pid = Environment.ProcessId,
                    uptimeSec = (int)(DateTime.UtcNow - startedAt).TotalSeconds,
                });
                return;
            }

            // /devices/{id}/...
            if (segments.Length >= 2 && segments[0] == "devices" && int.TryParse(segments[1], out int deviceId))
            {
                var session = sessions.GetOrCreate(deviceId);
                var rest = segments.Skip(2).ToArray();
                await DispatchDeviceRouteAsync(ctx, session, rest, method);
                return;
            }

            await JsonHelpers.WriteJsonAsync(res, new ApiError { error = "Not found" }, 404);
        }
        catch (Exception ex)
        {
            await JsonHelpers.WriteJsonAsync(res, new ApiError { error = ex.Message }, 500);
        }
    }

    private static async Task DispatchDeviceRouteAsync(HttpListenerContext ctx, DeviceSession session, string[] rest, string method)
    {
        var req = ctx.Request;
        var res = ctx.Response;

        switch (rest)
        {
            case ["connect"] when method == "POST":
                {
                    var body = await JsonHelpers.ReadBodyAsync<ConnectRequest>(req) ?? new ConnectRequest();
                    await RespondAsync(res, await session.ConnectAsync(body));
                    return;
                }
            case ["disconnect"] when method == "POST":
                await RespondAsync(res, await session.DisconnectAsync());
                return;

            case ["info"] when method == "GET":
                await RespondAsync(res, await session.GetInfoAsync());
                return;

            case ["time"] when method == "GET":
                await RespondAsync(res, await session.GetTimeAsync());
                return;

            case ["time"] when method == "POST":
                {
                    var body = await JsonHelpers.ReadBodyAsync<TimeRequest>(req) ?? new TimeRequest();
                    await RespondAsync(res, await session.SetTimeAsync(body));
                    return;
                }

            case ["enable"] when method == "POST":
                {
                    var body = await JsonHelpers.ReadBodyAsync<EnableRequest>(req) ?? new EnableRequest();
                    await RespondAsync(res, await session.EnableAsync(body.enabled));
                    return;
                }

            case ["restart"] when method == "POST":
                await RespondAsync(res, await session.RestartAsync());
                return;

            case ["poweroff"] when method == "POST":
                await RespondAsync(res, await session.PowerOffAsync());
                return;

            case ["refresh"] when method == "POST":
                await RespondAsync(res, await session.RefreshAsync());
                return;

            case ["logs"] when method == "GET":
                await RespondAsync(res, await session.GetLogsAsync());
                return;

            case ["logs", "clear"] when method == "POST":
                await RespondAsync(res, await session.ClearLogsAsync());
                return;

            case ["users"] when method == "GET":
                await RespondAsync(res, await session.GetUsersAsync());
                return;

            case ["users"] when method == "POST":
                {
                    var body = await JsonHelpers.ReadBodyAsync<UserEntry>(req) ?? new UserEntry();
                    await RespondAsync(res, await session.SetUserAsync(body));
                    return;
                }

            case ["users", var enrollStr] when method == "DELETE" && int.TryParse(enrollStr, out int enrollNum1):
                await RespondAsync(res, await session.DeleteUserAsync(enrollNum1));
                return;

            case ["users", var enrollStr2, "fingerprints", var fingerStr]
                when int.TryParse(enrollStr2, out int enrollNum2) && int.TryParse(fingerStr, out int fingerIdx):
                {
                    if (method == "GET")
                    {
                        await RespondAsync(res, await session.GetFingerprintAsync(enrollNum2, fingerIdx));
                        return;
                    }
                    if (method == "POST")
                    {
                        var body = await JsonHelpers.ReadBodyAsync<FingerprintTemplate>(req) ?? new FingerprintTemplate();
                        await RespondAsync(res, await session.SetFingerprintAsync(enrollNum2, fingerIdx, body.templateData));
                        return;
                    }
                    if (method == "DELETE")
                    {
                        await RespondAsync(res, await session.DeleteFingerprintAsync(enrollNum2, fingerIdx));
                        return;
                    }
                    break;
                }

            case ["clear-admin"] when method == "POST":
                await RespondAsync(res, await session.ClearAdminAsync());
                return;

            case ["users", "clear-all"] when method == "POST":
                await RespondAsync(res, await session.ClearAllUsersAsync());
                return;

            case ["backup"] when method == "POST":
                {
                    var body = await JsonHelpers.ReadBodyAsync<BackupRequest>(req) ?? new BackupRequest();
                    var fileName = body.fileName ?? $"backup-{DateTime.Now:yyyyMMdd-HHmmss}.dat";
                    var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "eHajiri", "standalone-backups");
                    Directory.CreateDirectory(dir);
                    await RespondAsync(res, await session.BackupDeviceAsync(Path.Combine(dir, fileName)));
                    return;
                }

            case ["users", var enrollStr3, "biometrics"] when method == "GET" && int.TryParse(enrollStr3, out int enrollNum3):
                await RespondAsync(res, await session.GetUserBiometricsAsync(enrollNum3));
                return;

            case ["users", var enrollStr4, "face", var faceStr]
                when int.TryParse(enrollStr4, out int enrollNum4) && int.TryParse(faceStr, out int faceIdx):
                {
                    if (method == "GET")
                    {
                        await RespondAsync(res, await session.GetFaceAsync(enrollNum4, faceIdx));
                        return;
                    }
                    if (method == "POST")
                    {
                        var body = await JsonHelpers.ReadBodyAsync<FaceTemplate>(req) ?? new FaceTemplate();
                        await RespondAsync(res, await session.SetFaceAsync(enrollNum4, faceIdx, body.templateData));
                        return;
                    }
                    if (method == "DELETE")
                    {
                        await RespondAsync(res, await session.DeleteFaceAsync(enrollNum4, faceIdx));
                        return;
                    }
                    break;
                }

            case ["timezones", var tzIdxStr] when int.TryParse(tzIdxStr, out int tzIdx):
                {
                    if (method == "POST")
                    {
                        var body = await JsonHelpers.ReadBodyAsync<TimeZoneRequest>(req) ?? new TimeZoneRequest();
                        await RespondAsync(res, await session.SetTimeZoneAsync(tzIdx, body.tz));
                        return;
                    }
                    if (method == "GET")
                    {
                        await RespondAsync(res, await session.GetTimeZoneAsync(tzIdx));
                        return;
                    }
                    break;
                }

            case ["groups", var groupStr, "timezone"] when method == "POST" && int.TryParse(groupStr, out int groupNo):
                {
                    var body = await JsonHelpers.ReadBodyAsync<GroupTimeZoneRequest>(req) ?? new GroupTimeZoneRequest();
                    await RespondAsync(res, await session.SetGroupTimeZoneAsync(groupNo, body.tzIndex));
                    return;
                }

            case ["users", var enrollStr5, "group"] when method == "POST" && int.TryParse(enrollStr5, out int enrollNum5):
                {
                    var body = await JsonHelpers.ReadBodyAsync<UserGroupRequest>(req) ?? new UserGroupRequest();
                    await RespondAsync(res, await session.SetUserGroupAsync(enrollNum5, body.groupNo));
                    return;
                }

            case ["command"] when method == "POST":
                {
                    var body = await JsonHelpers.ReadBodyAsync<CommandRequest>(req) ?? new CommandRequest();
                    await RespondAsync(res, await session.InvokeCommandAsync(body.method, body.args));
                    return;
                }
        }

        await JsonHelpers.WriteJsonAsync(res, new ApiError { error = "Not found" }, 404);
    }

    private static async Task RespondAsync<T>(HttpListenerResponse res, ZkResult<T> result) =>
        await JsonHelpers.WriteJsonAsync(res, result, result.ok ? 200 : 502);
}
