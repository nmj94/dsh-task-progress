# DSH Task Progress Observer

[简体中文](README.md) · **English**

Ask a model what DeepSeek Harness is doing while a task is running. A progress query can use the task's own model and runs alongside the original task.

## Install

The distribution is named `dsh-progress-observer`. The npm package named `dsh-task-progress` belongs to another project.

1. Download `dsh-progress-observer-0.3.0.tgz` from [GitHub Releases](https://github.com/nmj94/dsh-task-progress/releases/latest).
2. In DSH Desktop, go to **Plugins → Add plugin**, enter the absolute path to the archive, and enable the plugin. If you already installed this project, remove the earlier version first.

## Use

1. In the conversation toolbar, click **查看进度** (View progress) and select a model configured in DSH.
2. Click **查询进度** (Check progress). You can also enter a question such as “Which step is blocked?” The current plugin UI is in Chinese.

The `/progress` command uses the task's model by default. Use `/progress --models` to find provider and model IDs, then run `/progress --model provider/model-id` to choose a route. You can append a question to that command.

To set a default model, add this entry to your Desktop profile's `cordis.patch.yml`. Replace `provider/model-id` with your preferred route and restart DSH. You can then type `/progress` or ask a question such as `/progress Does anything need my approval?`.

```yaml
- id: task-progress
  config:
    model: provider/model-id
```

On request, the plugin reads the current turn from DSH. The snapshot includes reasoning and reply excerpts, the current model stream, recent tool calls and results, pending approvals, and to-dos. It can read records produced before activation during the same turn. The selected model receives bounded text excerpts, including some tool arguments and output. The provider's normal charges apply, and the answer reflects the time of capture.

The workflow was tested in the DSH `0.2.2-rc.3` Web UI. The plugin uses DSH's session, command, and model interfaces.

## Local development

```sh
npm test
npm pack
```
