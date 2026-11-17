import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../index.js';

function harness(llm, config, opening) {
  let command;
  let disposed = 0;
  let followed = 0;
  apply({
    llm,
    on() {},
    commands: { register: definition => { command = definition; } },
    sessionController: {
      async *follow(request, signal) {
        followed++;
        assert.deepEqual(request.address, { kind: 'session', sessionId: 'running' });
        assert.equal(request.assistantStream, true);
        signal.throwIfAborted();
        try {
          yield opening ?? { type: 'snapshot', records: [] };
          assert.fail('A progress query must only consume the opening snapshot');
        } finally {
          disposed++;
        }
      },
    },
  }, config);

  const session = { header: {}, requestHeader: () => ({ config: { provider: 'test', model: 'main', maxTokens: 5000 } }) };
  const agent = { id: 'running', status: 'running', session };
  const signal = new AbortController().signal;
  return {
    agent, command,
    stats: () => ({ followed, disposed }),
    invoke: rawInput => command.handler({ agent, rawInput, signal }),
  };
}

function event(type, data) {
  return { type: 'event', event: { type, data, time: Date.now() } };
}

test('queries the same model using reasoning and tools from a turn already in progress', async () => {
  let request;
  const opening = {
    type: 'snapshot',
    records: [
      event('turn/start', { turn: 1 }),
      event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '上一轮的请求' }] }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event('turn/start', { turn: 2 }),
      event('step/start', { turn: 2, step: 1 }),
      event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '更新报告' }] }),
      event('assistant/message', { message: { content: [{ type: 'reasoning', text: '先检查报告' }] } }),
      event('tool/call', { callId: 'call-1', name: 'read', arguments: '{"path":"report.md"}' }),
      event('tool/call', { callId: 'call-2', name: 'exec', arguments: '{"cmd":"TOKEN=secret-value npm test","password":"tricky-password"}' }),
      event('tool/result', { message: { toolCallId: 'call-2', isError: true, content: [{ type: 'text', text: '测试失败。Authorization: Bearer secret-token。Basic secret-encoded。https://user:secret-url@example.test' }] } }),
      event('approval/asked', { id: 'pending', toolName: 'edit' }),
      event('approval/asked', { id: 'decided', toolName: 'read' }),
      event('approval/decided', { id: 'decided', outcome: 'allowed-once' }),
    ],
    assistantStream: { activeAttempt: { turn: 2, step: 2, stream: [
      { type: 'reasoning-chunks', index: 0, texts: ['正在核对', '测试失败的原因'] },
      { type: 'chunk', chunk: { type: 'reasoning-delta', index: 0, text: '。' } },
      { type: 'text-chunks', index: 1, texts: ['正在排查'] },
      { type: 'tool-call-chunks', index: 2, name: 'grep', args: ['{'] },
    ] } },
  };
  const app = harness({
    async prepareCall(config) {
      assert.deepEqual(config, { provider: 'test', model: 'main', maxTokens: 1200 });
      return {
        config,
        async *stream(options) {
          request = options;
          yield { type: 'text-delta', index: 0, text: '正在排查测试失败。' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: '正在排查测试失败。' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  }, undefined, opening);

  const answer = await app.invoke('有什么阻塞？');
  assert.equal(answer.kind, 'success');
  assert.match(answer.text, /正在排查测试失败。$/);
  assert.equal(app.agent.status, 'running');
  assert.deepEqual(app.stats(), { followed: 1, disposed: 1 });
  assert.equal(app.command.recordInput, false);
  assert.equal(request.tools, undefined);
  const text = request.messages[0].content[0].text;
  assert.doesNotMatch(text, /secret-value|secret-token|secret-encoded|secret-url|tricky-password|上一轮的请求/);
  const { question, snapshot } = JSON.parse(text);
  assert.equal(question, '有什么阻塞？');
  assert.equal(snapshot.task, '更新报告');
  assert.equal(snapshot.liveReasoning, '正在核对测试失败的原因。');
  assert.equal(snapshot.visibleDraft, '正在排查');
  assert.equal(snapshot.step, 2);
  assert.deepEqual(snapshot.formingToolCalls, ['grep']);
  assert.equal(snapshot.pendingTools[0].tool, 'read');
  assert.equal(snapshot.pendingTools[0].args, 'path: report.md');
  assert.deepEqual(snapshot.waitingForApproval, ['edit']);
  assert.equal(snapshot.recentActivity.at(-1).outcome, 'error');
  assert.match(snapshot.recentActivity.at(-1).output, /测试失败/);
});

test('contains the current model in discovery and keeps idle and concurrent guards', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const app = harness({
    listProviders: () => [{ id: 'test' }],
    listModels: async () => [{ id: 'main' }, { id: 'second' }],
    async prepareCall(config) {
      await waiting;
      return { config, async *stream() { yield { type: 'text-delta', index: 0, text: '处理中' }; } };
    },
  }, { model: 'test/second' });
  assert.match((await app.invoke('--models')).text, /test\/main/);
  const query = app.invoke('--model test/main');
  assert.match((await app.invoke('')).text, /已有一次/);
  finish();
  assert.equal((await query).kind, 'success');
  app.agent.status = 'idle';
  assert.match((await app.invoke('')).text, /没有正在执行/);
  assert.deepEqual(app.stats(), { followed: 1, disposed: 1 });
});
