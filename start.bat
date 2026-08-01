@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo First time setup -- installing dependencies, this may take a minute...
    call npm install
    if errorlevel 1 (
        echo.
        echo Something went wrong during npm install. Check the messages above.
        pause
        exit /b 1
    )
)

call npm start

if errorlevel 1 (
    echo.
    echo Preseason Transfer Wave closed with an error. Check the messages above.
    pause
)
