import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';

/** Exercise the native scheduler's live and cold-session delivery without inference. */
export async function probeSchedule(ctx) {
  const received = [];
  class Adapter extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id, context: { contextWindow: 100000 } }; }
    async *stream(options) {
      received.push(options.messages.at(-1));
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SCHEDULE_FIXTURE_ACK' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['schedule-fixture'], new Adapter());
  for (const cold of [false, true]) {
    const sessionId = `schedule-probe-${randomUUID()}`;
    const handle = await ctx.agents.create({
      sessionId, meta: { cwd: process.cwd(), agentPreset: 'dscode' },
      agentOptions: { provider: 'schedule-fixture', model: 'fixture' },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'dscode'); },
    });
    let record;
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Seed the persisted fixture model selection.' }], source: { kind: 'user' } }));
      await handle.agent.whenIdle();
      const marker = `SCHEDULE_${cold ? 'COLD' : 'LIVE'}_${randomUUID()}`;
      record = await ctx.schedule.create(sessionId, { title: 'Upgrade fixture', prompt: marker, after_seconds: 1 });
      assert((await ctx.schedule.list({ sessionId })).some(row => row.id === record.id));
      if (cold) {
        await ctx.sessions.flush(handle.agent.session);
        await handle.dispose();
        assert.equal(ctx.agents.get(sessionId), undefined);
      }
      const deadline = Date.now() + 10000;
      while (!received.some(message => message.source?.kind === 'schedule' && JSON.stringify(message.content).includes(marker)) && Date.now() < deadline) await delay(25);
      assert(received.some(message => message.source?.kind === 'schedule' && JSON.stringify(message.content).includes(marker)), `${cold ? 'Cold' : 'Live'} reminder did not reach the fixture adapter`);
      await ctx.agents.get(sessionId)?.whenIdle();
    } finally {
      if (record) await ctx.schedule.delete({ sessionId, id: record.id });
      // A cold resume belongs to the native controller and drains with that
      // service at Host shutdown; this handle owns only the original Agent.
      await handle.dispose();
    }
  }
  return 'live delivery and persisted-session resume passed (local fixture model)';
}
