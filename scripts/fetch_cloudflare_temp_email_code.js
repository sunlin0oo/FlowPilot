#!/usr/bin/env node

const {
  buildCloudflareTempEmailHeaders,
  joinCloudflareTempEmailUrl,
  normalizeCloudflareTempEmailAddress,
  normalizeCloudflareTempEmailBaseUrl,
  normalizeCloudflareTempEmailMailApiMessages,
} = require('../cloudflare-temp-email-utils.js');
const {
  extractVerificationCodeFromMessage,
  normalizeTimestamp,
  pickVerificationMessageWithTimeFallback,
} = require('../hotmail-utils.js');

const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 20000;

const DEFAULT_CODE_PATTERNS = Object.freeze([
  Object.freeze({
    source: '(?:chatgpt\\s+log-?in\\s+code|enter\\s+this\\s+code)[^0-9]{0,24}(\\d{6})',
    flags: 'i',
  }),
  Object.freeze({
    source: 'your\\s+chatgpt\\s+code\\s+is\\s+(\\d{6})',
    flags: 'i',
  }),
  Object.freeze({
    source: '(?:verification\\s+code|temporary\\s+verification\\s+code|your\\s+chatgpt\\s+code|code(?:\\s+is)?)[^0-9]{0,16}(\\d{6})',
    flags: 'i',
  }),
  Object.freeze({
    source: '\\b(\\d{6})\\b',
    flags: 'i',
  }),
]);

function parseArgs(argv = []) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.trim();
    const nextValue = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined && nextValue !== undefined && !String(nextValue).startsWith('--')) {
      index += 1;
    }

    switch (key) {
      case 'email':
        options.email = nextValue;
        break;
      case 'temp-api':
      case 'tempApi':
      case 'api':
        options.tempApi = nextValue;
        break;
      case 'admin-auth':
      case 'adminAuth':
        options.adminAuth = nextValue;
        break;
      case 'custom-auth':
      case 'customAuth':
        options.customAuth = nextValue;
        break;
      case 'limit':
        options.limit = Number(nextValue);
        break;
      case 'timeout-ms':
      case 'timeoutMs':
        options.timeoutMs = Number(nextValue);
        break;
      case 'json':
        options.json = true;
        if (inlineValue === undefined && nextValue !== undefined && !String(nextValue).startsWith('--')) {
          index -= 1;
        }
        break;
      case 'help':
      case 'h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!options.email && positionals[0]) options.email = positionals[0];
  if (!options.tempApi && positionals[1]) options.tempApi = positionals[1];
  if (!options.adminAuth && positionals[2]) options.adminAuth = positionals[2];

  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/fetch_cloudflare_temp_email_code.js --email <address> --temp-api <url> --admin-auth <secret>',
    '',
    'Positional form is also supported:',
    '  node scripts/fetch_cloudflare_temp_email_code.js <address> <temp-api> <admin-auth>',
    '',
    'Options:',
    '  --json                 Print code and mail metadata as JSON.',
    '  --limit <number>       Mail page size. Default: 20.',
    '  --timeout-ms <number>  Request timeout. Default: 20000.',
    '  --custom-auth <secret> Also send x-custom-auth when your TempAPI requires it.',
  ].join('\n');
}

function buildConfig(options = {}) {
  const email = normalizeCloudflareTempEmailAddress(options.email);
  const baseUrl = normalizeCloudflareTempEmailBaseUrl(options.tempApi);
  const adminAuth = String(options.adminAuth || '').trim();
  const customAuth = String(options.customAuth || '').trim();
  const limit = Math.max(1, Math.floor(Number(options.limit) || DEFAULT_LIMIT));
  const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Missing or invalid email address.');
  }
  if (!baseUrl) {
    throw new Error('Missing or invalid TempAPI URL.');
  }
  if (!adminAuth) {
    throw new Error('Missing Admin Auth.');
  }

  return {
    email,
    baseUrl,
    adminAuth,
    customAuth,
    limit,
    timeoutMs,
  };
}

function messageMatchesEmail(message, email) {
  const target = normalizeCloudflareTempEmailAddress(email);
  if (!target) return false;
  const candidates = [
    message?.address,
    message?.originalRecipient,
  ].map((value) => normalizeCloudflareTempEmailAddress(value)).filter(Boolean);
  return candidates.includes(target);
}

async function requestJson(fetchImpl, config, path, searchParams = {}) {
  const url = new URL(joinCloudflareTempEmailUrl(config.baseUrl, path));
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: buildCloudflareTempEmailHeaders(config),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const detail = payload && typeof payload === 'object'
        ? (payload.message || payload.error || payload.msg)
        : '';
      throw new Error(detail || text || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

function selectLatestVerificationCode(messages, email) {
  const scopedMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => messageMatchesEmail(message, email));
  const candidates = scopedMessages.length ? scopedMessages : messages;
  const matchResult = pickVerificationMessageWithTimeFallback(candidates, {
    codePatterns: DEFAULT_CODE_PATTERNS,
  });
  if (matchResult.match?.code) {
    return matchResult.match;
  }

  return (candidates || [])
    .map((message) => {
      const code = extractVerificationCodeFromMessage(message, {
        codePatterns: DEFAULT_CODE_PATTERNS,
      });
      return code
        ? {
            code,
            message,
            receivedAt: normalizeTimestamp(message?.receivedDateTime),
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.receivedAt - left.receivedAt)[0] || null;
}

async function fetchLatestCloudflareTempEmailCode(options = {}, deps = {}) {
  const config = buildConfig(options);
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This script requires Node.js 18+ or a fetch implementation.');
  }

  const directPayload = await requestJson(fetchImpl, config, '/admin/mails', {
    limit: config.limit,
    offset: 0,
    address: config.email,
  });
  let messages = normalizeCloudflareTempEmailMailApiMessages(directPayload);
  let match = selectLatestVerificationCode(messages, config.email);

  if (!match?.code) {
    const fallbackPayload = await requestJson(fetchImpl, config, '/admin/mails', {
      limit: config.limit,
      offset: 0,
    });
    messages = normalizeCloudflareTempEmailMailApiMessages(fallbackPayload);
    match = selectLatestVerificationCode(messages, config.email);
  }

  if (!match?.code) {
    throw new Error(`No verification code found for ${config.email}.`);
  }

  return {
    code: match.code,
    email: config.email,
    mailId: match.message?.id || '',
    subject: match.message?.subject || '',
    from: match.message?.from?.emailAddress?.address || '',
    receivedDateTime: match.message?.receivedDateTime || '',
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await fetchLatestCloudflareTempEmailCode(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.code);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err?.message || err);
    console.error('');
    console.error(usage());
    process.exitCode = 1;
  });
}

module.exports = {
  buildConfig,
  fetchLatestCloudflareTempEmailCode,
  parseArgs,
  selectLatestVerificationCode,
};
