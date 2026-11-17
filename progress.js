const ACTIVITY_LIMIT = 14;
const TOOL_ARGUMENT_KEYS = new Set([
  'command', 'cmd', 'argv', 'path', 'file', 'file_path', 'cwd', 'workdir',
  'pattern', 'query', 'url', 'description', 'script', 'target',
]);

export function clip(text, limit) {
  if (typeof text !== 'string') return '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function excerpt(text, limit) {
  return clip(clip(text, 6000)
    .replace(/-----BEGIN [^\n]*PRIVATE KEY-----[\s\S]*/g, '[private key omitted]')
    .replace(/\b(Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/(https?:\/\/)[^\s/"'<>@]+@/gi, '$1[redacted]@')
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-)[a-z0-9_-]{16,}/gi, '[redacted]')
    .replace(/(["']?\b[a-z0-9_-]*(?:api[_-]?key|token|password|secret|authorization)["']?(?:\s*[:=]\s*|\s+))(?:(?:"[^"\n]*"|'[^'\n]*')|[^\s,;}&]+)/gi, '$1[redacted]'), limit);
}

function messageText(message, type, limit) {
  let result = '';
  for (const block of message.content) {
    if (block.type !== type || !block.text.trim()) continue;
    if (result) result += '\n';
    result += excerpt(block.text, limit - result.length);
    if (result.length >= limit) break;
  }
  return result.trim();
}

function toolArguments(raw) {
  if (typeof raw !== 'string' || raw.length > 16000) return undefined;
  try {
    const values = JSON.parse(raw);
    const preview = Object.entries(values).flatMap(([key, value]) => {
      if (!TOOL_ARGUMENT_KEYS.has(key)) return [];
      if (typeof value === 'string') return [`${key}: ${excerpt(value, 220)}`];
      if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
        return [`${key}: ${excerpt(value.slice(0, 8).join(' '), 220)}`];
      }
      return [];
    });
    return clip(preview.join('\n'), 380) || undefined;
  } catch {
    return undefined;
  }
}

function readAssistantStream(records) {
  const text = new Map();
  const reasoning = new Map();
  const toolNames = new Set();
  function add(target, index, fragments) {
    let value = target.get(index) ?? '';
    for (const fragment of fragments) value = (value + fragment.slice(-2600)).slice(-2600);
    target.set(index, value);
  }

  for (const record of records) {
    if (record.type === 'text-chunks') add(text, record.index, record.texts);
    if (record.type === 'reasoning-chunks') add(reasoning, record.index, record.texts);
    if (record.type === 'tool-call-chunks' && record.name) toolNames.add(record.name);
    if (record.type !== 'chunk') continue;
    const chunk = record.chunk;
    if (chunk.type === 'text-delta') add(text, chunk.index, [chunk.text]);
    if (chunk.type === 'reasoning-delta') add(reasoning, chunk.index, [chunk.text]);
    if (chunk.type === 'tool-call-delta' && chunk.name) toolNames.add(chunk.name);
    if (chunk.type === 'block-end') {
      if (chunk.block.type === 'text') text.set(chunk.index, chunk.block.text.slice(-2600));
      if (chunk.block.type === 'reasoning') reasoning.set(chunk.index, chunk.block.text.slice(-2600));
      if (chunk.block.type === 'tool-call') toolNames.add(chunk.block.name);
    }
  }

  return {
    text: excerpt([...text.values()].join('\n').slice(-800), 800).trim() || undefined,
    reasoning: excerpt([...reasoning.values()].join('\n').slice(-2600), 2600).trim() || undefined,
    formingToolCalls: [...toolNames].slice(0, 8).map(tool => clip(tool, 100)),
  };
}

