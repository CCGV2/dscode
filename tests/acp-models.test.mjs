import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredProvider, configuredModels } from '../plugins/acp/models.mjs';
import { keyRef } from '../plugins/custom/config.mjs';

function fixture() {
  const facts = new Map(), profiles = [], descriptors = [], declarations = [];
  const services = {
    credentials: { async describe(ref) { const value = facts.get(ref); if (value instanceof Error) throw value; return value ?? { configured: false }; } },
    dscodeCustom: { providers: profiles },
    settings: { describe(options) { assert.deepEqual(options, { redactSecrets: true }); return descriptors; } },
  };
  const llm = {
    listConfigurableProviders() { assert.equal(this, llm); return declarations; },
    listProviders() { assert.equal(this, llm); return [{ id: 'openrouter', name: 'OpenRouter' }]; },
    async listModels(provider) { assert.equal(this, llm); return [{ provider, id: 'model', name: 'Model' }]; },
    resolveCallConfig(selection) { assert.equal(this, llm); return selection; },
    marker: 'original',
  };
  return { facts, profiles, descriptors, declarations, services, ctx: { llm, get: name => services[name] } };
}

test('ACP lists key-based providers only when credential metadata says configured', async () => {
  const f = fixture();
  for (const [provider, ref] of [['openrouter', 'OPENROUTER_API_KEY'], ['grok', 'GROK_CLI_TOKEN'], ['opencode-go', 'OPENCODE_OAUTH'], ['deepseek-official', 'DEEPSEEK_API_KEY']]) {
    assert.equal(await configuredProvider(f.ctx, provider), false);
    for (const source of ['env', 'file', 'account']) {
      f.facts.set(ref, { configured: true, source });
      assert.equal(await configuredProvider(f.ctx, provider), true);
    }
    f.facts.set(ref, new Error('credential lookup failed'));
    assert.equal(await configuredProvider(f.ctx, provider), false);
  }
});

test('ACP honors the actual settings credential reference, including nested provider profiles', async () => {
  const f = fixture();
  f.declarations.push({ provider: 'openrouter', settingsNs: 'route', settingsPath: ['providers', 'custom'] });
  f.descriptors.push({ ns: 'route', value: { providers: { custom: { apiKeyEnv: 'ALTERNATE_KEY' } } } });
  f.facts.set('OPENROUTER_API_KEY', { configured: true });
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false, 'a key for a different configured reference is not used');
  f.facts.set('ALTERNATE_KEY', { configured: true });
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), true);
  f.descriptors[0].value.providers = null;
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false, 'an unresolved declared profile is not configured');
  f.descriptors.length = 0;
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false);
});

test('ACP supports declared third-party keys and provider aliases, but not management keys', async () => {
  const f = fixture();
  f.facts.set('OPENROUTER_MANAGEMENT_KEY', { configured: true });
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false);
  f.facts.set('OPENROUTER_API_KEY', { configured: true });
  assert.equal(await configuredProvider(f.ctx, 'dscode-openrouter'), true);
  f.declarations.push({ provider: 'third-party', settingsNs: 'third-party', settingsPath: [] });
  f.descriptors.push({ ns: 'third-party', value: { apiKeyEnv: 'THIRD_PARTY_KEY' } });
  assert.equal(await configuredProvider(f.ctx, 'third-party'), false);
  f.facts.set('THIRD_PARTY_KEY', { configured: true });
  assert.equal(await configuredProvider(f.ctx, 'third-party'), true);
  f.services.settings.describe = () => { throw Error('settings unavailable'); };
  assert.equal(await configuredProvider(f.ctx, 'third-party'), false);
});

test('ACP includes saved no-auth custom endpoints and requires credentials for authenticated ones', async () => {
  const f = fixture();
  f.profiles.push({ id: 'custom-local', auth: 'none' }, { id: 'custom-keyed', auth: 'bearer' });
  assert.equal(await configuredProvider(f.ctx, 'custom-local'), true);
  assert.equal(await configuredProvider(f.ctx, 'custom-keyed'), false);
  f.facts.set(keyRef('custom-keyed'), { configured: true });
  assert.equal(await configuredProvider(f.ctx, 'custom-keyed'), true);
  f.profiles[1].auth = 'x-api-key';
  assert.equal(await configuredProvider(f.ctx, 'custom-keyed'), true);
  f.facts.clear();
  assert.equal(await configuredProvider(f.ctx, 'custom-keyed'), false);
  assert.equal(await configuredProvider(f.ctx, 'custom-removed'), false);
});

test('ACP keeps the DeepSeek account and API-key routes separate', async () => {
  const f = fixture();
  f.services.deepseekAccount = { async getState() { return { status: 'credential-stored' }; } };
  assert.equal(await configuredProvider(f.ctx, 'deepseek-account'), true);
  assert.equal(await configuredProvider(f.ctx, 'deepseek-official'), false);
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false);
  f.services.deepseekAccount.getState = async () => ({ status: 'signed-out' });
  assert.equal(await configuredProvider(f.ctx, 'deepseek-account'), false);
  f.services.deepseekAccount.getState = async () => { throw Error('account unavailable'); };
  assert.equal(await configuredProvider(f.ctx, 'deepseek-account'), false);
  f.facts.set('DEEPSEEK_API_KEY', { configured: true });
  assert.equal(await configuredProvider(f.ctx, 'deepseek-official'), true, 'a valid key remains configured when account state is unavailable');
});

test('ACP recognizes provider login records and fails closed for unknown or unreadable configuration', async () => {
  const f = fixture();
  f.services.authorization = { list: () => [{ key: 'llm-pi-ai/anthropic' }, { key: 'unrelated/openrouter' }] };
  f.services.credentials.describeRecord = async key => ({ configured: key === 'llm-pi-ai/anthropic' });
  assert.equal(await configuredProvider(f.ctx, 'anthropic'), true);
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false);
  assert.equal(await configuredProvider(f.ctx, 'unknown'), false);
  f.services.credentials.describeRecord = async () => { throw Error('record unavailable'); };
  assert.equal(await configuredProvider(f.ctx, 'anthropic'), false);
  delete f.services.credentials;
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false);
  f.services.settings.describe = () => { throw Error('settings unavailable'); };
  assert.equal(await configuredProvider(f.ctx, 'openrouter'), false);
});

test('ACP filters catalog lookup without changing the shared LLM service or exact model routing', async () => {
  const f = fixture(), wrapped = configuredModels(f.ctx);
  let calls = 0;
  const listModels = f.ctx.llm.listModels;
  f.ctx.llm.listModels = function (provider) { calls++; return listModels.call(this, provider); };
  assert.deepEqual(await wrapped.listModels('openrouter'), []);
  assert.equal(calls, 0, 'unconfigured providers must not fetch their catalogs');
  assert.equal((await f.ctx.llm.listModels('openrouter')).length, 1, 'TUI catalog is unchanged');
  f.facts.set('OPENROUTER_API_KEY', { configured: true });
  assert.equal((await wrapped.listModels('openrouter')).length, 1, 'fresh option reads observe new credentials');
  f.facts.clear();
  assert.deepEqual(await wrapped.listModels('openrouter'), [], 'credential removal is observed without caching');
  assert.deepEqual(wrapped.listProviders(), f.ctx.llm.listProviders());
  const selection = { provider: 'openrouter', model: 'explicit' };
  assert.equal(wrapped.resolveCallConfig(selection), selection);
  assert.equal(wrapped.marker, 'original');
});
