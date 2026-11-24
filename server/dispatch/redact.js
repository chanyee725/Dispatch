// Masks key- and email-shaped strings before text reaches the in-memory transcript, the UI or
// state.json (CLAUDE.md: no auth tokens, API keys or emails stored or logged). It matches shapes,
// not known values: a false positive only hides a few characters of agent output.

export const MASK = "[가림]";

const PATTERNS = [
  // Emails (not SSH remotes like git@github.com:owner/repo).
  /(?<![A-Za-z0-9._%+-])(?!git@)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  // Provider keys and tokens with a known prefix (Anthropic, OpenAI, GitHub, Slack, AWS, Google, npm).
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  // JWTs (three base64url parts, the first one a JSON header).
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Bearer / basic auth headers and key=value secrets.
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|token)["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
];

/** `text` with every key- or email-shaped part replaced by MASK; anything not a string is returned as is. */
export function redact(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const re of PATTERNS) {
    // A pattern with a group keeps it (the header word or the "key=" part) and masks the value.
    out = out.replace(re, (_m, keep) => (typeof keep !== "string" ? MASK : /^(bearer|basic)$/i.test(keep) ? `${keep} ${MASK}` : `${keep}${MASK}`));
  }
  return out;
}

/** A copy of `value` with every string value inside it (objects, arrays) masked. Object keys are kept as they are: permission inputs carry secrets in values, not in key names. */
export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
  return value;
}
