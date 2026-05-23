# Megle Dynamic Priority Disclosure Scan Design

Updated: 2026-05-24

## 1. 背景

Megle 当前预览链路已经完成了以下方向：

- `grid_320` 运行时真相已转到 `thumb_blobs`。
- 右侧 `PreviewPanel` 使用轻预览路径。
- 中央视图最终使用原图。
- placeholder、thumbnail blob、original preview 的基本链路已经可用。

但当前扫描与可浏览性仍然不符合目标：

1. 新增根目录后，要等很久才能真正开始浏览。
2. 扫描进行中虽然目录树按钮可点击，但当前文件夹内容不会按批次持续刷新，体感上仍像“不能切文件夹”。
3. 扫描线程仍同步执行尺寸探测与 placeholder 生成，导致“去掉 320 全量预生成”后总耗时仍与旧方案接近。
4. 当前视图、右侧轻预览、中心原图预览还没有形成完整的动态优先级调度。

用户当前要求已经明确为：

- 最快看到图片清晰的预览。
- 点开图片后原图尽快显示出来。
- 动态优先级，因为用户会频繁切换文件夹。
- 接受“当前打开的文件夹和可见区优先，其他文件夹后台延后”。

## 2. 设计目标

本设计的目标不是继续压缩旧扫描批次，而是将扫描与预览生成彻底解耦，形成“当前视图优先”的系统。

必须同时满足：

1. 新增根目录后，目录与文件基础信息应尽快变成可浏览数据。
2. 扫描进行中必须允许切换已存在和新出现的文件夹。
3. 当前文件夹内容必须在扫描进行中增量出现，而不是只在任务 `succeeded` 后整体刷新。
4. 当前文件夹可见区应优先获得清晰 `grid_320` 预览。
5. 右侧 `PreviewPanel` 必须优先获得当前选中项的轻预览。
6. 中央视图必须优先获得当前项原图，并支持邻居原图预取与复用。
7. 后台其他文件夹的预览生成必须自动降级，不得阻塞当前视图。

## 3. 非目标

- 不在本次设计中重做 Liquid Glass 视觉系统。
- 不引入新的中间预览档位（例如 640 / 1600）。
- 不让 root scan 重新承担 `grid_320` 或 original 级别预处理。
- 不一次性重写所有 watcher / task 持久化架构。
- 不为了“披露式扫描”牺牲当前已有的 DB-blob runtime truth。

## 4. 根因分析

当前体验问题不是单点 bug，而是三个系统性耦合：

### 4.1 扫描线程职责过重

`scan_root_with_options(...)` 在批量写入 `files/media` 后，会同步调用 `probe_image_dimensions(...)`，后者又对每张图片做：

- header 维度探测
- `generate_preview_placeholder(...)`
- `update_media_preview_placeholder(...)`

这意味着扫描线程仍然承担了完整图像解码与编码工作。

### 4.2 批量可见性仍偏向“写完整批再看”

即使默认 `DEFAULT_SCAN_WRITE_BATCH_SIZE` 已经降低到 10，数据可见性仍取决于：

- 当前批次是否 flush
- flush 后是否完成同步 probe
- 前端是否主动重新请求当前文件夹内容

系统仍然不是“发现 -> 立即可看”。

### 4.3 前端刷新策略仍偏向“扫描完成后整体刷新”

前端扫描中主要轮询 `tasks`，并在任务从非完成态变成 `succeeded` 时整体 `loadLibrary()`。

当前缺失：

- 扫描进行中对当前 root / 当前 folder 的增量刷新
- 当前视图变化驱动预览优先级重排
- 当前文件夹与后台文件夹之间的强优先级差异

## 5. 总体方案

采用：

`Fast ingest scan + dynamic-priority preview queue + current-folder incremental refresh`

这意味着系统分成两层：

1. **Ingest 层**
   - 负责快速把目录、文件、最小媒体信息写入库
   - 不做图片预览生成
2. **Preview 层**
   - 负责 placeholder 补齐、`grid_320`、original prefetch/reuse
   - 完全由当前 UI 状态驱动优先级

扫描任务的完成定义不再是“图也准备好了”，而是“库已经变成可浏览”。

## 6. 数据边界

### 6.1 Ingest 层负责的数据

- `roots`
- `folders`
- `files`
- `media.kind`
- `media.size`
- `media.mtime`
- 其他无需完整 decode 的基础元信息

它的职责是让用户尽快看到：

- 文件夹树
- 当前文件夹中的文件名与基础项目

### 6.2 Preview 层负责的数据

- `media.preview_placeholder`
- `media.preview_placeholder_format`
- `thumbs` 目标状态
- `thumb_blobs` 的 `grid_320`
- 中心 original preview 的内存缓存/预取

Preview 层不再作为 root scan 主线程的一部分同步运行。

## 7. 动态优先级模型

预览任务按当前 UI 状态动态重排，优先级从高到低为：

1. 当前中心预览的原图
2. 中心预览前后邻居的原图预取
3. 当前选中项的 `grid_320`
4. 当前文件夹可见区的 `grid_320`
5. 当前文件夹近邻区的 `grid_320`
6. 当前文件夹 placeholder 补齐
7. 其他文件夹后台补齐

