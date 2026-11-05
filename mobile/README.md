# eHajiri Android app

A thin Android shell (Capacitor 8) around the **live web app**. It opens `https://attend.zkattendance.com`
(the shared login hub), so every web update reaches the app immediately — no new APK for ordinary changes.
The shell adds what a browser can't: the Android back button, location permission for Online Attendance,
and push notifications.

Features in this version: sign-in, Online Attendance (GPS), Leave and Office Visit (apply / approve), push notifications.
Android only (iPhone later: same project, `npx cap add ios`, built on a Mac or a cloud build service).

## 1. Build the APK (on any Windows PC — not needed on the server)

Install **Android Studio** once (it brings the JDK and the Android SDK). Then, in this `mobile` folder:

```powershell
npm install
./build-apk.ps1            # debug APK  -> android/app/build/outputs/apk/debug/app-debug.apk
./build-apk.ps1 -Release   # signed release APK (needs the keystore, see below)
```

Copy the APK to a phone (or put it where your server serves downloads) and open it. Android will ask to
allow "install unknown apps" the first time.

### Release signing (once)
```powershell
keytool -genkeypair -v -keystore ehajiri-release.keystore -alias ehajiri -keyalg RSA -keysize 2048 -validity 10000
```
Create `android/keystore.properties` (never commit it, never lose the keystore — updates must be signed with the same key):
```
storeFile=ehajiri-release.keystore
storePassword=********
keyAlias=ehajiri
keyPassword=********
```
(`storeFile` is relative to the `android` folder, so keep the `.keystore` file there.)

## 2. Push notifications (needs a free Firebase project)

Without this the app works normally; it just has no background alerts.

1. https://console.firebase.google.com → create a project → **Add Android app**, package name `com.zkattendance.ehajiri`.
2. Download **google-services.json** into `mobile/android/app/` and rebuild the APK.
3. Project settings → **Service accounts** → *Generate new private key*. Save the JSON on the server (outside any web folder).
4. In `server/.env` add `FCM_SERVICE_ACCOUNT_FILE=C:\path\to\that-file.json`, then restart the services.

The server sends a phone notification whenever someone is asked to approve a leave / office visit, when their own request is
approved or rejected, and for internal messages (e.g. missing-attendance requests). A phone is removed from the list when its
user logs out.

## 3. Things to know

* **Server address:** `capacitor.config.json` → `server.url`. Change it if the hub address differs, then `npx cap sync android`.
  Tenants reached through other domains must be added to `allowNavigation`.
* **App id:** `com.zkattendance.ehajiri`. If the existing `eHajiri-TMS.apk` uses a different id the two install side by side.
* **Icon / splash:** the Capacitor defaults are used. Replace `android/app/src/main/res/mipmap-*` and the splash with your logo
  (Android Studio → New → Image Asset).
* **Offline:** the app needs the internet (attendance does too). A friendly "No connection" page is shown otherwise.
* **Updating the app:** only needed when this shell changes (new plugins, new icon). Web changes are picked up automatically.
