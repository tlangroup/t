@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
cd /d "%~dp0"
cl /nologo /std:c11 /utf-8 /W3 test_runtime.c t_runtime.c /Fe:test_runtime.exe
exit /b %ERRORLEVEL%
