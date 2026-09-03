# Huxpro/octane `new-lynx@b230f8a77` LepusNG 真机摸底

- 日期：2026-09-03 UTC
- 目标：`b230f8a77d8199adb536fef4890bbc6911ef5708`
- 设备：ByteDance `aries_10` / Android 10 / Lynx Explorer 1.0
- 范围：测量阶段只改 benchmark/measurement harness；未改 Octane/Lynx 产品实现。本 PR 只提交报告与脱敏后的测量证据。

## 判决摘要

这次摸底没有产生可用于优化决策的 Octane create/FCP/clear 毫秒数。原因不是“慢”，而是两个先决条件没有同时成立：

1. E1 的静态产物门槛通过，但动态 create wire 无法验证。真机首屏能画；然而 Octane 首屏按钮在 ready 后不响应，重复 Native touch 后 rowCount 仍为 0，且没有 create timing marker。相同设备和注入方式下 ReactLynx create@1k 正常把 rowCount 变为 1000。因此 create@1k/@10k、clear→re-create 均判为 correctness-blocked DNF，不能引用毫秒。
2. #273 的 engine/ambient-`setTimeout` arm 确实在运行，但 capture 没有落到首帧之后。仪器记录 schedule=1788426436247 ms、capture=1788426436248 ms；同次 Perfetto trace 映射到 realtime 后，首个 `AnimationFrameTaskHandler::DoFrame`=1788426436249.848 ms、`FirstMeaningfulPaint`=1788426436251.951 ms。capture 分别早约 1.85 ms 和 3.95 ms。也就是说它跨了一个宏任务，但没有达到 capture-after-paint。

此外，Octane 在 0/1k/10k 三个 startup bundle 上均未发布可接受的 `Performance` `loadBundle` pipeline entry；因此 #273 的 FCP 数值端在本 Explorer 上不可观测。

## 方法

- bundle：目标提交 production LepusNG bundle，`BENCH_MTS_PROGRAM=1`；upstream 对照使用同一 benchmark checkout 的 ReactLynx bundle。
- FCP 仪器：Lynx DevTool `Performance.getAllPerformanceEntries`，边界为 `loadBundle.openTime → totalFcp/lynxFcp`；没有 pipeline 时记 DNF，不用 commit ACK 或第二帧代替。
- create 仪器：标准 Native cell 的事件 handler start → transport ACK（Octane 可见）→ 两个 Native animation frames。由于 Octane touch 未进入 handler，没有 create 数值。
- 顺序：每个完整 cell 采用 AB/BA 反转并重复，A=Octane、B=ReactLynx；每两页重启 Explorer。n=6 时两侧各 3 个冷进程 fresh-page 样本、3 个热进程 fresh-page 样本。
- 热约束：每次 load 前 thermal gate，电池温度上限 40°C。
- 不跨运行窗口比较绝对值；下表只汇总同一 cell 文件内的样本。

## 1. E1：compiled create 是否生效

### 静态产物：verified

- TASM 解码报告 `is-lepusng-binary=true`，main-thread `lepus_code` 255,168 bytes。
- main/background 两侧均包含两个完全相同的 resident-program 地址 digest：`0133b4dbe8c5613c`、`0a9cd69495631d34`。
- rspack loader 的跨线程地址校验在 build 时执行；目标 production build 成功，且解码后的两侧 digest 相同。
- profile 首屏记录 `program.bindCount=1`、`createCount=1`、`mountCount=1`，说明 resident program 在真机 main-thread chunk 中注册并执行了首屏路径。

时序是否改变：静态编译/注册机制已进入产物；但动态 create 没发生，不能判定 E1 对 create 时序的影响。

### 动态 create wire：not verified（correctness blocker）

复现：

1. 打开 profile bundle，snapshot 显示 `Create 1,000 rows` 为可交互 `@e4`。
2. `agent-lynx tap @e4` 两次；每次命令均返回 tapped。
3. 后续 snapshot 仍只有 toolbar，rowCount=0；没有 `__NATIVE_BENCH_RESULT__`。
4. 同设备 ReactLynx 控制样本用相同 touch 路径成功：rowCount=1000，单次 sanity latency=182 ms（n=1，仅用于确认输入链路，不作性能比较）。

首次 tap 后唯一可见 commit 是 first-tree adoption：68 条 `create/event/insert`，`ackEncoding=handles`，没有 `mount-program-run`，也没有 `mount-template-run`。这不是目标 dynamic create commit，不能拿来判 E1 或 compact-ACK。

时序是否改变：事件未到达 create handler，动态 create 时序不存在；结论为 unknown，不是“回退变慢”。

## 2. #273：capture 是否在首帧之后

结论：verified negative。

| 事件 | realtime ms | 相对 capture |
|---|---:|---:|
| `mtsRenderEnd` | 1788426436247.642 | -0.358 ms |
| instrumented capture | 1788426436248.000 | 0 |
| painting UI op execute start | 1788426436248.032 | +0.032 ms |
| first `DoFrame` | 1788426436249.848 | +1.848 ms |
| `FirstMeaningfulPaint` | 1788426436251.951 | +3.951 ms |

`ambientSetTimeout` 在 schedule/capture 两个 marker 中均为 `function`，所以实际 arm 是 `engine + ambient setTimeout`，没有 decline 到 inline old-order。schedule→capture 为 1 ms，证明任务边界发生变化；但 trace 证明 capture 仍早于首帧/FMP，因此“after paint”没有生效。

