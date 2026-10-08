'use strict';

const DEFAULT_MODEL = 'gemini-3.5-flash';
const MAX_PROVIDER_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 20_000;
// Thinking and visible JSON share this ceiling; do not scale it down for one channel.
// https://ai.google.dev/gemini-api/docs/generate-content/thinking#token-limits-and-max_output_tokens
const MAX_PROVIDER_OUTPUT_TOKENS = 8000;

function aiConfig(env = process.env) {
  return {
    apiKey:String(env.GEMINI_API_KEY || '').trim(),
    model:String(env.GEMINI_MODEL || DEFAULT_MODEL).trim(),
    maxAttempts:MAX_PROVIDER_ATTEMPTS,
    timeoutMs:PROVIDER_TIMEOUT_MS,
    maxOutputTokens:MAX_PROVIDER_OUTPUT_TOKENS,
  };
}

function providerHealth(config, observation = {}) {
  return {
    provider:'gemini', model:config.model, configured:Boolean(config.apiKey),
    status:!config.apiKey ? 'not-configured' : observation.lastSuccessAt ? 'previous-success' : 'unverified',
    lastSuccessAt:observation.lastSuccessAt || null,
    lastFailureAt:observation.lastFailureAt || null,
    lastFailureCode:observation.lastFailureCode || null,
    maxAttemptsPerGeneration:config.maxAttempts,
    note:'Credential presence and past success do not establish current provider readiness. Health does not call the provider.',
  };
}

module.exports = { DEFAULT_MODEL, MAX_PROVIDER_ATTEMPTS, PROVIDER_TIMEOUT_MS, MAX_PROVIDER_OUTPUT_TOKENS, aiConfig, providerHealth };
