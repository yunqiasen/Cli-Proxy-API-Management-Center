import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_CONNECTIVITY_TIMEOUT_MS,
  buildMediaConnectivityRequest,
  buildMediaGatewayConnectivityRequest,
  getMediaConnectivityApplicationError,
  requestMediaGatewayConnectivity,
} from '../src/services/api/mediaProviderConnectivity.ts';

const decodeBase64 = (value) => Buffer.from(value, 'base64').toString('utf8');

test('builds a JSON connectivity request with model and base-url path joining', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'image',
    baseUrl: 'https://relay.example/v1/',
    model: 'public-image',
    operation: {
      name: 'generate',
      method: 'POST',
      path: '/v1/images/generations',
      requestFormat: 'json',
      modelMode: 'required',
    },
    apiKey: 'key-a',
  });
  assert.equal(request.url, 'https://relay.example/v1/images/generations');
  assert.equal(request.method, 'POST');
  assert.equal(request.header.Authorization, 'Bearer key-a');
  assert.equal(request.header['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.data), {
    model: 'public-image',
    prompt: 'A simple blue circle centered on a plain white background',
    n: 1,
  });
});

test('builds a real multipart body with a test file and base64 transport', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'image',
    baseUrl: 'https://relay.example/v1',
    model: 'public-edit',
    operation: {
      name: 'edit',
      capability: 'edit',
      method: 'POST',
      path: '/images/edits',
      requestFormat: 'multipart',
      modelMode: 'required',
    },
    apiKey: 'key-a',
  });
  assert.equal(request.data, undefined);
  assert.match(request.header['Content-Type'], /^multipart\/form-data; boundary=/);
  const body = Buffer.from(request.dataBase64, 'base64').toString('utf8');
  assert.match(body, /name="model"/);
  assert.match(body, /public-edit/);
  assert.match(body, /filename="connectivity-test\.png"/);
  assert.match(body, /A simple blue circle centered on a plain white background/);
});

test('adds a sample image to JSON image-to-video connectivity requests', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'video',
    baseUrl: 'https://video.example/v1',
    model: 'video-model',
    operation: {
      name: 'image-to-video',
      capability: 'image-to-video',
      method: 'POST',
      path: '/video/generations',
      requestFormat: 'json',
      modelMode: 'required',
    },
    apiKey: 'token',
  });
  const payload = JSON.parse(request.data);
  assert.equal(payload.model, 'video-model');
  assert.equal(payload.prompt, 'CPA connectivity test');
  assert.match(payload.image, /^data:image\/png;base64,/);
  assert.equal(
    Buffer.from(payload.image.split(',', 2)[1], 'base64').subarray(1, 4).toString(),
    'PNG'
  );
});

test('builds a model-free binary request without inventing authorization', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://audio.example',
    operation: {
      name: 'voice-convert',
      method: 'POST',
      path: '/convert',
      requestFormat: 'binary',
      modelMode: 'none',
    },
  });
  assert.equal(request.header.Authorization, undefined);
  assert.equal(request.header['Content-Type'], 'application/octet-stream');
  assert.equal(Buffer.from(request.dataBase64, 'base64').toString(), 'CPA media connectivity test');
  assert.equal(decodeBase64(request.dataBase64), 'CPA media connectivity test');
});

test('does not synthesize authorization for an existing no-key provider auth slot', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://audio.example',
    operation: {
      name: 'speech',
      method: 'POST',
      path: '/speech',
      requestFormat: 'json',
      modelMode: 'none',
    },
    authIndex: 'media-provider:audio:public',
  });
  assert.equal(request.header.Authorization, undefined);
});

test('expands model placeholders in endpoint paths and omits model from the body', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'image',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT/ai/run',
    model: '@cf/black-forest-labs/flux-1-schnell',
    operation: {
      name: 'generate',
      method: 'POST',
      path: '/{model}',
      requestFormat: 'json',
      modelMode: 'required',
    },
    apiKey: 'token',
  });
  assert.equal(
    request.url,
    'https://api.cloudflare.com/client/v4/accounts/ACCOUNT/ai/run/%40cf/black-forest-labs/flux-1-schnell'
  );
  assert.deepEqual(JSON.parse(request.data), {
    prompt: 'A simple blue circle centered on a plain white background',
    n: 1,
  });
});