capture marker 使用 `Date.now()`，分辨率为 1 ms；即使按最不利的亚毫秒位置计算，首个 DoFrame 仍至少晚约 0.85 ms，FMP 至少晚约 2.95 ms，不影响先后判决。

时序是否改变：是，跨了一个约 1 ms 的宏任务；否，没有跨过首帧边界。

## 3. 三组数字

### create@1k / create@10k

| cell | Octane | ReactLynx | 判决 |
|---|---:|---:|---|
| create@1k | DNF | 未形成 n≥5 | Octane touch correctness blocker；React 仅有 182 ms n=1 输入控制，不作比较 |
| create@10k | DNF | 未运行 | 同一 blocker，停止扩展测量 |

不能回答此前 150 vs 338 ms 在 E1 后还剩多少；引用任何 create 毫秒都会违反“先验证 compiled dynamic wire”的门槛。

### FCP@0/1k/10k

| cell | Octane | ReactLynx | 仪器与生命周期 |
|---|---:|---:|---|
| FCP@0 | DNF 6/6 | median 57.414 ms；range 48.188–74.054；cold median 54.580；warm median 60.247；n=6 | DevTool `loadBundle` pipeline；AB/BA；3 cold + 3 warm |
| FCP@1k | DNF 6/6 | median 1389.247 ms；range 1320.330–1435.944；cold median 1398.754；warm median 1333.036；n=6 | 同上；独立窗口，不与 FCP@0 比绝对值 |
| FCP@10k | Octane 首样本 pipeline timeout DNF | React 连续 3 次 DevTool channel close | transport/capability DNF；未满足 n≥5，不报毫秒 |

Octane DNF 的含义是没有合格 pipeline entry，不等于 FCP 无限大，也不等于 ACK/第二帧数值。

时序是否改变：FCP 数值端 unknown；当前只 verified 了 producer 缺失。

### clear→re-create 两周期

未执行：create touch blocker 使初始 rows prestate 不可达。不能验证 compact ACK，也不能记录 clear 耗时。

首次 first-tree adoption 的 `handles` ACK 不属于 clear/re-create compact-ACK 场景，不能替代结论。

时序是否改变：unknown。

## 4. 正确性 sanity

- 首屏能画：pass；标题、toolbar、全部按钮可见。
- 首帧后/gap touch：fail；不仅 gap 未能通过，ready 后重复 tap 仍未产生 create state change。ReactLynx 同链路 pass。
- unmount/clear：blocked；没有制造 rows prestate，不继续强行测试。
- `diagnostics()`：观测到的 main-thread adoption commit `diagnosticCount=0`；dynamic create/clear 没有 commit，不能扩大为全程 pass。
- 崩溃：未见 Android `FATAL EXCEPTION`、SIGABRT 或 JNI abort。出现过 DebugRouter channel close，按 transport DNF 记录。

## 5. 机制结论

| 结论 | 状态 | 这改变了时序吗 |
|---|---|---|
| resident programs 和两侧 digest 已进入真机 LepusNG 产物 | verified | 产物机制已变；dynamic create 影响 unknown |
| dynamic create wire 是 `mount-program-run` | not verified | unknown；事件 blocker 先发生 |
| dynamic create 静默回退到 `mount-template-run` | 未观察到，不能排除 | unknown |
| #273 选择了 engine/ambient-setTimeout arm | verified | 是，schedule→capture 约 1 ms |
| capture 位于首帧之后 | verified false | 没有；capture 早于 DoFrame/FMP |
| Octane 发布了可用于 FCP 的 loadBundle pipeline | verified false（0/1k n=6；10k 首样本） | 可观测性改变；实际 FCP 时序 unknown |
| clear→re-create 保持 compact ACK | not verified | unknown |

本报告不做 owner/优化方向决策。

## 6. 证据文件

- [static-e1-evidence.json](evidence/static-e1-evidence.json)：TASM 静态验证收据；记录完整解码产物 SHA-256、LepusNG 标志、main-thread code 长度及 main/background digest 一致性。2.8 MB 完整解码产物不提交。
- [octane-b230-profile-startup.pftrace](evidence/octane-b230-profile-startup.pftrace)：同次 profile startup trace，125,991 bytes，SHA-256 `a9442bf887a74da3a0ba70776ad20ab6e12de588b1ebdc27a21a7e6b95c57fc7`。
- [octane-b230-profile-order.json](evidence/octane-b230-profile-order.json)：Perfetto realtime 顺序查询。
- [octane-b230-profile-console.txt](evidence/octane-b230-profile-console.txt)：schedule/capture marker 和 first-screen program counters。
- [octane-b230-profile-console-after-second-tap.txt](evidence/octane-b230-profile-console-after-second-tap.txt)：重复 tap 后仍无 create 的 console 证据。
- [fcp-0-ab-n6.json](evidence/fcp-0-ab-n6.json)、[fcp-1000-ab-n6.json](evidence/fcp-1000-ab-n6.json)：完成的 interleaved n=6 cells。
- [fcp-10000-ab-dnf.json](evidence/fcp-10000-ab-dnf.json)：10k transport/capability DNF。
- [react-touch-probe.json](evidence/react-touch-probe.json)：ReactLynx 输入链路控制。
- [wire-probe-1.json](evidence/wire-probe-1.json)、[wire-probe-2.json](evidence/wire-probe-2.json)、[wire-probe-3.json](evidence/wire-probe-3.json)：Octane create timeout repro 迭代记录。

JSON 证据保留原始时序和方法字段；设备序列号摘要、租约 ID 和本机绝对路径已脱敏。
