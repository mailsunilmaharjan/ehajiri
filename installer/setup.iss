; ══════════════════════════════════════════════════════════════════
;  eHajiri TMS — Inno Setup Installer Script
;  Requires: Inno Setup 6.x  (https://jrsoftware.org/isinfo.php)
;
;  What this installer does:
;   1. Installs portable Node.js (bundled inside installer)
;   2. Installs PostgreSQL 16 silently
;   3. Copies eHajiri app files
;   4. Creates PostgreSQL database + user
;   5. Registers backend as a Windows Service (via NSSM)
;   6. Creates Desktop shortcut (opens browser to localhost:5000)
;   7. Creates Start Menu entries
;
;  BUILD STEPS (run once before building installer):
;   a) npm run build                     → creates dist/ folder
;   b) Download node-v22.x-win-x64.zip  → place in installer/deps/node.zip
;   c) Download postgresql-16-windows.exe → place in installer/deps/pg-setup.exe
;   d) Download nssm.exe                 → place in installer/deps/nssm.exe
;   e) Run: iscc installer\setup.iss
; ══════════════════════════════════════════════════════════════════

#define AppName      "eHajiri TMS"
#define AppVersion   "1.0.0"
#define AppPublisher "Planet Infosys Pvt. Ltd"
#define AppURL       "https://planetinfosys.com.np"
#define AppExeName   "eHajiri.exe"
#define ServiceName  "eHajiriServer"
#define DbName       "ehajiriPlanetInfosys_db"
#define DbUser       "ehajiri"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
DefaultDirName={autopf}\eHajiri
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=..\dist-installer
OutputBaseFilename=eHajiri-Setup-v{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\eHajiri.exe
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart";   Description: "Start eHajiri automatically when Windows boots"; GroupDescription: "Startup"

[Dirs]
Name: "{app}"
Name: "{app}\node"
Name: "{app}\server"
Name: "{app}\dist"
Name: "{app}\data"
Name: "{app}\logs"
Name: "{app}\backups"

; ── App files ──────────────────────────────────────────────────────
[Files]
; Node.js (portable — extracted to {app}\node\)
Source: "deps\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs

; NSSM service manager
Source: "deps\nssm.exe"; DestDir: "{app}"; Flags: ignoreversion

; Bundled PostgreSQL 16 installer (~350 MB) — kept OUT of {app} (dontcopy) and
; only extracted to {tmp} on demand (see PrepareToInstall below) when no
; PostgreSQL server is already present on the machine. This is what the
; [Run] step "Installing PostgreSQL 16..." launches from {tmp}\pg-setup.exe.
Source: "deps\pg-setup.exe"; DestDir: "{tmp}"; Flags: dontcopy

; eHajiri server files (obfuscated production build — see installer/scripts/obfuscate-build.js)
Source: "..\dist-server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\dist\*";        DestDir: "{app}\dist";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\package.json";  DestDir: "{app}";        Flags: ignoreversion

; Startup scripts
Source: "scripts\start-server.bat";     DestDir: "{app}"; Flags: ignoreversion
Source: "scripts\open-browser.bat";     DestDir: "{app}"; Flags: ignoreversion
Source: "scripts\install-service.bat";  DestDir: "{app}"; Flags: ignoreversion
Source: "scripts\uninstall-service.bat";DestDir: "{app}"; Flags: ignoreversion
Source: "scripts\fix-service.bat";      DestDir: "{app}"; Flags: ignoreversion

; Launcher EXE (opens browser to localhost:5000)
Source: "assets\eHajiri.exe";  DestDir: "{app}"; Flags: ignoreversion

; App icon
Source: "assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Desktop shortcut
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; \
  IconFilename: "{app}\icon.ico"; \
  Tasks: desktopicon

; Start Menu
Name: "{group}\{#AppName}";        Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{group}\Open eHajiri";      Filename: "{app}\open-browser.bat"
Name: "{group}\Uninstall eHajiri"; Filename: "{uninstallexe}"

; ── Installation steps ─────────────────────────────────────────────
[Run]
; 1. Install PostgreSQL silently — skipped when a PostgreSQL server is already
;    present (installing a second instance on the same port hangs/fails and
;    blocks the service-registration steps below from ever running).
Filename: "{tmp}\pg-setup.exe"; \
  Parameters: "--mode unattended --unattendedmodeui none --superpassword ""ehajiri2024"" --serverport 5432 --datadir ""{app}\data"" --enable-components server,commandlinetools --disable-components pgAdmin,stackbuilder"; \
  StatusMsg: "Installing PostgreSQL 16..."; \
  Check: not IsPostgresInstalled; \
  Flags: waituntilterminated

; 2. Create database and user — runs unconditionally, connecting with the
;    bundled PostgreSQL's known superuser credentials (the --superpassword
;    passed to pg-setup.exe above). That's always correct when we installed
;    PostgreSQL ourselves; on a machine with a pre-existing server it only
;    succeeds if its superuser happens to use the same default credentials —
;    otherwise setup-db.js fails gracefully (writes FAIL to the result file)
;    and GetPgSetupMode below tells install-service.bat to defer to
;    server\.env instead of overriding it with credentials that don't work.
;
;    Gated by VerifyPostgresDataDir (Check below): initdb can silently
;    fail/be skipped inside pg-setup.exe — e.g. a locked or non-empty
;    {app}\data left over from a prior failed install — leaving a service
;    that can never start and a database that can never be created. That
;    check aborts the install loudly with PG_VERSION's absence as proof,
;    instead of limping on to a server that only ever reports empty
;    "database does not exist" / connection-refused errors.
Filename: "{app}\node\node.exe"; \
  Parameters: """{app}\server\scripts\setup-db.js"" ""{code:GetDbSetupResultPath}"""; \
  WorkingDir: "{app}"; \
  StatusMsg: "Setting up database..."; \
  Check: VerifyPostgresDataDir; \
  Flags: waituntilterminated runhidden

