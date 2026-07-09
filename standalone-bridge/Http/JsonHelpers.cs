using System.Net;
using System.Text;
using System.Text.Json;

namespace StandaloneBridge.Http;

public static class JsonHelpers
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static async Task<T?> ReadBodyAsync<T>(HttpListenerRequest request)
    {
        if (!request.HasEntityBody) return default;
        using var reader = new StreamReader(request.InputStream, Encoding.UTF8);
        var body = await reader.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(body)) return default;
        return JsonSerializer.Deserialize<T>(body, Options);
    }

    public static async Task WriteJsonAsync(HttpListenerResponse response, object payload, int statusCode = 200)
    {
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Options));
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
        response.OutputStream.Close();
    }
}
