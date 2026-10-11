import { replaceOnce } from './patch-util.mjs';

// These self-contained helpers are embedded into the pinned runtime modules.
export function acpFailure(error) {
  const messages = {
    TRANSPORT: 'The model connection failed. This request did not complete. You can retry.',
    TIMEOUT: 'The model request timed out. This request did not complete. You can retry.',
    MISSING_CREDENTIAL: 'Model credentials are missing. Configure the provider, then retry.',
    ACCOUNT_SIGN_IN_REQUIRED: 'The model provider requires sign-in. Sign in, then retry.',
    RATE_LIMIT: 'The model provider rate limit was reached. Wait before retrying.',
    QUOTA_EXCEEDED: 'The model provider quota was exceeded. Check your account before retrying.',
    UNKNOWN: 'The agent request failed before completion. You can retry; check diagnostics if it happens again.',
  };
  const code = Object.hasOwn(messages, error?.code ?? '') ? error.code : 'UNKNOWN';
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  // Only our own diagnostic format is forwarded; upstream messages may contain
  // URLs, response bodies or credentials. Do not stringify arbitrary errors.
  const diagnostic = code === 'TRANSPORT' && typeof error?.message === 'string'
    ? error.message.match(/^DeepSeek Messages transport failed \(((?:(?:UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE)(?:; )?)?\d+ ms)\)$/)?.[1]
    : undefined;
  return { code, message: messages[code] + (diagnostic ? ` (${diagnostic})` : ''), ...(status ? { status } : {}) };
}

export function deepSeekTransportMessage(error, elapsedMs) {
  const allowed = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE']);
  let current = error, code;
  try {
    for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
      const value = Object.getOwnPropertyDescriptor(current, 'code')?.value;
      if (allowed.has(value)) { code = value; break; }
      current = Object.getOwnPropertyDescriptor(current, 'cause')?.value;
    }
  } catch { /* Foreign error objects must not replace the original failure. */ }
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? `${Math.round(elapsedMs)} ms` : undefined;
  const detail = [code, elapsed].filter(Boolean).join('; ');
  return 'DeepSeek Messages transport failed' + (detail ? ` (${detail})` : '');
}

export function patchAcpErrors(text) {
  const marker = '// dscode-acp-errors-v1';
  if (text.includes(marker)) return text;
  text = replaceOnce(text,
    'else if (end.kind === "error") inflight.reject(internalError$1(`turn failed: ${end.error.message}`));',
    `else if (end.kind === "error") {
      const failure = acpFailure(end.error);
      const sessionId = this.agent.session.id;
      await this.notify({ sessionId, update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "dscode-error-" + inflight.turn,
        content: { type: "text", text: "\\n\\n**DSCODE — Request failed (" + failure.code + ")**\\n\\n" + failure.message },
        _meta: { "dscode.dev/status": "error" }
      } });
      inflight.reject(RequestError.internalError({ sessionId, ...failure }, failure.message));
    }`);
  return marker + '\n' + acpFailure.toString() + '\n' + text;
}

export function patchDeepSeekErrors(text) {
  const marker = '// dscode-transport-diagnostics-v1';
  if (text.includes(marker)) return text.slice(0, text.indexOf(marker)) + marker + '\n' + deepSeekTransportMessage.toString() + '\n';
  text = replaceOnce(text, '\tasync *generate(options, connection) {', '\tasync *generate(options, connection) {\n\t\tconst dscodeRequestStarted = performance.now();');
  text = replaceOnce(text, 'new LlmError("DeepSeek Messages transport failed", "TRANSPORT", { cause: error })', 'new LlmError(deepSeekTransportMessage(error, performance.now() - dscodeRequestStarted), "TRANSPORT", { cause: error })');
  // Append so patchDeepSeek can continue replacing its leading policy prefix.
  return text + '\n' + marker + '\n' + deepSeekTransportMessage.toString() + '\n';
}