test('uses a configured credential header and prefix for connectivity tests', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://noiz.example/v1',
    operation: {
      name: 'speech',
      method: 'POST',
      path: '/text-to-speech',
      requestFormat: 'json',
      modelMode: 'none',
    },
    headers: { 'X-Provider': 'noiz' },
    apiKey: 'token',
    apiKeyHeader: 'X-API-Key',
    apiKeyPrefix: '-',
  });
  assert.equal(request.header['X-API-Key'], 'token');
  assert.equal(request.header.Authorization, undefined);
  assert.equal(request.header['X-Provider'], 'noiz');
});

test('uses the file field for audio transcription connectivity tests', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://speech.example/v1',
    model: 'sensevoice',
    operation: {
      name: 'transcribe',
      capability: 'transcribe',
      method: 'POST',
      path: '/audio/transcriptions',
      requestFormat: 'multipart',
      modelMode: 'required',
    },
    apiKey: 'token',
  });
  const body = decodeBase64(request.dataBase64);
  assert.match(body, /name="model"/);
  assert.match(body, /name="file"/);
  assert.doesNotMatch(body, /name="audio"/);
  const fileMarker = body.indexOf('filename="connectivity-test.wav"');
  assert.ok(fileMarker >= 0);
  assert.match(body.slice(fileMarker), /RIFF.{4}WAVEfmt/s);
});

test('uses a spoken WAV test clip long enough for ASR and voice cloning', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://speech.example/v1',
    model: 'speech-model',
    operation: {
      name: 'clone',
      capability: 'clone',
      method: 'POST',
      path: '/voices',
      requestFormat: 'multipart',
      modelMode: 'required',
    },
    apiKey: 'token',
  });
  const raw = Buffer.from(request.dataBase64, 'base64');
  const marker = Buffer.from('filename="connectivity-test.wav"\r\nContent-Type: audio/wav\r\n\r\n');
  const start = raw.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length);
  const end = raw.indexOf(Buffer.from('\r\n--'), start);
  assert.ok(end > start);
  const wav = raw.subarray(start, end);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  const sampleRate = wav.readUInt32LE(24);
  const byteRate = wav.readUInt32LE(28);
  const dataOffset = wav.indexOf(Buffer.from('data'));
  assert.ok(dataOffset > 0);
  const dataSize = wav.readUInt32LE(dataOffset + 4);
  assert.ok(dataSize / byteRate >= 3, `audio duration is ${dataSize / byteRate}s`);
  assert.ok(sampleRate >= 8_000);
});

test('keeps custom multipart fields and uses file for audio clone connectivity tests', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://api.noiz.ai/v1',
    operation: {
      name: 'clone',
      capability: 'clone',
      method: 'POST',
      path: '/voices',
      requestFormat: 'multipart',
      modelMode: 'none',
      testRequest: {
        multipartFields: {
          display_name: 'CPA Test Voice',
          language: 'zh',
        },
      },
    },
    apiKey: 'token',
    apiKeyPrefix: '-',
  });
  const body = decodeBase64(request.dataBase64);
  assert.match(body, /name="display_name"\r\n\r\nCPA Test Voice/);
  assert.match(body, /name="language"\r\n\r\nzh/);
  assert.match(body, /name="file"/);
  assert.doesNotMatch(body, /name="audio"/);
  assert.match(body, /filename="connectivity-test\.wav"/);
});

test('uses an operation-specific JSON body for connectivity tests', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-tts',
    operation: {
      name: 'speech',
      capability: 'speech',
      method: 'POST',
      path: '/chat/completions',
      requestFormat: 'json',
      modelMode: 'required',
      testRequest: {
        json: '{"model":"mimo-v2.5-tts","messages":[{"role":"assistant","content":"CPA test"}]}',
      },
    },
    apiKey: 'token',
  });
  assert.deepEqual(JSON.parse(request.data), {
    model: 'mimo-v2.5-tts',
    messages: [{ role: 'assistant', content: 'CPA test' }],
  });
});