function summarize(opening, agent, now) {
  const events = opening.records.map(record => record.event);
  const start = events.findLastIndex(event => event.type === 'turn/start');
  const boundary = events[start];
  const tools = new Map();
  const approvals = new Map();
  const recentActivity = [];
  let task;
  let step;
  let todos = [];
  let settled;

  function addActivity(entry) {
    recentActivity.push(entry);
    if (recentActivity.length > ACTIVITY_LIMIT) recentActivity.shift();
  }

  for (let index = start + 1; index < events.length; index++) {
    const { type, data, time } = events[index];
    switch (type) {
      case 'turn/end':
        settled = data.reason.kind;
        break;
      case 'step/start':
        step = data.step;
        break;
      case 'user/message': {
        if (data.source.kind !== 'user') break;
        const text = messageText(data, 'text', 1600);
        if (!text) break;
        if (!task) task = text;
        else addActivity({ type: 'user_update', text: clip(text, 500) });
        break;
      }
      case 'assistant/message': {
        const text = messageText(data.message, 'text', 500);
        const reasoning = messageText(data.message, 'reasoning', 650);
        if (text || reasoning) addActivity({ type: 'assistant_update', text: text || undefined, reasoning: reasoning || undefined });
        break;
      }
      case 'tool/call': {
        const tool = clip(data.name, 100);
        const args = toolArguments(data.arguments);
        tools.set(data.callId, { tool, args, calledAt: time });
        addActivity({ type: 'tool_called', tool, args });
        break;
      }
      case 'tool/result': {
        const call = tools.get(data.message.toolCallId);
        tools.delete(data.message.toolCallId);
        addActivity({
          type: 'tool_finished',
          tool: call?.tool,
          args: call?.args,
          outcome: data.error || data.message.isError ? 'error' : 'returned',
          errorCode: data.error?.code,
          output: messageText(data.message, 'text', 320) || undefined,
        });
        break;
      }
      case 'approval/asked':
        approvals.set(data.id, clip(data.toolName, 100));
        break;
      case 'approval/decided':
        approvals.delete(data.id);
        break;
      case 'todo/write':
        todos = data.todos.slice(0, 10).map(({ content, status }) => ({ text: excerpt(content, 180), status }));
        break;
    }
  }

  const activeAttempt = opening.assistantStream?.activeAttempt;
  const live = activeAttempt && (!boundary || activeAttempt.turn === boundary.data.turn) && !settled
    ? readAssistantStream(activeAttempt.stream) : undefined;
  return {
    capturedAt: new Date(now).toISOString(),
    elapsedSeconds: boundary ? Math.max(0, Math.floor((now - boundary.time) / 1000)) : undefined,
    running: agent.status === 'running' && !settled,
    turnOutcome: settled,
    task,
    step: live ? activeAttempt.step : step,
    waitingForApproval: [...approvals.values()].slice(0, 8),
    pendingTools: settled ? [] : [...tools.values()].slice(-8).map(({ calledAt, ...call }) => ({
      ...call, secondsSinceCall: Math.max(0, Math.floor((now - calledAt) / 1000)),
    })),
    modelStreaming: Boolean(live),
    visibleDraft: live?.text,
    liveReasoning: live?.reasoning,
    formingToolCalls: live?.formingToolCalls,
    todos,
    recentActivity,
  };
}

export async function readProgress(controller, agent, signal) {
  const { header } = agent.session;
  const address = header.origin === 'subagent' && header.parentSession
    ? { kind: 'subagent', childSessionId: agent.id, parentSessionId: header.parentSession, mode: 'unknown' }
    : { kind: 'session', sessionId: agent.id };
  // DSH puts the committed log and current in-flight assistant attempt in the opening frame.
  // Returning from the iterator closes its subscription immediately.
  for await (const opening of controller.follow({
    address,
    assistantStream: true,
    maxMessages: 80,
    turnWindow: { minMessages: 1, minTurns: 1 },
  }, signal)) {
    if (opening.type === 'snapshot') return summarize(opening, agent, Date.now());
  }
  throw new Error('DSH did not return a live session snapshot');
}
