export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function unescapeXml(value) {
  return String(value ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

export function rejectUnsafeXml(xml) {
  const source = String(xml ?? '');
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) {
    const error = new Error('DTD/entity declarations are not allowed in AEAT XML');
    error.code = 'VF_AEAT_XML_UNSAFE';
    throw error;
  }
  return source;
}

function localPattern(name, flags = 'i') {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\s*>`, flags);
}

export function firstLocalText(xml, name) {
  const safe = rejectUnsafeXml(xml);
  const match = safe.match(localPattern(name));
  if (!match) return null;
  return unescapeXml(match[1].replace(/<[^>]*>/g, '').trim());
}

export function localBlocks(xml, name) {
  const safe = rejectUnsafeXml(xml);
  const regex = localPattern(name, 'gi');
  return [...safe.matchAll(regex)].map((match) => match[1]);
}

export function element(prefix, name, value) {
  if (value === undefined || value === null) return '';
  return `<${prefix}:${name}>${escapeXml(value)}</${prefix}:${name}>`;
}