test('uses operation-specific multipart fields as the complete connectivity form', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://api.noiz.ai/v1',
    operation: {
      name: 'speech',
      capability: 'speech',
      method: 'POST',
      path: '/text-to-speech',
      requestFormat: 'multipart',
      modelMode: 'none',
      testRequest: {
        multipartFields: {
          text: 'CPA test',
          voice_id: '3b9f1e27',
          output_format: 'mp3',
        },
      },
    },
    apiKey: 'token',
    apiKeyPrefix: '-',
  });
  const body = decodeBase64(request.dataBase64);
  assert.match(body, /name="text"\r\n\r\nCPA test/);
  assert.match(body, /name="voice_id"\r\n\r\n3b9f1e27/);
  assert.match(body, /name="output_format"\r\n\r\nmp3/);
  assert.doesNotMatch(body, /name="input"/);
  assert.doesNotMatch(body, /name="voice"/);
});

test('accepts form-level custom JSON fields for connectivity tests', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-tts',
    operation: {
      name: 'speech',
      capability: 'speech',
      method: 'POST',
      path: '/chat/completions',
      requestFormat: 'json',
      modelMode: 'required',
      testRequestJson:
        '{"model":"mimo-v2.5-tts","messages":[{"role":"assistant","content":"CPA test"}]}',
    },
    apiKey: 'token',
  });
  assert.deepEqual(JSON.parse(request.data), {
    model: 'mimo-v2.5-tts',
    messages: [{ role: 'assistant', content: 'CPA test' }],
  });
});

test('accepts form-level custom multipart fields for connectivity tests', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://api.noiz.ai/v1',
    operation: {
      name: 'speech',
      capability: 'speech',
      method: 'POST',
      path: '/text-to-speech',
      requestFormat: 'multipart',
      modelMode: 'none',
      testRequestMultipartFieldsText: 'text=CPA test\nvoice_id=voice-1\noutput_format=mp3',
    },
    apiKey: 'token',
    apiKeyPrefix: '-',
  });
  const body = decodeBase64(request.dataBase64);
  assert.match(body, /name="text"\r\n\r\nCPA test/);
  assert.match(body, /name="voice_id"\r\n\r\nvoice-1/);
  assert.match(body, /name="output_format"\r\n\r\nmp3/);
  assert.doesNotMatch(body, /name="input"/);
});

test('allows slow media providers to finish connectivity tests', () => {
  assert.equal(MEDIA_CONNECTIVITY_TIMEOUT_MS, 65_000);
});

test('explicitly selected test model overrides operation and custom JSON model values', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://audio.example/v1',
    model: 'selected-model',
    operation: {
      name: 'speech',
      capability: 'speech',
      method: 'POST',
      path: '/chat/completions',
      requestFormat: 'json',
      modelMode: 'required',
      model: 'operation-model',
      testRequestJson: '{"model":"fixture-model","input":"CPA test"}',
    },
    apiKey: 'token',
  });
  assert.equal(JSON.parse(request.data).model, 'selected-model');
});

test('builds a CPA gateway request with the public model alias and stable route', () => {
  const request = buildMediaGatewayConnectivityRequest({
    kind: 'image',
    gatewayBaseUrl: 'https://cpa.example',
    gatewayApiKey: 'cpa-key',
    model: 'public-image',
    operation: {
      name: 'generate',
      capability: 'generate',
      method: 'POST',
      path: '/provider-specific/path',
      requestFormat: 'json',
      modelMode: 'required',
    },
  });
  assert.equal(request.url, 'https://cpa.example/v1/images/generations');
  assert.equal(request.header.Authorization, 'Bearer cpa-key');
  assert.equal(JSON.parse(request.data).model, 'public-image');
});

test('executes the CPA gateway request directly from the UI instead of proxying it through management api-call', async () => {
  const calls = [];
  const result = await requestMediaGatewayConnectivity(
    {
      method: 'POST',
      url: 'http://127.0.0.1:8317/v1/images/generations',
      header: {
        Authorization: 'Bearer cpa-key',
        'Content-Type': 'application/json',
      },
      data: '{"model":"public-image","prompt":"CPA test"}',
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response('', { status: 201, headers: { 'X-CPA-Trace-ID': 'trace-1' } });
      },
      timeoutMs: 0,
    }
  );

  assert.equal(result.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8317/v1/images/generations');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer cpa-key');
  assert.equal(calls[0].init.body, '{"model":"public-image","prompt":"CPA test"}');
});

