@echo off
:: ddwroom.tistory.com/62
:: presented by jeiea

set "SCRIPT_DIR=%~dp0"

:NEXT
if "%~1"=="" goto EOF
if exist "%~1\*" (
  for /R "%~1" %%A in (*.png^;*.flif;*.jpg) do (
    if "%%~xA"==".flif" (
      start /b flif -d --overwrite "%%~A" "%%~dpnA.png"
    ) else (
      start /b magick\convert "%%~A" -scale 1920x1080 ppm:- | flif -Q50 - - > "%%~dpnA.flif"
    )
  )
) else (
  if "%~x1"==".flif" (start /b flif -d --overwrite "%~1" "%~dpn1.png") else start /b flif -e --overwrite -Q5 "%~1" "%~dpn1.flif"
)
shift
goto NEXT

:EOF