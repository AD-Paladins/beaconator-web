export const AI_PROVIDERS = {
  'google-ai-studio': {
    name: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
    ],
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
      { id: 'mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1' },
    ],
    keyUrl: 'https://console.groq.com/keys',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
    ],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  'github-models': {
    name: 'GitHub Models',
    baseUrl: 'https://models.github.ai/inference',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B' },
      { id: 'Mistral-large-2411', name: 'Mistral Large' },
    ],
    keyUrl: 'https://github.com/settings/tokens',
  },
  custom: {
    name: 'Custom / Local (OpenAI-compatible)',
    baseUrl: '',
    models: [{ id: '', name: 'Custom model' }],
    keyUrl: '',
  },
};

export function getProviderDefaults(providerId) {
  const p = AI_PROVIDERS[providerId];
  if (!p) return {};
  return {
    baseUrl: p.baseUrl,
    model: p.models[0]?.id || '',
  };
}

export async function chatCompletion(cfg, { system, user, temperature = 0.3, maxTokens = 1500 }) {
  const provider = AI_PROVIDERS[cfg.aiProvider];
  if (!provider) throw new Error('Unknown AI provider');

  let baseUrl = cfg.aiProvider === 'custom' ? cfg.aiCustomUrl : provider.baseUrl;
  if (!baseUrl) throw new Error('Missing API base URL');

  if (cfg.aiProvider === 'custom' && !/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `http://${baseUrl}`;
  }

  const needsKey = !['custom'].includes(cfg.aiProvider);
  if (needsKey && !cfg.aiApiKey) throw new Error('Missing API key');

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.aiApiKey) headers.Authorization = `Bearer ${cfg.aiApiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.aiModel,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    throw new Error(`rate_limited:${retryAfter || '60'}`);
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
