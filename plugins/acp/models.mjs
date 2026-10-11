import { credentialKeyId, credentialKeyScope } from '@deepseek-ai/dsh-credentials';
import { isCustomId, keyRef } from '../custom/config.mjs';
import { providerSpec } from '../providers/catalog.mjs';

function credentialReference(ctx, provider) {
  const entry = ctx.llm.listConfigurableProviders?.().find(entry => entry.provider === provider);
  if (!entry) return providerSpec(provider)?.credentialRef;
  const descriptor = ctx.get('settings')?.describe({ redactSecrets: true }).find(item => item.ns === entry.settingsNs);
  const profile = entry.settingsPath.reduce((value, key) => value?.[key], descriptor?.value);
  return typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined;
}

/** Local configuration facts only: no secret values or inference requests. */
export async function configuredProvider(ctx, provider) {
  try {
    const credentials = ctx.get('credentials');
    if (isCustomId(provider)) {
      const profile = ctx.get('dscodeCustom')?.providers.find(profile => profile.id === provider);
      return !!profile && (profile.auth === 'none' || (await credentials?.describe(keyRef(provider)))?.configured === true);
    }
    // Harness 0.2 separates the account route from the API-key route.
    if (provider === 'deepseek-account') {
      return (await ctx.get('deepseekAccount')?.getState())?.status === 'credential-stored';
    }
    const ref = credentialReference(ctx, provider);
    if (ref && (await credentials?.describe(ref))?.configured === true) return true;
    const entries = ctx.get('authorization')?.list() ?? [];
    for (const { key } of entries) {
      if (credentialKeyScope(key) === 'llm-pi-ai' && credentialKeyId(key) === provider
        && (await credentials?.describeRecord(key))?.configured === true) return true;
    }
  } catch {
    // One unavailable configuration source must not break the ACP picker.
  }
  return false;
}

/** Scope discovery to ACP; native routing and the shared TUI catalog stay intact. */
export function configuredModels(ctx) {
  return new Proxy(ctx.llm, {
    get(target, key) {
      if (key === 'listModels') return async provider => await configuredProvider(ctx, provider) ? target.listModels(provider) : [];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
