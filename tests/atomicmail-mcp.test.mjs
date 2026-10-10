import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { DOCS_SECTION } from '../plugins/dscode/index.mjs';

test('Atomic Mail context and subprocess exist only while its MCP entry is enabled', { timeout: 15000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dscode-atomicmail-'));
  const started = join(home, 'started');
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(Loader, { baseUrl: new URL('../', import.meta.url).href });
    ctx.systemPrompt.section({ name: 'dscode:docs', order: 1052, text: DOCS_SECTION });
    const empty = async () => {
      const assembly = await ctx.systemPrompt.assemble();
      assert(!assembly.tools.some(tool => tool.name.startsWith('mcp__atomicmail__')));
      assert.doesNotMatch(renderPrompt(assembly), /atomic.?mail/i);
    };
    await empty();
    const example = parse(await readFile(new URL('../config/mcp.local.example.yml', import.meta.url), 'utf8'));
    const entry = example.flatMap(row => row.insert ?? []).find(row => row.id === 'mcp-atomicmail');
    assert.equal(entry.disabled, true);
    const config = { ...entry.config, command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/atomicmail-mcp.mjs', import.meta.url)), started] };
    await ctx.loader.root.update([{ ...entry, config }]);
    await ctx.loader.await();
    await empty();
    assert.equal(existsSync(started), false, 'A disabled entry must not start the server');

    await ctx.loader.update(entry.id, { disabled: false });
    await ctx.loader.await();
    const active = await ctx.systemPrompt.assemble();
    assert.deepEqual(active.tools.map(tool => tool.name).sort(),
      ['mcp__atomicmail__help', 'mcp__atomicmail__jmap_request', 'mcp__atomicmail__register']);
    assert.match(renderPrompt(active), /Atomic Mail fixture: call help/);
    assert.match(await readFile(started, 'utf8'), /^started\n/);

    await ctx.loader.update(entry.id, { disabled: true });
    await ctx.loader.await();
    await empty();
    await ctx.loader.update(entry.id, { disabled: false });
    await ctx.loader.await();
    assert.equal((await ctx.systemPrompt.assemble()).tools.length, 3);
    ctx.loader.remove(entry.id);
    await ctx.loader.await();
    await empty();
  } finally {
    await ctx.fiber.dispose();
    await rm(home, { recursive: true, force: true });
  }
});