test('surfaces the CPA gateway response body when the public route fails', async () => {
  await assert.rejects(
    () =>
      requestMediaGatewayConnectivity(
        {
          method: 'POST',
          url: 'http://127.0.0.1:8317/v1/audio/speech',
          header: { Authorization: 'Bearer cpa-key' },
          data: '{}',
        },
        {
          fetchImpl: async () =>
            new Response('{"error":{"message":"route failed"}}', {
              status: 502,
              headers: { 'Content-Type': 'application/json' },
            }),
          timeoutMs: 0,
        }
      ),
    /HTTP 502.*route failed/
  );
});

test('accepts vendor success code 1000 outside the HTTP status range', () => {
  assert.equal(
    getMediaConnectivityApplicationError({
      code: 1000,
      data: { url: 'https://img.example/out.png' },
    }),
    null
  );
});

test('accepts an unknown vendor code when the response contains a result payload', () => {
  assert.equal(
    getMediaConnectivityApplicationError({ code: 1, data: { url: 'https://img.example/out.png' } }),
    null
  );
});

test('accepts a vendor success code outside the HTTP status range', async () => {
  const result = await requestMediaGatewayConnectivity(
    {
      method: 'POST',
      url: 'http://127.0.0.1:8317/v1/audio/clone',
      header: { Authorization: 'Bearer cpa-key' },
      data: '{}',
    },
    {
      fetchImpl: async () =>
        new Response('{"code":10000,"data":{"voice_id":"voice-1"}}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      timeoutMs: 0,
    }
  );

  assert.equal(result.statusCode, 200);
});

test('rejects a successful HTTP response that contains an application-level media error', async () => {
  await assert.rejects(
    () =>
      requestMediaGatewayConnectivity(
        {
          method: 'POST',
          url: 'http://127.0.0.1:8317/v1/audio/clone',
          header: { Authorization: 'Bearer cpa-key' },
          data: '{}',
        },
        {
          fetchImpl: async () =>
            new Response('{"code":400,"message":"credit limit exceeded"}', {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          timeoutMs: 0,
        }
      ),
    /credit limit exceeded/
  );
});

test('rejects a mislabeled binary HTTP 200 response that contains a JSON media error', async () => {
  await assert.rejects(
    () =>
      requestMediaGatewayConnectivity(
        {
          method: 'POST',
          url: 'http://127.0.0.1:8317/v1/audio/clone',
          header: { Authorization: 'Bearer cpa-key' },
          data: '{}',
        },
        {
          fetchImpl: async () =>
            new Response('{"code":-1,"message":"invalid key"}', {
              status: 200,
              headers: { 'Content-Type': 'application/octet-stream' },
            }),
          timeoutMs: 0,
        }
      ),
    /invalid key/
  );
});

test('keeps the selected model when custom multipart fields are configured', () => {
  const request = buildMediaConnectivityRequest({
    kind: 'audio',
    baseUrl: 'https://speech.example/v1',
    model: 'selected-asr-model',
    operation: {
      name: 'transcribe',
      capability: 'transcribe',
      method: 'POST',
      path: '/audio/transcriptions',
      requestFormat: 'multipart',
      modelMode: 'required',
      testRequest: {
        multipartFields: {
          language: 'zh',
        },
      },
    },
    apiKey: 'token',
  });
  const body = decodeBase64(request.dataBase64);
  assert.match(body, /name="language"\r\n\r\nzh/);
  assert.match(body, /name="model"\r\n\r\nselected-asr-model/);
});

test('accepts HTTP-style 2xx business codes and non-fatal error fields with payloads', () => {
  assert.equal(
    getMediaConnectivityApplicationError({ code: 201, data: { task_id: 'task-1' } }),
    null
  );
  assert.equal(
    getMediaConnectivityApplicationError({
      ok: true,
      data: { task_id: 'task-1' },
      error: 'fallback voice used',
    }),
    null
  );
});

test('rejects non-success business codes in HTTP 200 media responses', () => {
  for (const body of [
    { code: -1, message: 'invalid key' },
    { code: 1001, message: 'insufficient balance' },
    { code: 'fail_to_fetch_task', message: 'model is blocked' },
  ]) {
    assert.match(
      getMediaConnectivityApplicationError(body) ?? '',
      /invalid key|insufficient balance|model is blocked/
    );
  }
  assert.equal(
    getMediaConnectivityApplicationError({ code: 10000, data: { task_id: 'task-1' } }),
    null
  );
  assert.equal(
    getMediaConnectivityApplicationError({ code: 'success', data: { task_id: 'task-1' } }),
    null
  );
});