; 3. Install server as Windows Service
; Pass "bundled"/"existing" so install-service.bat knows whether the
; ehajiri/<DB_PASS> credentials it would otherwise hardcode into the
; service's environment are actually valid (they only are when this
; installer created the database itself — see GetPgSetupMode below).
Filename: "{app}\install-service.bat"; \
  Parameters: "{code:GetPgSetupMode}"; \
  WorkingDir: "{app}"; \
  StatusMsg: "Installing Windows Service..."; \
  Flags: waituntilterminated runhidden

; 4. Start the service
Filename: "net"; \
  Parameters: "start {#ServiceName}"; \
  StatusMsg: "Starting eHajiri Server..."; \
  Flags: waituntilterminated runhidden

; 5. Open browser (after short delay)
Filename: "{app}\open-browser.bat"; \
  Description: "Open eHajiri in browser"; \
  Flags: postinstall nowait skipifsilent

[UninstallRun]
; Stop and remove the service
Filename: "{app}\uninstall-service.bat"; WorkingDir: "{app}"; RunOnceId: "RemoveEHajiriService"; Flags: waituntilterminated runhidden

[Code]
var
  DbSetupResultPath      : String;
  WeInstalledPostgres    : Boolean;
  PostgresDataDirChecked : Boolean;

{ True if ANY PostgreSQL server (any version) is already installed —
  not just v16. Installing a second server on the same port would hang,
  so the bundled installer must be skipped whenever one is present. }
function IsPostgresInstalled(): Boolean;
var
  Names: TArrayOfString;
  I: Integer;
begin
  Result := False;
  if RegGetSubkeyNames(HKLM, 'SOFTWARE\PostgreSQL\Installations', Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('postgresql-x64-', Names[I]) = 1 then
      begin
        Result := True;
        Exit;
      end;
end;

{ Returns (and lazily creates) the path to the result file setup-db.js writes
  OK / FAIL:<reason> into, so GetPgSetupMode can tell whether the
  ehajiri/<DB_PASS> credentials it just (tried to) create actually work
  before handing them to the service. }
function GetDbSetupResultPath(Param: String): String;
begin
  if DbSetupResultPath = '' then
    DbSetupResultPath := ExpandConstant('{tmp}\ehajiri-pgsetup-result.txt');
  Result := DbSetupResultPath;
end;

{ Tells install-service.bat whether the ehajiri/<DB_PASS> service credentials
  setup-db.js just (tried to) create are valid — based on the OK/FAIL result
  file it wrote (see GetDbSetupResultPath). Returning 'existing' makes
  install-service.bat fall back to the admin's own server\.env instead of
  overriding it with credentials that don't actually work (e.g. a
  pre-existing PostgreSQL whose superuser password differs from the
  bundled default that setup-db.js connects with). }
function GetPgSetupMode(Param: String): String;
var
  Content: AnsiString;
begin
  Result := 'existing';
  if (DbSetupResultPath <> '') and LoadStringFromFile(DbSetupResultPath, Content) then
    if Pos('OK', String(Content)) = 1 then
      Result := 'bundled';
end;

