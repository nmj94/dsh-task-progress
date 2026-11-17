import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../index.js';

function harness(llm, config) {
  const listeners = new Map();
  let command;
  apply({
    llm,
    on: (name, listener) => listeners.set(name, listener),
    commands: { register: definition => { command = definition; } },
  }, config);

  const session = { id: 'running', requestHeader: () => ({ config: { provider: 'test', model: 'main' } }) };
  const agent = { id: session.id, status: 'running', session };
  const signal = new AbortController().signal;
  return {
    agent, command,
    event: (type, data, owner = session, time = Date.now()) => listeners.get('session/event')(owner, { type, data, time }),
    stream: frame => listeners.get('agent/assistant-stream')({ agent, frame }),
    invoke: rawInput => command.handler({ agent, rawInput, signal }),
  };
}

test('asks the selected model while the main task is running and sends a bounded snapshot', async () => {
  let request;
  const app = harness({
    async prepareCall(config) {
      assert.deepEqual(config, { provider: 'test', model: 'observer', maxTokens: 1200 });
      return {
        config,
        async *stream(options) {
          request = options;
          yield { type: 'text-delta', index: 0, text: '正在读取。' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '正在读取。' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  });
  app.event('turn/start', { turn: 1 });
  app.event('step/start', { turn: 1, step: 1 });
  app.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '更新报告' }] });
  app.stream({ type: 'start', attemptId: 'a', turn: 1, step: 1 });
  app.stream({ type: 'chunk', attemptId: 'a', chunk: { type: 'reasoning-delta', text: 'private reasoning' } });
  app.stream({ type: 'chunk', attemptId: 'a', chunk: { type: 'text-delta', text: '先检查报告' } });
  app.event('tool/call', { callId: 'call-1', name: 'read', arguments: 'private tool arguments' });
  app.event('tool/call', { callId: 'call-2', name: 'edit' });
  app.event('tool/result', { message: { toolCallId: 'call-2', isError: true, content: [{ type: 'text', text: 'private tool output' }] } });
  app.event('approval/asked', { id: 'pending', toolName: 'edit' });
  app.event('approval/asked', { id: 'decided', toolName: 'read' });
  app.event('approval/decided', { id: 'decided', outcome: 'allowed-once' });
  app.event('turn/start', { turn: 2 }, { id: 'another-session' });
  app.event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'another session' }] }, { id: 'another-session' });

  const answer = await app.invoke('--model test/observer 有什么阻塞？');
  assert.equal(answer.kind, 'success');
  assert.match(answer.text, /正在读取。$/);
  assert.equal(app.agent.status, 'running');
  assert.equal(app.command.recordInput, false);
  assert.equal(request.tools, undefined);
  const text = request.messages[0].content[0].text;
  assert.doesNotMatch(text, /private|another session/);
  const { question, snapshot } = JSON.parse(text);
  assert.equal(question, '有什么阻塞？');
  assert.equal(snapshot.task, '更新报告');
  assert.equal(snapshot.visibleDraft, '先检查报告');
  assert.equal(snapshot.pendingTools[0].tool, 'read');
  assert.deepEqual(snapshot.waitingForApproval, ['edit']);
  assert.equal(snapshot.recentActivity.at(-1).outcome, 'error');
});

test('rejects the active model, idle sessions, and concurrent queries', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const app = harness({
    async prepareCall(config) {
      await waiting;
      return { config, async *stream() { yield { type: 'text-delta', index: 0, text: '处理中' }; } };
    },
  }, { model: 'test/observer' });
  app.event('turn/start', { turn: 1 });
  assert.match((await app.invoke('--model test/main')).text, /不同的模型/);
  const query = app.invoke('');
  assert.match((await app.invoke('')).text, /已有一次/);
  finish();
  assert.equal((await query).kind, 'success');
  app.event('turn/end', { turn: 1 });
  app.agent.status = 'idle';
  assert.match((await app.invoke('')).text, /没有正在执行/);
});
