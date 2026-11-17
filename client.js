window.__ModuleLoader__.load({
  id: 'dsh-progress-observer',
  factory(require) {
    const { createElement: h, useId, useRef, useState } = require('react');
    const slot = 'conversation.input.right';
    const storageKey = 'dsh-task-progress.preferred-model';

    const css = `
      .dsh-task-progress-button {
        border: 0;
        border-radius: 8px;
        padding: 5px 8px;
        background: transparent;
        color: var(--dsw-alias-label-secondary, inherit);
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
        cursor: pointer;
      }
      .dsh-task-progress-button:hover { background: var(--dsw-alias-interactive-bg-hover, #8882); }
      .dsh-task-progress-dialog {
        box-sizing: border-box;
        width: min(440px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        padding: 20px;
        border: 1px solid var(--dsw-alias-border-l2, #8884);
        border-radius: 16px;
        background: var(--dsw-alias-bg-base, Canvas);
        color: var(--dsw-alias-label-primary, CanvasText);
        box-shadow: 0 16px 56px #0003;
      }
      .dsh-task-progress-dialog::backdrop { background: #11151d55; }
      .dsh-task-progress-dialog header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; }
      .dsh-task-progress-dialog h2 { margin: 0; font-size: 16px; font-weight: 600; }
      .dsh-task-progress-dialog form, .dsh-task-progress-dialog label { display: grid; gap: 6px; }
      .dsh-task-progress-dialog form { gap: 12px; }
      .dsh-task-progress-dialog label { font-size: 13px; font-weight: 500; }
      .dsh-task-progress-dialog :is(select, textarea) {
        box-sizing: border-box;
        width: 100%;
        padding: 7px 9px;
        border: 1px solid var(--dsw-alias-border-l2, #8885);
        border-radius: 8px;
        color: inherit;
        background: var(--dsw-alias-bg-base, Canvas);
        font: inherit;
        font-weight: normal;
      }
      .dsh-task-progress-dialog textarea { resize: vertical; }
      .dsh-task-progress-dialog footer { display: flex; justify-content: flex-end; }
      .dsh-task-progress-query {
        border: 0;
        border-radius: 8px;
        padding: 7px 12px;
        color: var(--dsw-alias-label-on-color, white);
        background: var(--dsw-alias-button-info-fill, #3358d4);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .dsh-task-progress-query:disabled { opacity: .48; cursor: default; }
      .dsh-task-progress-status { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary, inherit); }
      .dsh-task-progress-answer { margin: 12px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.6; }
      .dsh-task-progress-error { color: var(--dsw-alias-state-error-primary, #b03434); }
    `;

    function rememberedModel() {
      try { return window.localStorage.getItem(storageKey) ?? ''; }
      catch { return ''; }
    }

    function rememberModel(key) {
      try { window.localStorage.setItem(storageKey, key); }
      catch { /* The current selection still works with storage disabled. */ }
    }

    function ProgressButton({ useSession, useProjection, listModels, askProgress }) {
      const running = useSession(session => Boolean(session?.running));
      const selection = useProjection('modelSelection');
      const activeModel = running
        ? selection?.lastUsed?.model ?? selection?.next?.model
        : selection?.next?.model ?? selection?.lastUsed?.model;
      const headingId = useId();
      const dialog = useRef(null);
      const trigger = useRef(null);
      const loading = useRef(false);
      const inFlight = useRef(false);
      const [catalog, setCatalog] = useState(null);
      const [catalogError, setCatalogError] = useState(false);
      const [selected, setSelected] = useState(rememberedModel);
      const [question, setQuestion] = useState('');
      const [busy, setBusy] = useState(false);
      const [answer, setAnswer] = useState(null);

      const groups = catalog?.groups.map(group => ({
        ...group,
        models: group.models.filter(model => model.id !== (activeModel ?? catalog.default?.model)),
      })).filter(group => group.models.length) ?? [];
      const routes = groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`));
      const route = routes.includes(selected) ? selected : '';

      async function refreshCatalog() {
        if (loading.current) return;
        loading.current = true;
        setCatalogError(false);
        try {
          setCatalog(await listModels());
        } catch {
          setCatalogError(true);
        } finally {
          loading.current = false;
        }
      }

      function openDialog() {
        dialog.current?.showModal();
        void refreshCatalog();
      }

      async function submit(event) {
        event.preventDefault();
        if (!running || !route || inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setAnswer(null);
        try {
          setAnswer(await askProgress(route, question.trim()));
        } catch {
          setAnswer({ kind: 'error', text: '进度查询未收到响应，请重试。' });
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      }

      const modelOptions = groups.map(group => h('optgroup', { key: group.id, label: group.name },
        group.models.map(model => h('option', { key: model.id, value: `${group.id}/${model.id}` }, model.name))));

      return h('div', null,
        h('style', null, css),
        h('button', {
          ref: trigger, type: 'button', className: 'dsh-task-progress-button',
          'aria-haspopup': 'dialog', onClick: openDialog,
        }, '查看进度'),
        h('dialog', {
          ref: dialog, className: 'dsh-task-progress-dialog', 'aria-labelledby': headingId,
          onClose: () => trigger.current?.focus(),
        },
        h('header', null,
          h('h2', { id: headingId }, '任务进度'),
          h('button', { type: 'button', className: 'dsh-task-progress-button', onClick: () => dialog.current?.close() }, '关闭')),
        h('form', { onSubmit: submit },
          h('label', null, '查询模型',
            h('select', {
              value: route, disabled: !routes.length || busy,
              onChange: event => { setSelected(event.target.value); rememberModel(event.target.value); },
            }, h('option', { value: '' }, '选择另一个模型'), modelOptions)),
          catalogError
            ? h('div', { className: 'dsh-task-progress-status' }, '模型列表加载失败。',
              h('button', { type: 'button', className: 'dsh-task-progress-button', onClick: refreshCatalog }, '重试'))
            : !catalog
              ? h('p', { className: 'dsh-task-progress-status', role: 'status' }, '正在加载模型…')
              : !routes.length
                ? h('p', { className: 'dsh-task-progress-status' }, '请先在 DSH 的「设置 → 模型」中添加另一个模型。')
                : null,
          h('label', null, '想问什么（可选）',
            h('textarea', {
              rows: 2, maxLength: 500, value: question, disabled: busy,
              placeholder: '例如：目前卡在哪一步？', onChange: event => setQuestion(event.target.value),
            })),
          !running && h('p', { className: 'dsh-task-progress-status' }, '当前会话空闲。任务运行时可以查询。'),
          h('footer', null, h('button', {
            type: 'submit', className: 'dsh-task-progress-query', disabled: !running || !route || busy,
          }, busy ? '正在查询…' : '查询进度'))),
        answer && h('p', {
          className: `dsh-task-progress-answer${answer.kind === 'error' ? ' dsh-task-progress-error' : ''}`,
          role: answer.kind === 'error' ? 'alert' : 'status',
        }, answer.text)));
    }

    function apply(ctx) {
      ctx.slots.inject(slot, () => ctx.slots.register({
        name: slot,
        id: 'dsh-progress-observer',
        order: 50,
        inject: sessionId => ({
          async listModels() {
            const result = await ctx.remote.session.modelCatalog();
            if (!result.ok) throw new Error('Model catalog unavailable');
            return result.value;
          },
          async askProgress(route, question) {
            const line = `/progress --model ${route}${question ? ` ${question}` : ''}`;
            const result = await ctx.remote.commands.execute(sessionId, line, []);
            if (!result.ok) throw new Error('Progress request failed');
            return result.value?.result ?? { kind: 'error', text: '进度命令未加载。请重新启用插件。' };
          },
        }),
      }, ProgressButton));
    }

    return { name: 'task-progress-ui', inject: ['slots', 'remote', 'remote.session', 'remote.commands'], apply };
  },
});
