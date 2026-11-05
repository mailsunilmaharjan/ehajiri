param([switch]$Release)
# Builds the eHajiri Android APK. Run on a PC with Android Studio installed (it provides the JDK and Android SDK).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Find a JDK: JAVA_HOME, or the one bundled with Android Studio
if (-not $env:JAVA_HOME) {
  foreach ($p in 'C:\Program Files\Android\Android Studio\jbr', "$env:LOCALAPPDATA\Programs\Android Studio\jbr") { if (Test-Path "$p\bin\java.exe") { $env:JAVA_HOME = $p; break } }
}
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw 'No JDK found. Install Android Studio (or JDK 21) and set JAVA_HOME.' }

# Find the Android SDK
if (-not $env:ANDROID_HOME) { $sdk = "$env:LOCALAPPDATA\Android\Sdk"; if (Test-Path $sdk) { $env:ANDROID_HOME = $sdk } }
if (-not $env:ANDROID_HOME -or -not (Test-Path $env:ANDROID_HOME)) { throw 'Android SDK not found. Open Android Studio once so it installs the SDK.' }
"sdk.dir=$($env:ANDROID_HOME -replace '\\','/')" | Set-Content -Encoding ascii 'android\local.properties'

if (-not (Test-Path node_modules)) { npm install }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }

Push-Location android
try {
  if ($Release) { .\gradlew.bat assembleRelease } else { .\gradlew.bat assembleDebug }
  if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed' }
} finally { Pop-Location }

$apk = Get-ChildItem -Recurse android\app\build\outputs\apk -Filter *.apk | Sort-Object LastWriteTime -Descending | Select-Object -First 1
"APK ready: $($apk.FullName)  ($([math]::Round($apk.Length/1MB,1)) MB)"
