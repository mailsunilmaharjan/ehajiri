# Field Visit route tracking — Android background setup

The web app already records the route (`src/utils/tripTracker.js`, started/stopped
by `TripTrackerHost` from the server's open-trip state). In a browser / the
current APK it uses `navigator.geolocation.watchPosition`, which only records
while the app is on screen. To keep recording with the phone locked or the app in
the background, the native app needs the community Background Geolocation plugin.
`tripTracker.js` already uses it automatically when it is present
(`window.Capacitor.Plugins.BackgroundGeolocation`) — no web code change is needed.

> Not done / not tested yet: this machine has no Android toolchain. Do these steps
> where the APK is built.

## 1. Install the plugin
```
cd mobile
npm install @capacitor-community/background-geolocation
npx cap sync android
```

## 2. Android permissions (`android/app/src/main/AndroidManifest.xml`)
Add next to the existing location permissions:
```xml
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```
The plugin's own foreground service shows a persistent notification
("eHajiri — Field Visit / Recording your route until you check in at the office"),
which is what lets Android keep the GPS running.

## 3. Google Play requirements (do BEFORE publishing — background location is reviewed)
- Play Console → App content → **Location permissions declaration**: declare
  background location; core feature = "field-visit route/distance tracking for
  staff, only while a field-visit trip is open".
- A short screen-recording video showing the prominent in-app disclosure and the
  feature is required. The in-app disclosure exists on the "Check out from Office"
  screen ("Your route is recorded while this field visit trip is open…"); Google
  expects it to be a separate explicit consent step before the OS permission prompt
  — add an "Allow / No thanks" dialog there if the reviewer asks.
- Update **Data safety**: Location → "Precise location" collected, **also in the
  background**, purpose "App functionality"; not shared.
- The public privacy policy (`/privacy`) already discloses route recording.

## 4. Behaviour
- Records only between *Check Out from Office* and *Check In at Office*; stops
  immediately after (server: `/field-visit/sessions/:id/track-points` rejects points
  for a closed trip). Points are kept 90 days, then purged.
- A point is saved roughly every 20 s, or sooner after moving 25 m.
- Distance = sum of usable GPS steps (poor-accuracy fixes, stationary jitter and
  impossible jumps are ignored — `server/utils/geoUtils.js trackDistanceKm`); if a
  leg has fewer than 2 usable points the straight-line estimate is used and shown
  as "(est.)" instead of "(GPS route)".
