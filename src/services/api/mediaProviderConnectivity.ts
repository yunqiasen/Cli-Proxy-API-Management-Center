import type {
  MediaKind,
  MediaModelMode,
  MediaOperationConfig,
  MediaRequestFormat,
} from '../../types/provider.ts';

export interface MediaConnectivityRequestInput {
  kind: MediaKind;
  baseUrl: string;
  model?: string;
  operation?: Pick<
    MediaOperationConfig,
    'name' | 'capability' | 'method' | 'path' | 'requestFormat' | 'modelMode' | 'model'
  >;
  headers?: Record<string, string>;
  apiKey?: string;
  authIndex?: string;
}

export interface MediaConnectivityRequest {
  method: string;
  url: string;
  header: Record<string, string>;
  data?: string;
  dataBase64?: string;
}

const CONNECTIVITY_BOUNDARY = '----CPA-Media-Connectivity-Test-7f3a';
const CONNECTIVITY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const defaultPathByKind: Record<MediaKind, string> = {
  image: '/v1/images/generations',
  video: '/v1/videos',
  audio: '/v1/audio/speech',
};

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

const joinPath = (baseUrl: string, path: string): string => {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.trim().startsWith('/') ? path.trim() : `/${path.trim()}`;
  if (/\/v1$/i.test(base) && /^\/v1\//i.test(normalizedPath)) {
    return `${base}${normalizedPath.slice(3)}`;
  }
  return `${base}${normalizedPath}`;
};

const hasHeader = (headers: Record<string, string>, name: string): boolean =>
  Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());

const setHeader = (headers: Record<string, string>, name: string, value: string): void => {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  headers[existing ?? name] = value;
};

const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const appendMultipartField = (name: string, value: string): Uint8Array =>
  concatBytes(
    textBytes(`--${CONNECTIVITY_BOUNDARY}\r\n`),
    textBytes(`Content-Disposition: form-data; name="${name}"\r\n\r\n`),
    textBytes(`${value}\r\n`)
  );

const appendMultipartFile = (
  name: string,
  filename: string,
  contentType: string,
  content: Uint8Array
): Uint8Array =>
  concatBytes(
    textBytes(`--${CONNECTIVITY_BOUNDARY}\r\n`),
    textBytes(
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
    ),
    content,
    textBytes('\r\n')
  );

const operationNeedsFile = (
  kind: MediaKind,
  operation: MediaConnectivityRequestInput['operation']
): boolean => {
  const capability = (operation?.capability ?? operation?.name ?? '').trim().toLowerCase();
  const path = operation?.path?.trim().toLowerCase() ?? '';
  if (kind === 'image') {
    return (
      ['edit', 'upscale', 'super-resolution', 'remove-background'].includes(capability) ||
      path.includes('/edits') ||
      path.includes('upscale') ||
      path.includes('super-resolution') ||
      path.includes('remove-background')
    );
  }
  if (kind === 'video') return capability === 'image-to-video' || path.includes('image-to-video');
  return capability === 'clone' || capability === 'voice-convert' || path.includes('convert');
};

const modelModeFor = (operation: MediaConnectivityRequestInput['operation']): MediaModelMode =>
  operation?.modelMode ?? 'optional';

const requestFormatFor = (
  operation: MediaConnectivityRequestInput['operation']
): MediaRequestFormat => operation?.requestFormat ?? 'json';

const buildFields = (
  kind: MediaKind,
  model: string,
  modelMode: MediaModelMode
): Array<[string, string]> => {
  const fields: Array<[string, string]> = [];
  if (modelMode !== 'none' && model) fields.push(['model', model]);
  if (kind === 'image') {
    fields.push(['prompt', 'CPA connectivity test'], ['n', '1']);
  } else if (kind === 'video') {
    fields.push(['prompt', 'CPA connectivity test']);
  } else {
    fields.push(['input', 'CPA connectivity test'], ['voice', 'alloy']);
  }
  return fields;
};

export function buildMediaConnectivityRequest(
  input: MediaConnectivityRequestInput
): MediaConnectivityRequest {
  const operation = input.operation;
  const method = (operation?.method ?? 'POST').trim().toUpperCase() || 'POST';
  const requestFormat = requestFormatFor(operation);
  const modelMode = modelModeFor(operation);
  const model =
    modelMode === 'none' ? '' : (operation?.model ?? '').trim() || (input.model ?? '').trim();
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  const apiKey = input.apiKey?.trim() ?? '';
  if (!hasHeader(headers, 'authorization') && apiKey) {
    setHeader(headers, 'Authorization', `Bearer ${apiKey}`);
  }

  const path = operation?.path?.trim() || defaultPathByKind[input.kind];
  const request: MediaConnectivityRequest = {
    method,
    url: joinPath(input.baseUrl, path),
    header: headers,
  };
  const fields = buildFields(input.kind, model, modelMode);
  const canHaveBody = method !== 'GET' && method !== 'HEAD';

  if (requestFormat === 'json') {
    if (canHaveBody) {
      const payload: Record<string, unknown> = Object.fromEntries(fields);
      if (input.kind === 'image') payload.n = 1;
      if (input.kind === 'image' && operationNeedsFile(input.kind, operation)) {
        payload.image = 'https://example.com/cpa-connectivity-test.png';
      }
      request.data = JSON.stringify(payload);
      setHeader(request.header, 'Content-Type', 'application/json');
    }
    return request;
  }

  if (requestFormat === 'binary') {
    if (canHaveBody) {
      request.dataBase64 = encodeBase64(textBytes('CPA media connectivity test'));
      setHeader(request.header, 'Content-Type', 'application/octet-stream');
    }
    return request;
  }

  if (canHaveBody) {
    const parts = fields.map(([name, value]) => appendMultipartField(name, value));
    if (operationNeedsFile(input.kind, operation)) {
      const isAudio = input.kind === 'audio';
      parts.push(
        appendMultipartFile(
          isAudio ? 'audio' : 'image',
          isAudio ? 'connectivity-test.wav' : 'connectivity-test.png',
          isAudio ? 'audio/wav' : 'image/png',
          isAudio ? textBytes('CPA connectivity test audio') : decodeBase64(CONNECTIVITY_PNG_BASE64)
        )
      );
    }
    const body = concatBytes(...parts, textBytes(`--${CONNECTIVITY_BOUNDARY}--\r\n`));
    request.dataBase64 = encodeBase64(body);
    setHeader(
      request.header,
      'Content-Type',
      `multipart/form-data; boundary=${CONNECTIVITY_BOUNDARY}`
    );
  }
  return request;
}
