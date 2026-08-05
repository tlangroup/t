#!/usr/bin/env python3
# llm_bridge.py —— t 程序与「本地 LLM」之间的旁路桥（sidecar）
#
# 设计（对应 docs/agent_first.md §7 / §10.4）：
#   - t 程序（examples/agent_npc_mind_llm.tc 编译出的 exe）把 LLM 请求写进 stdout，
#     协议行形如 `LLMREQ|<prompt>`；真正的 LLM 调用发生在本进程（运行时边界，进程外）。
#   - 本桥逐行读 t 的 stdout：LLMREQ| 行 → 调本地 LLM → 把应答按词发回 t 的 stdin，
#     末尾加哨兵 `__EOM__`；其它行（t 的日志）原样镜像到 stderr。
#   - t 侧（llm_local）从 stdin 逐 token 读、遇 __EOM__ 停止、空格重拼，绕开 :text
#     读字符串按空白分词的限制。
#
# 本地 LLM 后端（默认 Ollama，零依赖即可跑通回退）：
#   - 默认打 Ollama 的 OpenAI 兼容接口 http://localhost:11434/api/generate
#     （先 `ollama pull <model>` 然后 `ollama serve` 已在跑）。
#   - 模型名取环境变量 LOCAL_LLM_MODEL（默认 "llama3"）。
#   - 接口地址可取环境变量 LOCAL_LLM_URL 覆盖（如 LM Studio / llama.cpp server）。
#   - 云端模式：设 LOCAL_LLM_MODE=openai 走 OpenAI 兼容 /v1/chat/completions，
#     用 LOCAL_LLM_KEY 提供密钥（LOCAL_LLM_URL 默认可覆盖为任意兼容端点）。
#   - 若 LLM 不可达（没装 Ollama / 没配 key / 网络不通等），自动回退到确定性应答，
#     保证管道可端到端验证。
#
# 用法：
#   node tools/gate.mjs 之类先构建 exe：
#       out/dbg/tc.exe build examples/agent_npc_mind_llm.tc --mode dbg --output out/dbg/npc_llm.exe
#   再启动桥（默认接管 out/dbg/npc_llm.exe）：
#       python tools/llm_bridge.py
#   或指定别的程序：
#       python tools/llm_bridge.py out/rls/npc_llm.exe
#   切到云端 LLM（OpenAI 兼容）：
#       LOCAL_LLM_MODE=openai LOCAL_LLM_KEY=sk-... LOCAL_LLM_MODEL=gpt-4o python tools/llm_bridge.py
#   仅用 Python 标准库（urllib / json / subprocess / sys），无需 pip 安装。
#

import os
import sys
import json
import subprocess
import urllib.request

# ── 配置 ──────────────────────────────────────────────────────────────
DEFAULT_EXE = os.path.join("out", "dbg", "npc_llm.exe")

# LLM 后端模式：ollama（默认，本地）| openai（云端兼容 /v1/chat/completions）
MODE = os.environ.get("LOCAL_LLM_MODE", "ollama").lower()
MODEL = os.environ.get("LOCAL_LLM_MODEL", "llama3")

# Ollama 的 OpenAI 兼容生成接口；可用 LOCAL_LLM_URL 覆盖（LM Studio / llama.cpp server 等）
OLLAMA_URL = os.environ.get("LOCAL_LLM_URL", "http://localhost:11434/api/generate")
# OpenAI 兼容聊天接口；云端用 LOCAL_LLM_URL 覆盖，LOCAL_LLM_KEY 提供密钥
OPENAI_URL = os.environ.get("LOCAL_LLM_URL", "https://api.openai.com/v1/chat/completions")
OPENAI_KEY = os.environ.get("LOCAL_LLM_KEY", "")

PROTO_REQ = "LLMREQ|"      # t → 桥：请求行前缀
PROTO_EOM = "__EOM__"      # 桥 → t：应答结束哨兵


def call_ollama(prompt: str) -> str:
    """调本地 Ollama（/api/generate）；不可达时由调用方回退。"""
    payload = json.dumps({"model": MODEL, "prompt": prompt, "stream": False}).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("response", "").strip()


def call_openai(prompt: str) -> str:
    """调 OpenAI 兼容聊天接口（/v1/chat/completions）；需 LOCAL_LLM_KEY。"""
    if not OPENAI_KEY:
        raise RuntimeError("LOCAL_LLM_MODE=openai 但 LOCAL_LLM_KEY 未设置")
    payload = json.dumps(
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_URL,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip()


def call_local_llm(prompt: str) -> str:
    """按 LOCAL_LLM_MODE 调真实 LLM；不可达时回退确定性应答（保证可端到端验证）。"""
    try:
        if MODE == "openai":
            ans = call_openai(prompt)
        else:
            ans = call_ollama(prompt)
        if ans:
            return ans
    except Exception as e:  # LLM 未就绪 / 鉴权失败：回退（与 fake_llm 同语义，便于验证）
        sys.stderr.write(f"[bridge] LLM 不可达（{e}），回退确定性应答\n")
    return fallback_llm(prompt)


def fallback_llm(prompt: str) -> str:
    """确定性回退：关键词匹配（与原始 fake_llm 同义，用于无模型时验证管道）。"""
    if "hours" in prompt.lower():
        return "We are open 9 to 5."
    return "Tell me more."


def main() -> int:
    exe = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_EXE
    if not os.path.exists(exe):
        sys.stderr.write(
            f"[bridge] 找不到程序 {exe}\n"
            f"          先构建：out/dbg/tc.exe build examples/agent_npc_mind_llm.tc "
            f"--mode dbg --output {exe}\n"
        )
        return 2

    sys.stderr.write(f"[bridge] 启动 {exe}，等待 LLMREQ| 请求（Ctrl+C 退出）\n")
    proc = subprocess.Popen(
        [exe],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,  # 继承终端：t 的编译器/运行时诊断直接可见
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="replace",
    )

    try:
        for line in proc.stdout:
            line = line.rstrip("\n")
            if not line:
                continue
            if line.startswith(PROTO_REQ):
                prompt = line[len(PROTO_REQ):]
                ans = call_local_llm(prompt)
                # 回复按词发，末尾加哨兵；换行/多余空白先归一，避免污染 token 流
                toks = ans.replace("\n", " ").split()
                reply = " ".join(toks) + " " + PROTO_EOM + "\n"
                proc.stdin.write(reply)
                proc.stdin.flush()
                sys.stderr.write(f"[bridge] prompt={prompt!r} -> {ans!r}\n")
            else:
                # t 的日志行：镜像到 stderr，不干扰协议通道
                sys.stderr.write(f"[t] {line}\n")
        proc.stdout.close()
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