// Runs right before installation begins. The bundled PostgreSQL installer is
// ~350 MB and was compiled with the "dontcopy" flag (see [Files]) so it is
// NOT extracted by default. We only pull it out of the compressed setup into
// the temp folder - where the "Installing PostgreSQL 16..." Run step expects
// to find it - when no PostgreSQL server is already on the machine. If one is
// already installed, this is skipped entirely and the 350 MB stays compressed.
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  // Captured once, here — IsPostgresInstalled() would return True for our OWN
  // bundled install too once it's done, so this is the only point where "did
  // WE install Postgres" and "was one already there" can still be told apart.
  WeInstalledPostgres := not IsPostgresInstalled();
  if WeInstalledPostgres then
    ExtractTemporaryFile('pg-setup.exe');
end;

// Confirms the bundled PostgreSQL actually finished initializing its data
// directory before setup-db.js tries to connect to it. initdb writes
// PG_VERSION as essentially its last step, so its absence is a reliable
// signal that initdb failed or never ran -- e.g. because the app's \data
// folder was locked or non-empty from a previous failed install. A server
// in that state can never start and a database can never be created, so
// continuing would only produce an endless string of empty "database does
// not exist" / connection-refused errors with no clear cause. Aborting
// here, loudly, with the real cause named, is far more useful than that.
// Used as the Check: for the setup-db.js [Run] entry -- runs once, right
// before that step.
function VerifyPostgresDataDir(): Boolean;
begin
  Result := True;
  if PostgresDataDirChecked then Exit;
  PostgresDataDirChecked := True;

  if WeInstalledPostgres and not FileExists(ExpandConstant('{app}\data\PG_VERSION')) then
  begin
    SuppressibleMsgBox(
      'PostgreSQL did not finish setting up its data directory' + #13#10 +
      '(the file "PG_VERSION" is missing from "' + ExpandConstant('{app}\data') + '").' + #13#10#13#10 +
      'This means the bundled PostgreSQL''s initialization (initdb) failed or was ' +
      'interrupted, so eHajiri''s database can never be created and the server can ' +
      'never start.' + #13#10#13#10 +
      'Setup will now stop. Please uninstall eHajiri, make sure no leftover PostgreSQL ' +
      'service, process, or data folder remains, and run this installer again.',
      mbCriticalError, MB_OK, IDOK);
    Abort();
  end;
end;

procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel2.Caption :=
    'This will install eHajiri TMS v{#AppVersion} on your computer.' + #13#10 + #13#10 +
    'The following will be installed:' + #13#10 +
    '  • eHajiri Attendance Management System' + #13#10 +
    '  • Node.js 22 (bundled)' + #13#10 +
    '  • PostgreSQL 16 database (skipped if PostgreSQL is already installed)' + #13#10 + #13#10 +
    'PostgreSQL and the eHajiri server are both registered to start ' +
    'automatically with Windows and will be running once setup finishes — ' +
    'no manual steps needed.' + #13#10 + #13#10 +
    'On the next screen you can choose the install drive and folder ' +
    '(for example C:\Program Files\eHajiri or D:\Apps\eHajiri).' + #13#10 + #13#10 +
    'Please close all other applications before continuing.';

  if IsPostgresInstalled() then
    WizardForm.WelcomeLabel2.Caption := WizardForm.WelcomeLabel2.Caption + #13#10 + #13#10 +
      'A PostgreSQL server was detected on this machine — the bundled one will ' +
      'be skipped, and setup will try to create its own database (' + '{#DbName}' +
      ') on your existing server automatically. If that doesn''t work, a note ' +
      'at the end will explain how to finish the connection manually.';
end;

{ Lets the admin know, on the very last page, whether the automatic database
  setup against an existing PostgreSQL server actually worked (it always
  works for a freshly-bundled PostgreSQL, whose credentials are known). }
procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and IsPostgresInstalled() and (GetPgSetupMode('') <> 'bundled') then
    WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10 + #13#10 +
      'Note: eHajiri could not automatically set up its database on your existing ' +
      'PostgreSQL server (its superuser password likely differs from the default ' +
      'eHajiri tried). Please edit "' + ExpandConstant('{app}') + '\server\.env" ' +
      'with working connection details, then restart the "eHajiriServer" service.' + #13#10 + #13#10 +
      'Default database settings are:' + #13#10 +
      '  DB_HOST=localhost' + #13#10 +
      '  DB_PORT=5432' + #13#10 +
      '  DB_NAME=ehajiriPlanetInfosys_db' + #13#10 +
      '  DB_USER=ehajiri' + #13#10 +
      '  DB_PASS=Eh@jiri2026!@Pl@nE!iNfOsYS' + #13#10 + #13#10 +
      'This usually means your existing PostgreSQL uses a different superuser password ' +
      'from the default installer password (ehajiri2024). If so, create the database ' +
      'and user manually or update server\.env with a working connection and restart the service.' + #13#10 + #13#10 +
      'If the service still does not start, check "' + ExpandConstant('{app}') + '\logs\server-error.log" for the exact error.';
end;
