const ACTIVITY_LIMIT = 16;
const LIVE_TEXT_LIMIT = 800;

export function clip(text, limit) {
  if (typeof text !== 'string') return '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function visibleText(message, limit) {
  let result = '';
  for (const block of message.content) {
    if (block.type !== 'text' || !block.text.trim()) continue;
    if (result) result += '\n';
    result += clip(block.text, limit - result.length);
    if (result.length >= limit) break;
  }
  return result.trim();
}

function addActivity(turn, entry) {
  turn.activity.push(entry);
  if (turn.activity.length > ACTIVITY_LIMIT) turn.activity.shift();
}

export function recordEvent(turns, session, event) {
  const { type, data, time } = event;
  if (type === 'turn/start') {
    turns.set(session.id, {
      number: data.turn,
      startedAt: time,
      task: '',
      activity: [],
      tools: new Map(),
      approvals: new Map(),
      todos: [],
    });
    return;
  }

  const turn = turns.get(session.id);
  if (!turn) return;

  switch (type) {
    case 'turn/end':
      if (data.turn === turn.number) turns.delete(session.id);
      break;
    case 'step/start':
      turn.step = data.step;
      break;
    case 'user/message': {
      if (data.source.kind !== 'user') break;
      const text = visibleText(data, 1600);
      if (!text) break;
      if (!turn.task) turn.task = text;
      else addActivity(turn, { type: 'user_update', text: clip(text, 500) });
      break;
    }
    case 'assistant/message': {
      const text = visibleText(data.message, 600);
      if (text) addActivity(turn, { type: 'assistant_update', text });
      break;
    }
    case 'tool/call': {
      const tool = clip(data.name, 100);
      turn.tools.set(data.callId, { tool, startedAt: time });
      addActivity(turn, { type: 'tool_called', tool });
      break;
    }
    case 'tool/result': {
      const call = turn.tools.get(data.message.toolCallId);
      if (!call) break;
      turn.tools.delete(data.message.toolCallId);
      addActivity(turn, {
        type: 'tool_finished',
        tool: call.tool,
        outcome: data.error || data.message.isError ? 'error' : 'returned',
      });
      break;
    }
    case 'approval/asked':
      turn.approvals.set(data.id, clip(data.toolName, 100));
      break;
    case 'approval/decided':
      turn.approvals.delete(data.id);
      break;
    case 'todo/write':
      turn.todos = data.todos.slice(0, 10).map(({ content, status }) => ({
        text: clip(content, 220),
        status,
      }));
      break;
  }
}

export function recordVisibleStream(turns, { agent, frame }) {
  const turn = turns.get(agent.id);
  if (!turn) return;

  if (frame.type === 'start' && frame.turn === turn.number) {
    turn.stream = { attemptId: frame.attemptId, text: '' };
  } else if (turn.stream && turn.stream.attemptId === frame.attemptId) {
    if (frame.type === 'end') delete turn.stream;
    if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') {
      turn.stream.text = clip(turn.stream.text + frame.chunk.text, LIVE_TEXT_LIMIT);
    }
  }
}

function secondsSince(start, now) {
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function snapshotProgress(turn, now = Date.now()) {
  return {
    capturedAt: new Date(now).toISOString(),
    elapsedSeconds: secondsSince(turn.startedAt, now),
    task: turn.task || undefined,
    step: turn.step,
    waitingForApproval: [...turn.approvals.values()].slice(0, 8),
    pendingTools: [...turn.tools.values()].slice(0, 8).map(call => ({
      tool: call.tool,
      secondsSinceCall: secondsSince(call.startedAt, now),
    })),
    modelStreaming: Boolean(turn.stream),
    visibleDraft: turn.stream?.text || undefined,
    todos: turn.todos,
    recentActivity: [...turn.activity],
  };
}
