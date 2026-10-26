# MSVC / Windows SDK 环境变量 —— WorkBuddy 的 bash shell 不带 vcvars，
# clang 走 lld-link 时会找不到 libcmt.lib / oldnames.lib。
# 用法：source tools/msvc_env.sh && node tools/gate.mjs L1
# （路径按本机实测写死；机器上 MSVC 版本为 14.37.32822，SDK 10.0.22621.0）

export MSVC_HOME='C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.37.32822'
export SDK_HOME='C:\Program Files (x86)\Windows Kits\10'

export LIB="${MSVC_HOME}\lib\x64;${SDK_HOME}\Lib\10.0.22621.0\ucrt\x64;${SDK_HOME}\Lib\10.0.22621.0\um\x64"
export INCLUDE="${MSVC_HOME}\include;${SDK_HOME}\Include\10.0.22621.0\ucrt;${SDK_HOME}\Include\10.0.22621.0\um;${SDK_HOME}\Include\10.0.22621.0\shared"
