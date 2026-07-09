using System.Runtime.InteropServices;
using StandaloneBridge.Models;
using zkemkeeper;

namespace StandaloneBridge.ComBridge;

/// <summary>
/// One logical standalone device: owns a CZKEM instance + machine number,
/// and a connection lifecycle. All COM calls are marshaled onto the shared
/// STA thread via the dispatcher passed in.
/// </summary>
public sealed class DeviceSession
{
    private const int MachineNumber = 1;
    private readonly StaDispatcher _sta;
    private CZKEM? _zk;
    private bool _connected;

    public DeviceSession(StaDispatcher sta)
    {
        _sta = sta;
    }

    public bool IsConnected => _connected;

    private CZKEM Zk => _zk ??= new CZKEM();

    private static ZkResult<T> Fail<T>(CZKEM zk, string error)
    {
        int code = 0;
        try { zk.GetLastError(ref code); } catch { /* best effort */ }
        return ZkResult<T>.Failure(error, code);
    }

    public Task<ZkResult<bool>> ConnectAsync(ConnectRequest req) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        try
        {
            if (!string.IsNullOrEmpty(req.password))
            {
                zk.SetCommPasswordEx(req.password);
            }
            bool ok = zk.Connect_Net(req.ip, req.port);
            if (!ok) return Fail<bool>(zk, "Connect_Net failed — device unreachable or wrong IP/port");
            zk.RegEvent(MachineNumber, 65535);
            _connected = true;
            return ZkResult<bool>.Success(true);
        }
        catch (Exception ex) when (IsComNotRegistered(ex))
        {
            return ZkResult<bool>.Failure(
                "zkemkeeper.dll is not registered on this machine — run regsvr32 on the SDK's x86 zkemkeeper.dll as Administrator",
                unchecked((int)0x80040154));
        }
    });

    public Task<ZkResult<bool>> DisconnectAsync() => _sta.InvokeAsync(() =>
    {
        if (_zk != null)
        {
            try { _zk.Disconnect(); } catch { /* ignore */ }
        }
        _connected = false;
        return ZkResult<bool>.Success(true);
    });

    public Task<ZkResult<DeviceInfo>> GetInfoAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        var info = new DeviceInfo();
        string sn = "", fw = "", pc = "", ip = "", mac = "", vendor = "", platform = "";
        zk.GetSerialNumber(MachineNumber, out sn);
        zk.GetFirmwareVersion(MachineNumber, ref fw);
        zk.GetProductCode(MachineNumber, out pc);
        zk.GetDeviceIP(MachineNumber, ref ip);
        zk.GetDeviceMAC(MachineNumber, ref mac);
        zk.GetVendor(ref vendor);
        zk.GetPlatform(MachineNumber, ref platform);
        info.serialNumber = sn; info.firmwareVersion = fw; info.productCode = pc;
        info.deviceIp = ip; info.deviceMac = mac; info.vendor = vendor; info.platform = platform;
        return ZkResult<DeviceInfo>.Success(info);
    });

    public Task<ZkResult<string>> GetTimeAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
        if (!zk.GetDeviceTime(MachineNumber, ref y, ref mo, ref d, ref h, ref mi, ref s))
            return Fail<string>(zk, "GetDeviceTime failed");
        var dt = new DateTime(y, mo, d, h, mi, s);
        return ZkResult<string>.Success(dt.ToString("yyyy-MM-dd HH:mm:ss"));
    });

    public Task<ZkResult<bool>> SetTimeAsync(TimeRequest req) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok;
        if (string.IsNullOrEmpty(req.time))
        {
            ok = zk.SetDeviceTime(MachineNumber);
        }
        else
        {
            var dt = DateTime.Parse(req.time);
            ok = zk.SetDeviceTime2(MachineNumber, dt.Year, dt.Month, dt.Day, dt.Hour, dt.Minute, dt.Second);
        }
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "SetDeviceTime failed");
    });

    public Task<ZkResult<bool>> EnableAsync(bool enabled) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.EnableDevice(MachineNumber, enabled);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "EnableDevice failed");
    });

    public Task<ZkResult<bool>> RestartAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.RestartDevice(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "RestartDevice failed");
    });

    public Task<ZkResult<bool>> PowerOffAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.PowerOffDevice(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "PowerOffDevice failed");
    });

    public Task<ZkResult<bool>> RefreshAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.RefreshData(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "RefreshData failed");
    });

    public Task<ZkResult<List<AttLogEntry>>> GetLogsAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            if (!zk.ReadGeneralLogData(MachineNumber))
                return Fail<List<AttLogEntry>>(zk, "ReadGeneralLogData failed");

            var logs = new List<AttLogEntry>();
            int enroll = 0, verify = 0, inOut = 0, y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, wc = 0, reserved = 0;
            while (zk.GetGeneralExtLogData(MachineNumber, ref enroll, ref verify, ref inOut, ref y, ref mo, ref d, ref h, ref mi, ref s, ref wc, ref reserved))
            {
                logs.Add(new AttLogEntry
                {
                    enrollNumber = enroll, verifyMode = verify, inOutMode = inOut,
                    year = y, month = mo, day = d, hour = h, minute = mi, second = s, workCode = wc,
                });
            }
            return ZkResult<List<AttLogEntry>>.Success(logs);
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<bool>> ClearLogsAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.ClearGLog(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "ClearGLog failed");
    });

    public Task<ZkResult<List<UserEntry>>> GetUsersAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            if (!zk.ReadAllUserID(MachineNumber))
                return Fail<List<UserEntry>>(zk, "ReadAllUserID failed");

            var users = new List<UserEntry>();
            int enroll = 0, privilege = 0;
            string name = "", password = "";
            bool enabled = true;
            while (zk.GetAllUserInfo(MachineNumber, ref enroll, ref name, ref password, ref privilege, ref enabled))
            {
                // Card number is a stateful buffer the SDK fills as a side effect of
                // the GetAllUserInfo() iteration above — read it right after, per call.
                string cardNumber = "";
                zk.GetStrCardNumber(out cardNumber);
                users.Add(new UserEntry { enrollNumber = enroll, name = name, password = password, privilege = privilege, enabled = enabled, cardNumber = cardNumber });
            }
            return ZkResult<List<UserEntry>>.Success(users);
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<bool>> SetUserAsync(UserEntry user) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            zk.BeginBatchUpdate(MachineNumber, 1);
            // Card number must be staged into the SDK's buffer immediately before
            // SetUserInfo — that's the pairing the demo apps use; there's no
            // separate per-user card-number parameter on SetUserInfo itself.
            if (!string.IsNullOrEmpty(user.cardNumber))
                zk.SetStrCardNumber(user.cardNumber);
            bool ok = zk.SetUserInfo(MachineNumber, user.enrollNumber, user.name, user.password, user.privilege, user.enabled);
            zk.BatchUpdate(MachineNumber);
            zk.RefreshData(MachineNumber);
            return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "SetUserInfo failed");
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<bool>> DeleteUserAsync(int enrollNumber) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            // backupNumber=12 is the SDK convention for "all enrollment data" (info + every finger/face/card).
            bool ok = zk.DeleteEnrollData(MachineNumber, enrollNumber, MachineNumber, 12);
            zk.RefreshData(MachineNumber);
            return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "DeleteEnrollData failed");
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<FingerprintTemplate>> GetFingerprintAsync(int enrollNumber, int fingerIndex) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            zk.ReadAllTemplate(MachineNumber);
            string tmpData = "";
            int tmpLength = 0;
            bool ok = zk.GetUserTmpStr(MachineNumber, enrollNumber, fingerIndex, ref tmpData, ref tmpLength);
            if (!ok) return Fail<FingerprintTemplate>(zk, "GetUserTmpStr failed");
            return ZkResult<FingerprintTemplate>.Success(new FingerprintTemplate
            {
                enrollNumber = enrollNumber, fingerIndex = fingerIndex, templateData = tmpData, templateLength = tmpLength,
            });
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<bool>> SetFingerprintAsync(int enrollNumber, int fingerIndex, string templateData) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            zk.BeginBatchUpdate(MachineNumber, 1);
            bool ok = zk.SetUserTmpStr(MachineNumber, enrollNumber, fingerIndex, templateData);
            zk.BatchUpdate(MachineNumber);
            zk.RefreshData(MachineNumber);
            return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "SetUserTmpStr failed");
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<bool>> DeleteFingerprintAsync(int enrollNumber, int fingerIndex) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.DelUserTmp(MachineNumber, enrollNumber, fingerIndex);
        zk.RefreshData(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "DelUserTmp failed");
    });

    public Task<ZkResult<bool>> ClearAdminAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.ClearAdministrators(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "ClearAdministrators failed");
    });

    public Task<ZkResult<bool>> ClearAllUsersAsync() => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        // DataFlag=5 — SDK convention for "clear all user info + every template (fp/face/card)".
        bool ok = zk.ClearData(MachineNumber, 5);
        zk.RefreshData(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "ClearData failed");
    });

    public Task<ZkResult<FaceTemplate>> GetFaceAsync(int enrollNumber, int faceIndex) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            string tmpData = "";
            int tmpLength = 0;
            bool ok = zk.GetUserFaceStr(MachineNumber, enrollNumber.ToString(), faceIndex, ref tmpData, ref tmpLength);
            if (!ok) return Fail<FaceTemplate>(zk, "GetUserFaceStr failed — device/firmware may not support face templates");
            return ZkResult<FaceTemplate>.Success(new FaceTemplate
            {
                enrollNumber = enrollNumber, faceIndex = faceIndex, templateData = tmpData, templateLength = tmpLength,
            });
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<bool>> SetFaceAsync(int enrollNumber, int faceIndex, string templateData) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            bool ok = zk.SetUserFaceStr(MachineNumber, enrollNumber.ToString(), faceIndex, templateData, templateData.Length);
            zk.RefreshData(MachineNumber);
            return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "SetUserFaceStr failed");
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    public Task<ZkResult<bool>> DeleteFaceAsync(int enrollNumber, int faceIndex) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.DelUserFace(MachineNumber, enrollNumber.ToString(), faceIndex);
        zk.RefreshData(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "DelUserFace failed");
    });

    /// <summary>
    /// Best-effort full biometric pull for one user: every finger slot (0-9)
    /// that has data, plus face index 0 if the device supports it. Used by
    /// the "download all biometrics" backup action and by device-to-device cloning.
    /// </summary>
    public Task<ZkResult<UserBiometrics>> GetUserBiometricsAsync(int enrollNumber) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        zk.EnableDevice(MachineNumber, false);
        try
        {
            zk.ReadAllTemplate(MachineNumber);
            var result = new UserBiometrics { enrollNumber = enrollNumber };

            for (int finger = 0; finger <= 9; finger++)
            {
                string tmpData = "";
                int tmpLength = 0;
                if (zk.GetUserTmpStr(MachineNumber, enrollNumber, finger, ref tmpData, ref tmpLength) && tmpLength > 0)
                {
                    result.fingerprints.Add(new FingerprintTemplate
                    {
                        enrollNumber = enrollNumber, fingerIndex = finger, templateData = tmpData, templateLength = tmpLength,
                    });
                }
            }

            try
            {
                string faceData = "";
                int faceLength = 0;
                if (zk.GetUserFaceStr(MachineNumber, enrollNumber.ToString(), 0, ref faceData, ref faceLength) && faceLength > 0)
                {
                    result.face = new FaceTemplate { enrollNumber = enrollNumber, faceIndex = 0, templateData = faceData, templateLength = faceLength };
                }
            }
            catch { /* face not supported on this device/firmware — fingerprints are still valid */ }

            return ZkResult<UserBiometrics>.Success(result);
        }
        finally
        {
            zk.EnableDevice(MachineNumber, true);
        }
    });

    /// <summary>
    /// Weekly punch-acceptance schedule for one of the device's 50 time-zone
    /// slots. TZ is a 56-char string: 7 days (Sun..Sat) x 8 chars (HHMM start
    /// + HHMM end), no separators. "00000000" for a day means closed all day.
    /// Setting the string alone does nothing until a group (or user) is
    /// pointed at this slot — see SetGroupTimeZoneAsync/SetUserGroupAsync.
    /// </summary>
    public Task<ZkResult<bool>> SetTimeZoneAsync(int tzIndex, string tz) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.SetTZInfo(MachineNumber, tzIndex, tz);
        zk.RefreshData(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "SetTZInfo failed");
    });

    public Task<ZkResult<string>> GetTimeZoneAsync(int tzIndex) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        string tz = "";
        bool ok = zk.GetTZInfo(MachineNumber, tzIndex, ref tz);
        return ok ? ZkResult<string>.Success(tz) : Fail<string>(zk, "GetTZInfo failed");
    });

    /// <summary>
    /// Points a user group at up to 3 time-zone slots (only the first is used
    /// here) — every user in that group is then gated by that weekly schedule.
    /// ValidHoliday=1 means holidays still apply on top of this schedule.
    /// </summary>
    public Task<ZkResult<bool>> SetGroupTimeZoneAsync(int groupNo, int tzIndex) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.SSR_SetGroupTZ(MachineNumber, groupNo, tzIndex, 0, 0, 1, 0);
        zk.RefreshData(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "SSR_SetGroupTZ failed");
    });

    public Task<ZkResult<bool>> SetUserGroupAsync(int enrollNumber, int groupNo) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.SetUserGroup(MachineNumber, enrollNumber, groupNo);
        zk.RefreshData(MachineNumber);
        return ok ? ZkResult<bool>.Success(true) : Fail<bool>(zk, "SetUserGroup failed");
    });

    public Task<ZkResult<string>> BackupDeviceAsync(string filePath) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        bool ok = zk.BackupData(filePath);
        return ok ? ZkResult<string>.Success(filePath) : Fail<string>(zk, "BackupData failed");
    });

    public Task<ZkResult<object?>> InvokeCommandAsync(string method, object?[] args) => _sta.InvokeAsync(() =>
    {
        var zk = Zk;
        try
        {
            var result = ComMethodInvoker.Invoke(zk, method, args, MachineNumber);
            return ZkResult<object?>.Success(result);
        }
        catch (Exception ex)
        {
            return Fail<object?>(zk, ex.Message);
        }
    });

    private static bool IsComNotRegistered(Exception ex) =>
        ex is COMException com && unchecked((uint)com.HResult) == 0x80040154;
}
