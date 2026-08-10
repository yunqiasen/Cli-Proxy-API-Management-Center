import type {
  MediaKind,
  MediaModelMode,
  MediaOperationConfig,
  MediaRequestFormat,
} from '../../types/provider.ts';

type MediaConnectivityOperation = Pick<
  MediaOperationConfig,
  'name' | 'capability' | 'method' | 'path' | 'requestFormat' | 'modelMode' | 'model' | 'testRequest'
> & {
  // Form-only fields let the editor test unsaved operation overrides.
  testRequestJson?: string;
  testRequestMultipartFieldsText?: string;
};

export interface MediaConnectivityRequestInput {
  kind: MediaKind;
  baseUrl: string;
  model?: string;
  operation?: MediaConnectivityOperation;
  headers?: Record<string, string>;
  apiKey?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  authIndex?: string;
}

export interface MediaConnectivityRequest {
  method: string;
  url: string;
  header: Record<string, string>;
  data?: string;
  dataBase64?: string;
}

export const MEDIA_CONNECTIVITY_TIMEOUT_MS = 65_000;

const CONNECTIVITY_BOUNDARY = '----CPA-Media-Connectivity-Test-7f3a';
const CONNECTIVITY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const defaultPathByKind: Record<MediaKind, string> = {
  image: '/v1/images/generations',
  video: '/v1/videos',
  audio: '/v1/audio/speech',
};

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

const expandModelPath = (path: string, model: string): string => {
  if (!path.includes('{model}')) return path;
  const encodedModel = model
    .trim()
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return path.replace(/{model}/g, encodedModel);
};

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

const connectivityWavBytes = (): Uint8Array => {
  const sampleRate = 16_000;
  const sampleCount = sampleRate;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * sample) / sampleRate) * 5000);
    view.setInt16(44 + sample * bytesPerSample, value, true);
  }
  return bytes;
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

const parseMultipartFieldsText = (value: string): Record<string, string> =>
  Object.fromEntries(
    value
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const separator = line.indexOf('=');
        if (separator <= 0) return [];
        const name = line.slice(0, separator).trim();
        if (!name) return [];
        return [[name, line.slice(separator + 1)]];
      })
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
  return (
    capability === 'clone' ||
    capability === 'voice-convert' ||
    capability === 'transcribe' ||
    path.includes('convert') ||
    path.includes('transcriptions') ||
    path.includes('speech-to-text')
  );
};

const modelModeFor = (operation: MediaConnectivityRequestInput['operation']): MediaModelMode =>
  operation?.modelMode ?? 'optional';

const requestFormatFor = (
  operation: MediaConnectivityRequestInput['operation']
): MediaRequestFormat => operation?.requestFormat ?? 'json';

const buildFields = (
  kind: MediaKind,
  model: string,
  modelMode: MediaModelMode,
  operation: MediaConnectivityRequestInput['operation']
): Array<[string, string]> => {
  const fields: Array<[string, string]> = [];
  if (modelMode !== 'none' && model) fields.push(['model', model]);
  if (kind === 'image') {
    fields.push(['prompt', 'CPA connectivity test'], ['n', '1']);
  } else if (kind === 'video') {
    fields.push(['prompt', 'CPA connectivity test']);
  } else if (
    operation?.capability?.trim().toLowerCase() === 'transcribe' ||
    operation?.name?.trim().toLowerCase() === 'transcribe'
  ) {
    fields.push(['language', 'zh']);
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
  if (apiKey) {
    const headerName = input.apiKeyHeader?.trim() || 'Authorization';
    if (!hasHeader(headers, headerName)) {
      const rawPrefix = input.apiKeyPrefix;
      const prefix =
        rawPrefix === undefined || rawPrefix.trim() === ''
          ? 'Bearer '
          : rawPrefix.trim() === '-'
            ? ''
            : `${rawPrefix.trim()} `;
      setHeader(headers, headerName, `${prefix}${apiKey}`);
    }
  }

  const rawPath = operation?.path?.trim() || defaultPathByKind[input.kind];
  const path = expandModelPath(rawPath, model);
  const pathUsesModel = rawPath.includes('{model}');
  const request: MediaConnectivityRequest = {
    method,
    url: joinPath(input.baseUrl, path),
    header: headers,
  };
  const fields = buildFields(
    input.kind,
    model,
    pathUsesModel ? 'none' : modelMode,
    operation
  );
  const canHaveBody = method !== 'GET' && method !== 'HEAD';

  if (requestFormat === 'json') {
    if (canHaveBody) {
      let payload: Record<string, unknown>;
      const customJSON =
        operation?.testRequest?.json?.trim() || operation?.testRequestJson?.trim();
      if (customJSON) {
        try {
          const parsed: unknown = JSON.parse(customJSON);
          payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { ...(parsed as Record<string, unknown>) }
            : {};
        } catch {
          payload = {};
        }
      } else {
        payload = Object.fromEntries(fields);
        if (input.kind === 'image') payload.n = 1;
        if (input.kind === 'image' && operationNeedsFile(input.kind, operation)) {
          payload.image = 'https://example.com/cpa-connectivity-test.png';
        }
      }
      if (modelMode !== 'none' && model && payload.model === undefined && !pathUsesModel) {
        payload.model = model;
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
    const configuredMultipartFields = operation?.testRequest?.multipartFields ?? {};
    const formMultipartFields = operation?.testRequestMultipartFieldsText
      ? parseMultipartFieldsText(operation.testRequestMultipartFieldsText)
      : {};
    const customMultipartFields = Object.entries(
      Object.keys(configuredMultipartFields).length ? configuredMultipartFields : formMultipartFields
    ).map(([name, value]) => [name, String(value)] as [string, string]);
    const parts = (customMultipartFields.length ? customMultipartFields : fields).map(([name, value]) =>
      appendMultipartField(name, value)
    );
    if (!customMultipartFields.length && operationNeedsFile(input.kind, operation)) {
      const isAudio = input.kind === 'audio';
      parts.push(
        appendMultipartFile(
          isAudio
            ? operation?.capability?.trim().toLowerCase() === 'transcribe' ||
                operation?.name?.trim().toLowerCase() === 'transcribe'
              ? 'file'
              : 'audio'
            : 'image',
          isAudio ? 'connectivity-test.wav' : 'connectivity-test.png',
          isAudio ? 'audio/wav' : 'image/png',
          isAudio ? connectivityWavBytes() : decodeBase64(CONNECTIVITY_PNG_BASE64)
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
