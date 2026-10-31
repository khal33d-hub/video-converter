@echo off
setlocal
title Video Converter
cd /d "%~dp0app"

rem ---- Find Python (with Tk, which the window needs) ----
set "PY="
set "PYW="
py -3 -c "import tkinter" >nul 2>nul && (set "PY=py -3" & set "PYW=pyw -3")
if not defined PY (
  python -c "import tkinter" >nul 2>nul && (set "PY=python" & set "PYW=pythonw")
)
if not defined PY (
  echo.
  echo  Python is not installed yet. The Video Converter needs it to run.
  echo.
  choice /c YN /m " Install Python now"
  if errorlevel 2 goto :nopython
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  echo.
  echo  Done. Double-click "Start Video Converter" again to open the app.
  pause
  exit /b
)

rem ---- Make sure ffmpeg is available ----
%PY% -c "import core,sys; sys.exit(0 if core.find_tool('ffmpeg') else 1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ffmpeg is not installed yet. It does the actual converting.
  echo.
  choice /c YN /m " Install ffmpeg now (free, about 100 MB)"
  if errorlevel 2 goto :launch
  winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
)

:launch
start "" %PYW% app.py
exit /b

:nopython
echo.
echo  Get Python from https://www.python.org/downloads/
echo  and tick "Add python.exe to PATH" when installing.
pause
