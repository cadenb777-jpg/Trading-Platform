; Trading Terminal for Windows: ONE file, TradingTerminal.exe (Inno Setup 6). Built and tested by
; .github/workflows/installer.yml, which passes AppVersion and puts the official, signature-checked Python installer next to
; this file as python-installer.exe.
;
; Double-click it and there are no questions: one progress bar copies the app and the helper (both the Terminal window and
; the website use it) for this Windows user only (no administrator password) into %LOCALAPPDATA%\Programs\Trading Terminal,
; installs Python first if this computer has none (the copy inside, nothing else downloaded), puts Trading Terminal on the
; desktop and in the Start menu, then opens it, and its start screen asks: Terminal or Web. Running the newest
; TradingTerminal.exe again simply refreshes the files and opens it. Updates also happen by themselves (the app at each start,
; the helper every 2 minutes). Settings > Apps lists it with an uninstaller that never touches your keys, logins or data in
; %USERPROFILE%\.trading-platform.

#ifndef AppVersion
  #define AppVersion "2.2"
#endif

[Setup]
AppId={{6F2B8C1E-4D7A-4E59-9B3C-7A1D2E5F8C40}
AppName=Trading Terminal
AppVersion={#AppVersion}
AppVerName=Trading Terminal {#AppVersion}
AppPublisher=Trading Terminal
AppPublisherURL=https://cadenb777-jpg.github.io/Trading-Platform/
AppSupportURL=https://github.com/cadenb777-jpg/Trading-Platform
DefaultDirName={localappdata}\Programs\Trading Terminal
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
AlwaysShowComponentsList=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=output
OutputBaseFilename=TradingTerminal
SetupIconFile=..\desktop\tp_desktop\assets\logo.ico
UninstallDisplayIcon={app}\desktop\tp_desktop\assets\logo.ico
UninstallDisplayName=Trading Terminal
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
; the app only reads its .py files at start, so nothing needs closing (and no question is asked)
CloseApplications=no
RestartApplications=no

[Files]
; the app and the helper, laid out as in the repository (the launcher finds ..\helper next to desktop\)
Source: "..\desktop\*"; DestDir: "{app}\desktop"; Excludes: "tests\*,__pycache__\*,*.pyc,desktop_backup\*"; Flags: recursesubdirs ignoreversion
Source: "..\helper\*"; DestDir: "{app}\helper"; Excludes: "tests\*,__pycache__\*,*.pyc,.venv\*,helper_backup*\*"; Flags: recursesubdirs ignoreversion
; Python, only used when this computer has none
Source: "python-installer.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsPython

[Icons]
Name: "{userprograms}\Trading Terminal"; Filename: "{app}\desktop\start-desktop-windows.bat"; WorkingDir: "{app}\desktop"; IconFilename: "{app}\desktop\tp_desktop\assets\logo.ico"; Comment: "Markets, research and trading"
Name: "{userdesktop}\Trading Terminal"; Filename: "{app}\desktop\start-desktop-windows.bat"; WorkingDir: "{app}\desktop"; IconFilename: "{app}\desktop\tp_desktop\assets\logo.ico"; Comment: "Markets, research and trading"
Name: "{userprograms}\Trading Terminal - choose Terminal or Web"; Filename: "{app}\desktop\start-desktop-windows.bat"; Parameters: "--choose"; WorkingDir: "{app}\desktop"; IconFilename: "{app}\desktop\tp_desktop\assets\logo.ico"; Comment: "Asks again how to open the platform"

[Run]
Filename: "{tmp}\python-installer.exe"; Parameters: "/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 InstallLauncherAllUsers=0 Include_test=0 Include_doc=0"; StatusMsg: "Installing Python (only this once)..."; Check: NeedsPython; Flags: waituntilterminated
Filename: "{app}\desktop\start-desktop-windows.bat"; WorkingDir: "{app}\desktop"; StatusMsg: "Opening Trading Terminal..."; Flags: nowait shellexec skipifsilent

[UninstallDelete]
; what the app made inside its own folder (Python packages, update backups); never %USERPROFILE%\.trading-platform
Type: filesandordirs; Name: "{app}"

[Code]
var
  PythonChecked: Boolean;
  PythonMissing: Boolean;

function CommandWorks(const Cmd: String): Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/c ' + Cmd + ' >nul 2>nul', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

{ True when no Python 3.10+ is installed (the "python" Store shortcut alone doesn't count). }
function NeedsPython: Boolean;
begin
  if not PythonChecked then
  begin
    PythonMissing := not (CommandWorks('py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))"')
      or CommandWorks('python -c "import sys; sys.exit(sys.version_info < (3, 10))"'));
    PythonChecked := True;
  end;
  Result := PythonMissing;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Marker, AppDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    { This file made the icons, so the app's first start doesn't make its own. }
    AppDir := ExpandConstant('{app}\desktop');
    StringChangeEx(AppDir, '\', '\\', True);  { JSON needs each backslash doubled }
    Marker := ExpandConstant('{%USERPROFILE}\.trading-platform');
    ForceDirectories(Marker);
    SaveStringToFile(Marker + '\desktop-shortcut.json', '{"made": true, "where": "installer", "app": "' + AppDir + '"}', False);
  end;
end;
