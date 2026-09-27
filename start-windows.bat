@echo off
rem Starts Decision Council on Windows. Double-click this file to run it.
rem See README.md, step 4.
cd /d "%~dp0"
title Decision Council

rem Find Python 3.10 or newer.
set "PYTHON="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>nul && set "PYTHON=py -3"
if not defined PYTHON python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>nul && set "PYTHON=python"

if not defined PYTHON (
    echo.
    echo Python 3.10 or newer was not found on this computer.
    echo Install it from https://www.python.org/downloads/ - see README.md, step 1.
    echo When installing, tick the box "Add python.exe to PATH".
    echo Then double-click this file again.
    echo.
    pause
    exit /b 1
)

%PYTHON% launch.py
if errorlevel 1 (
    echo.
    echo Something went wrong. Read the message above.
    echo README.md has a section called "If something goes wrong".
    echo.
    pause
)
