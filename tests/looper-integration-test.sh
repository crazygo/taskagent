#!/bin/bash

# Looper Agent 集成测试脚本

set -e

echo "========================================="
echo "Looper Agent 集成测试"
echo "========================================="
echo ""

# 创建测试工作区
TEST_WORKSPACE="/tmp/looper-test-$(date +%s)"
mkdir -p "$TEST_WORKSPACE"
cd "$TEST_WORKSPACE"

echo "测试工作区: $TEST_WORKSPACE"
echo ""

# Test 1: Looper Status (IDLE)
echo "=== Test 1: Looper Status (空闲状态) ==="
timeout 8 yarn --cwd /Users/admin/Codespaces/aminer/taskagent start -- \
  --looper \
  -p '{"type":"status"}' \
  --workspace "$TEST_WORKSPACE" \
  --newsession \
  2>&1 | grep -E "Looper.*状态|IDLE|空闲" || echo "未找到状态输出"
echo ""

# Test 2: Simple File Creation Task
echo "=== Test 2: 简单文件创建任务 ==="
echo "任务: 创建 hello.txt 文件"
timeout 30 yarn --cwd /Users/admin/Codespaces/aminer/taskagent start -- \
  --looper \
  -p '{"type":"start","task":"创建一个 hello.txt 文件，内容为 Hello from Looper"}' \
  --workspace "$TEST_WORKSPACE" \
  --newsession \
  --auto-allow \
  2>&1 | tee /tmp/looper-test-output.log | grep -E "Looper|循环|Coder|Review|JUDGE" | head -20
echo ""

# Check results
echo "=== 检查结果 ==="
if [ -f "hello.txt" ]; then
  echo "✅ hello.txt 文件已创建"
  echo "内容:"
  cat hello.txt
else
  echo "❌ hello.txt 文件未创建"
fi
echo ""

# Test 3: Check Looper logs
echo "=== Test 3: 检查 Looper 日志 ==="
grep -E "\[AUTO\]|\[Looper\]" /tmp/looper-test-output.log | head -15 || echo "未找到 Looper 日志"
echo ""

# Cleanup
echo "=== 清理 ==="
cd /
rm -rf "$TEST_WORKSPACE"
echo "测试工作区已删除"
echo ""

echo "========================================="
echo "测试完成"
echo "========================================="
