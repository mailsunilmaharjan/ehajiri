using System.Reflection;
using System.Text.Json;
using zkemkeeper;

namespace StandaloneBridge.ComBridge;

/// <summary>
/// Reflective by-name invoker for the long tail of IZKEM methods that don't
/// have a dedicated bridge endpoint (LCD, voice, work codes, daylight saving,
/// holidays, comm password, etc). Lets the frontend's generic "Send Command"
/// control reach any SDK method without a code change here.
/// </summary>
public static class ComMethodInvoker
{
    public static object? Invoke(CZKEM zk, string methodName, object?[] jsonArgs, int defaultMachineNumber)
    {
        var method = typeof(IZKEM).GetMethods()
            .FirstOrDefault(m => string.Equals(m.Name, methodName, StringComparison.OrdinalIgnoreCase));

        if (method is null)
            throw new InvalidOperationException($"Unknown CZKEM method: {methodName}");

        var parameters = method.GetParameters();
        var callArgs = new object?[parameters.Length];

        for (int i = 0; i < parameters.Length; i++)
        {
            var paramType = parameters[i].ParameterType;
            var elementType = paramType.IsByRef ? paramType.GetElementType()! : paramType;

            if (i < jsonArgs.Length && jsonArgs[i] is not null)
            {
                callArgs[i] = Coerce(jsonArgs[i], elementType);
            }
            else if (parameters[i].IsOut || paramType.IsByRef)
            {
                // No value supplied for an out/ref slot — default it so Invoke has something to write into.
                callArgs[i] = elementType == typeof(string) ? "" : Activator.CreateInstance(elementType);
            }
            else if (parameters[i].Name is "dwMachineNumber" or "MachineNumber")
            {
                callArgs[i] = defaultMachineNumber;
            }
            else
            {
                callArgs[i] = elementType == typeof(string) ? "" : Activator.CreateInstance(elementType);
            }
        }

        var returnValue = method.Invoke(zk, callArgs);

        // Surface any by-ref/out values alongside the return value so the
        // caller can see e.g. GetDeviceTime's ref params, not just `true`.
        var outputs = new Dictionary<string, object?>();
        for (int i = 0; i < parameters.Length; i++)
        {
            if (parameters[i].ParameterType.IsByRef || parameters[i].IsOut)
            {
                outputs[parameters[i].Name ?? $"arg{i}"] = callArgs[i];
            }
        }

        return new { returnValue, outputs };
    }

    private static object? Coerce(object? rawValue, Type targetType)
    {
        if (rawValue is JsonElement el)
        {
            if (targetType == typeof(string)) return el.GetString() ?? "";
            if (targetType == typeof(int)) return el.GetInt32();
            if (targetType == typeof(bool)) return el.GetBoolean();
            if (targetType == typeof(double)) return el.GetDouble();
            return el.GetRawText();
        }
        return Convert.ChangeType(rawValue, targetType);
    }
}
