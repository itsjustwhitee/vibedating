const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[A-Za-z]{2,}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isHttps(s) {
  if (typeof s !== 'string') return false;
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isEmail(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  return v.length <= 254 && EMAIL.test(v);
}

export function isValidTime(hhmm) {
  return TIME.test(String(hhmm));
}

export function canonicalZone(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
