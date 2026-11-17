# DSH Task Progress Observer

[简体中文](README.md) · **English**

Ask a second model what DeepSeek Harness is doing while a task is running. The progress query runs alongside the original task.

## Install

The distribution is named `dsh-progress-observer`. The npm package named `dsh-task-progress` belongs to another project.

1. Download `dsh-progress-observer-0.2.1.tgz` from [GitHub Releases](https://github.com/nmj94/dsh-task-progress/releases/latest).
2. In DSH Desktop, go to **Plugins → Add plugin**, enter the absolute path to the archive, and enable the plugin. If you installed version `0.1.0` or `0.2.0` of this project, remove that version first.

## Use

1. In the conversation toolbar, click **查看进度** (View progress) and select another model configured in DSH.
2. Click **查询进度** (Check progress). You can also enter a question such as “Which step is blocked?” The current plugin UI is in Chinese.

For the slash-command workflow, use `/progress --models` to find the provider and model IDs, then run `/progress --model provider/model-id`. You can append a question to that command.

To set a default model, add this entry to your Desktop profile's `cordis.patch.yml`. Replace `provider/model-id` with your preferred route and restart DSH. You can then type `/progress` or ask a question such as `/progress Does anything need my approval?`.

```yaml
- id: task-progress
  config:
    model: provider/model-id
```

The selected model receives a timestamped text snapshot with the current task, excerpts of visible replies, recent tool names and statuses, pending approvals, and to-dos. The snapshot excludes private reasoning, attachments, tool arguments, and tool output. The request uses a provider configured in DSH and may incur its usual charges. The original task can advance while the observer is preparing its answer.

The plugin begins collecting progress from the first turn that starts after activation. If a task was already running when you enabled the plugin, try again during its next turn.

The workflow was tested in the DSH `0.2.2-rc.3` Web UI. The plugin uses DSH's session, command, and model interfaces.

## Local development

```sh
npm test
npm pack
```
