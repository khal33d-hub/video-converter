@echo off
rem Puts a "Video Converter" icon on your desktop that opens the app.
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=[Environment]::GetFolderPath('Desktop');" ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Video Converter.lnk'));" ^
  "$s.TargetPath=$env:HERE + 'Start Video Converter.bat';" ^
  "$s.WorkingDirectory=$env:HERE;" ^
  "$s.IconLocation=$env:HERE + 'app\icon.ico';" ^
  "$s.WindowStyle=7;" ^
  "$s.Save()"
if errorlevel 1 (
  echo Couldn't create the shortcut.
) else (
  echo Added "Video Converter" to your desktop.
)
pause