行为要求：

- 切换文件夹时，新文件夹的任务立即升权，旧文件夹后台任务立即降权。
- 打开中心预览时，当前 original 抢占所有低优先级 thumbnail 工作。
- 关闭中心预览时，系统重新把可见区 `grid_320` 作为前台任务。
- 长时间不可见、非当前文件夹的任务可以被取消或直接丢弃重建。

## 8. Ingest 扫描策略

### 8.1 root scan 只做快路径

root scan 只做：

- 目录发现
- 文件发现
- `files/media` 小批量写入
- reconciliation / mark scanned

它不再同步执行：

- placeholder 生成
- 图片尺寸 probe
- `grid_320` 生成

### 8.2 批量提交

默认写入批次继续保持小值，目标是尽快让当前文件夹进入可查询状态。

这次已将默认值从 1000 调整到 10，但真正的收益来自“去掉批后同步 decode”，不是仅靠批量大小。

### 8.3 目录树披露

目录一旦发现并落库，就应允许：

- 展开
- 选中
- 请求其 children

不要求整棵 root 扫描完成。

## 9. 前端增量刷新策略

### 9.1 当前 root / 当前 folder 刷新

扫描进行中，前端不应只等任务 `succeeded` 才整体 `loadLibrary()`。

新的规则是：

- 如果当前 root 的 `root_scan` 任务仍在 `pending/running`
- 并且当前视图停留在 `library`
- 则按节流策略持续重新拉取：
  - 当前 folder 的 `listMedia`
  - 当前展开链上的 `listFolderChildren`

### 9.2 文件夹切换

切换文件夹时：

- 立即更新 `selectedFolderId`
- 立即请求目标文件夹的 `listMedia`
- 不允许旧文件夹的后台任务阻塞这个请求

如果目标文件夹还没完全写入库：

- 内容区进入“增量发现”状态
- 随后继续增量刷新当前 folder，直到数据逐步出现

## 10. Preview 队列拆分

### 10.1 `placeholder_fill`

职责：

- 给旧库或新落库但无 placeholder 的图片补首帧占位

优先级：

- 低于可见区 `grid_320`
- 高于其他文件夹后台任务仅在当前 folder 内成立

### 10.2 `grid_thumbnail`

职责：

- 生成 `grid_320`

用途：

- Grid tile
- `PreviewPanel`

优先级：

- 当前文件夹可见区优先
- 其他全部降级

### 10.3 `original_prefetch`

职责：

- 中心预览前后邻居的 original 预取与复用

限制：

- 不落持久存储
- 只保存在小型内存缓存中

## 11. 取消与抢占

- `placeholder_fill` 可随时取消，稍后重建
- `grid_thumbnail` 对非当前视图项可取消或延后
- `original_prefetch` 在切图时立即取消旧邻居
- 当前中心原图请求除非切图，否则不应让位给低优先级 thumbnail

## 12. 三阶段落地顺序

### 阶段 1：先恢复可浏览性

目标：

- root scan 去掉同步 placeholder / probe
- 当前 folder 扫描中可切换、可增量看到内容

完成标志：

- 新加根目录后不必等扫描完成才能进入当前文件夹
- 扫描中切其他文件夹时，内容区立即切换

### 阶段 2：再恢复当前视图优先清晰化

目标：

- 当前文件夹可见区优先生成 `grid_320`
- 右侧 `PreviewPanel` 立即跟随当前选中项变清楚

完成标志：

- 当前可见区先清晰，后台其他文件夹延后
- 大面积 `queued` 不再作为主视觉

### 阶段 3：最后优化中心原图速度感

目标：

- 中心 current original 最高优先
- previous/next original 小范围预取

完成标志：

- 双击后原图尽快可见
- 连续切图时明显快于完全冷启动

## 13. 测试与验收

### 13.1 真实目录基准

使用：

- `G:\AI_Painter\stable-diffusion\stable-diffusion-webui\outputs`

验收指标：

- 从 add root 到“当前文件夹第一批内容可见”的时间
- 扫描中切文件夹是否立即生效
- 当前可见区清晰预览是否优先于后台文件夹
- 双击后 original 显示时间

### 13.2 行为验收

必须满足：

1. 扫描中可以切换到其他文件夹
2. 已切入的当前文件夹在扫描中增量出现内容
3. 当前视图先清晰，后台文件夹后清晰
4. 右侧永远使用轻预览
5. 中央视图最终使用 original

### 13.3 回归保护

- Rust tests：
  - flush 后数据立即可查
  - scan 不再绑定 placeholder 同步生成
- Web checks：
  - 当前 folder 增量刷新
  - 当前视图优先级驱动请求
- Real smoke：
  - 使用 `outputs` 目录计时

## 14. 风险与边界

### 14.1 接受的权衡

- 新增根目录时，不保证全库第一时间都清晰
- 优先保证当前正在看的内容

### 14.2 本次不做

- Core 侧复杂多 worker 持久化优先级系统
- 全局原图大缓存
- 扫描过程中对所有旧库一次性 placeholder 回填

这些可以后续继续演进，但不是这次把体验从“不能切、全是 queued、很慢”拉回来的前提。
