import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_CONNECTIVITY_TIMEOUT_MS,
  buildMediaConnectivityRequest,
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
    prompt: 'CPA connectivity test',
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
  assert.match(body, /CPA connectivity test/);
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
    prompt: 'CPA connectivity test',
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
      testRequestJson: '{"model":"mimo-v2.5-tts","messages":[{"role":"assistant","content":"CPA test"}]}',
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
