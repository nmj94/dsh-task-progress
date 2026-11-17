# DSH 任务进度查询

**简体中文** · [English](README.en.md)

在 DeepSeek Harness 执行任务时，用所选模型解释当前进度。可以选当前任务的模型，查询与原任务并行运行。

## 安装

发行包名为 `dsh-progress-observer`。npm 上的 `dsh-task-progress` 是另一个项目。

1. 从 [GitHub Releases](https://github.com/nmj94/dsh-task-progress/releases/latest) 下载 `dsh-progress-observer-0.3.0.tgz`。
2. 在 DSH Desktop 打开 **插件 → 添加插件**，输入安装包的绝对路径，安装并启用。若已安装本项目的旧版，先在插件列表卸载旧版。

## 使用

1. 在当前会话的输入框工具栏点 **查看进度**。从 DSH 已配置的模型中选择一个查询模型。
2. 点 **查询进度**。需要更具体的信息时，可以在弹窗里填写问题，例如「现在卡在哪一步？」。

使用斜杠命令时，`/progress` 默认使用当前任务的模型。`/progress --models` 会显示供应商和模型 ID。执行 `/progress --model 供应商/模型`，还可以在后面补充一个问题。

经常使用同一个模型时，可在桌面 profile 的 `cordis.patch.yml` 里追加以下配置。把 `provider/model-id` 改成 `/progress --models` 列出的实际值，重开 DSH 后即可输入 `/progress`，也可以直接问 `/progress 是否需要我审批？`。

```yaml
- id: task-progress
  config:
    model: provider/model-id
```

点击查询时，插件从 DSH 读取本轮会话快照，包含已产生的思考和回复、正在流式输出的片段、近期工具调用及返回状态、待审批事项和任务清单。即使插件在本轮开始后才启用，也能查询已经产生的记录。所选模型会收到有限长度的文字摘录，包括部分工具参数和输出。请求按该供应商的规则计费，回答反映采集时的进度。

已在 DSH 0.2.2-rc.3 的 Web 界面验证。插件使用 DSH 会话、命令和模型接口。

## 本地开发

```sh
npm test
npm pack
```
