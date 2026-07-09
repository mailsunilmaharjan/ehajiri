namespace StandaloneBridge.Models;

public sealed class ApiError
{
    public bool ok { get; init; } = false;
    public string error { get; init; } = "";
    public int? errorCode { get; init; }
}

public sealed class ConnectRequest
{
    public string ip { get; set; } = "";
    public int port { get; set; } = 4370;
    public string? password { get; set; }
}

public sealed class DeviceInfo
{
    public string serialNumber { get; set; } = "";
    public string firmwareVersion { get; set; } = "";
    public string productCode { get; set; } = "";
    public string deviceIp { get; set; } = "";
    public string deviceMac { get; set; } = "";
    public string vendor { get; set; } = "";
    public string platform { get; set; } = "";
}

public sealed class TimeRequest
{
    public string? time { get; set; } // "yyyy-MM-dd HH:mm:ss"; omit = sync to now
}

public sealed class EnableRequest
{
    public bool enabled { get; set; }
}

public sealed class AttLogEntry
{
    public int enrollNumber { get; set; }
    public int verifyMode { get; set; }
    public int inOutMode { get; set; }
    public int year { get; set; }
    public int month { get; set; }
    public int day { get; set; }
    public int hour { get; set; }
    public int minute { get; set; }
    public int second { get; set; }
    public int workCode { get; set; }
}

public sealed class UserEntry
{
    public int enrollNumber { get; set; }
    public string name { get; set; } = "";
    public string password { get; set; } = "";
    public int privilege { get; set; }
    public bool enabled { get; set; } = true;
    public string? cardNumber { get; set; }
}

public sealed class FingerprintTemplate
{
    public int enrollNumber { get; set; }
    public int fingerIndex { get; set; }
    public string templateData { get; set; } = "";
    public int templateLength { get; set; }
}

public sealed class CommandRequest
{
    public string method { get; set; } = "";
    public object?[] args { get; set; } = Array.Empty<object?>();
}

public sealed class FaceTemplate
{
    public int enrollNumber { get; set; }
    public int faceIndex { get; set; }
    public string templateData { get; set; } = "";
    public int templateLength { get; set; }
}

public sealed class BackupRequest
{
    public string? fileName { get; set; }
}

public sealed class UserBiometrics
{
    public int enrollNumber { get; set; }
    public List<FingerprintTemplate> fingerprints { get; set; } = new();
    public FaceTemplate? face { get; set; }
}

public sealed class TimeZoneRequest
{
    public string tz { get; set; } = "";
}

public sealed class GroupTimeZoneRequest
{
    public int tzIndex { get; set; }
}

public sealed class UserGroupRequest
{
    public int groupNo { get; set; }
}
