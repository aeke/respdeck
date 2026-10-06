export function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
export function ttlLabel(n: number) {
  if (n === -1) return 'No expiry';
  if (n === -2) return 'Expired';
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  return `${Math.floor(n / 86400)}d`;
}
export function encode(value: string) {
  const bytes = new TextEncoder().encode(value);
  return (
    'k_' +
    btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
  );
}
export const patternFor = (search: string) =>
  !search ? '*' : [...search].some((c) => '?*['.includes(c)) ? search : `*${search}*`;
