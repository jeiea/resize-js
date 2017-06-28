@echo on
:: ddwroom.tistory.com/62
:: presented by jeiea

set "SCRIPT_DIR=%~dp0"

:NEXT
if "%~1"=="" goto EOF
if exist "%~1\*" (
  for /R "%~1" %%A in (*.png^;*.jpg) do (
    start /b cmd /c magick\convert "%%~A" -scale 1920x1080 -quality 93 "%%~dpnA.jpg"
  )
) else (
  start /b magick\convert "%~1" -scale 1920x1080 png:- | guetzli - "%~dpn1.jpg"
)
shift
goto NEXT

:EOF