function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitPathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map(safeDecodeURIComponent);
}

function hasPrefix(segments: string[], prefix: string[]): boolean {
  if (prefix.length === 0 || segments.length < prefix.length) return false;
  return prefix.every((segment, index) => segments[index] === segment);
}

function encodePathSegments(segments: string[]): string {
  return `/${segments.map(encodeURIComponent).join('/')}`;
}

export function buildWebDAVUrl(baseUrl: string, inputPath: string): string {
  const base = new URL(baseUrl);
  const baseSegments = splitPathSegments(base.pathname.replace(/\/+$/, ''));
  const inputSegments = splitPathSegments(inputPath.startsWith('/') ? inputPath : `/${inputPath}`);
  const relativeSegments = hasPrefix(inputSegments, baseSegments)
    ? inputSegments.slice(baseSegments.length)
    : inputSegments;

  base.pathname = encodePathSegments([...baseSegments, ...relativeSegments]);
  return base.toString();
}

export function webDAVHrefToPath(href: string, serverUrl: string): string {
  const base = new URL(serverUrl);
  const hrefUrl = new URL(href, serverUrl);
  const baseSegments = splitPathSegments(base.pathname.replace(/\/+$/, ''));
  const hrefSegments = splitPathSegments(hrefUrl.pathname);
  const relativeSegments = hasPrefix(hrefSegments, baseSegments)
    ? hrefSegments.slice(baseSegments.length)
    : hrefSegments;

  return `/${relativeSegments.join('/')}`;
}
