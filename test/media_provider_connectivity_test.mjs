import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMediaConnectivityRequest } from '../src/services/api/mediaProviderConnectivity.ts';

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
