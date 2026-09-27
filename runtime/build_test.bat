@echo off
rem ⚠ 2026-09-26：t_runtime.c 现在依赖 vendored 的 mimalloc / fdlibm / imath / Ryu，
rem   不能再单独编译它（缺 -I mimalloc/include，且缺那 100 个 .obj）。
rem   改为 clang 编测试主体 + 链接预编译的 out/dbg/deps/t_runtime.lib。
rem   该库缺失时先在项目根目录执行：node tools\build_runtime.mjs
setlocal
set "CLANG=C:\Program Files\LLVM\bin\clang.exe"
cd /d "%~dp0"
if not exist "..\out\dbg\deps\t_runtime.lib" (
  echo error: ..\out\dbg\deps\t_runtime.lib not found
  echo        run first: node tools\build_runtime.mjs
  exit /b 1
)
"%CLANG%" -std=c11 -O0 -I . -I mimalloc\include test_runtime.c ..\out\dbg\deps\t_runtime.lib -o test_runtime.exe -Wl,-subsystem:console
exit /b %ERRORLEVEL%
