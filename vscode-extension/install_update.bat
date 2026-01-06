@echo off
REM ========================================
REM Enterprise AI Chat - Extension Installer
REM ========================================
REM Double-click this file to install the latest extension
REM ========================================

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Enterprise AI Chat - Installer
echo ========================================
echo.

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"

REM Handle UNC paths by mapping a temporary drive
if "%SCRIPT_DIR:~0,2%"=="\\" (
    echo Network path detected, mapping drive...
    net use Z: "%SCRIPT_DIR:~0,-1%" /persistent:no >nul 2>&1
    set "WORK_DIR=Z:\"
    set "MAPPED_DRIVE=1"
) else (
    set "WORK_DIR=%SCRIPT_DIR%"
    set "MAPPED_DRIVE=0"
)

REM Find the latest .vsix file using the full path
set "LATEST_VSIX="
for %%f in ("%SCRIPT_DIR%enterprise-ai-chat-*.vsix") do (
    set "LATEST_VSIX=%%~nxf"
    set "FULL_PATH=%%f"
)

if "%LATEST_VSIX%"=="" (
    echo [ERROR] No .vsix file found!
    echo Looking in: %SCRIPT_DIR%
    echo.
    goto :cleanup
)

echo Found: %LATEST_VSIX%
echo Path:  %FULL_PATH%
echo.
echo Installing to VS Code...
echo.

REM Install using VS Code CLI with full path
code --install-extension "%FULL_PATH%" --force

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo   SUCCESS! Extension installed.
    echo ========================================
    echo.
    echo Reload VS Code: Ctrl+Shift+P then "Reload Window"
    echo.
) else (
    echo.
    echo [WARNING] code command returned error %ERRORLEVEL%
    echo.
    echo Try manually in VS Code:
    echo   1. Press Ctrl+Shift+P
    echo   2. Type: Extensions: Install from VSIX
    echo   3. Navigate to: %FULL_PATH%
    echo.
)

:cleanup
REM Unmap drive if we mapped it
if "%MAPPED_DRIVE%"=="1" (
    net use Z: /delete /yes >nul 2>&1
)

pause
endlocal
