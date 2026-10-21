import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  createRequestLogRefreshCoordinator,
  applyRequestLogRefreshSuccess,
  createRequestLogRefreshState,
} from '../src/features/requestLogs/requestLogRefreshState';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('request log response ownership', () => {
  test('superseded searches stay stale after late transport completion', () => {
    const coordinator = createRequestLogRefreshCoordinator();
    const old = coordinator.tryStart()!;
    const replacement = coordinator.tryStart(true)!;
    expect(replacement).not.toBeNull();
    expect(coordinator.isCurrent(old)).toBe(false);
    expect(coordinator.isCurrent(replacement)).toBe(true);
    coordinator.finish(old);
    expect(coordinator.tryStart()).toBeNull();
    coordinator.finish(replacement);
    expect(coordinator.tryStart()).not.toBeNull();
  });

  test('unmount and connection switches invalidate pending responses and search timers', () => {
    const callbacks = new Map<number, () => void>();
    let next = 0;
    const coordinator = createRequestLogRefreshCoordinator({
      scheduler: {
        setTimeout: (callback) => {
          callbacks.set(++next, callback);
          return next as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout: (id) => {
          callbacks.delete(Number(id));
        },
      },
    });
    const old = coordinator.tryStart()!;
    coordinator.scheduleSearch('old server query', () => {});
    coordinator.invalidate();
    expect(coordinator.isCurrent(old)).toBe(false);
    expect(callbacks.size).toBe(0);
    expect(coordinator.tryStart()).not.toBeNull();
  });

  test('silent list poll still applies sync metadata via applyRequestLogRefreshSuccess', () => {
    const state = createRequestLogRefreshState<{ id: string }>([{ id: 'a' }], 1);
    const payload = {
      items: [{ id: 'a', state: 'succeeded' }],
      total: 1,
      syncing: true,
      last_synced_at: '2026-01-01T00:00:00Z',
      observation_warning: 'capture gap',
    };
    const next = applyRequestLogRefreshSuccess(state, payload);
    expect(next.syncing).toBe(true);
    expect(next.lastSyncedAt).toBe('2026-01-01T00:00:00Z');
    expect(next.observationWarning).toBe('capture gap');
    expect(next.items).toHaveLength(1);
    expect(next.items[0].state).toBe('succeeded');
  });
});

describe('request log viewport contract', () => {
  const scss = source('src/features/requestLogs/RequestLogsPanel.module.scss');
  const panel = source('src/features/requestLogs/RequestLogsPanel.tsx');
  test('table scrolls within the remaining card space, rather than below the viewport', () => {
    const card = scss.match(/\.card \{([^}]+)/)?.[1] ?? '';
    const wrap = scss.match(/\.tableWrap \{([^}]+)/)?.[1] ?? '';
    for (const text of [
      'display: flex',
      'flex-direction: column',
      'flex: 1',
      'min-height: 0',
      'overflow: hidden',
    ])
      expect(card).toContain(text);
    for (const text of ['flex: 1', 'min-height: 0', 'overflow: auto']) expect(wrap).toContain(text);
    expect(wrap).not.toMatch(/(?:max-height|height):\s*(?:calc|\d+px)/);
  });
  test('route state stays in the primary columns and its filter stays compact', () => {
    const filter = panel.match(/<Select[\s\S]*?\/>/)?.[0] ?? '';
    expect(filter).toContain('fullWidth={false}');
    expect(panel.indexOf('<th className={styles.statusCell}>状态</th>')).toBeLessThan(
      panel.indexOf('<th>系统提示词</th>')
    );
  });
  test('horizontal overflow keeps the action cell and keyboard scrolling accessible', () => {
    expect(scss).toMatch(/\.actionCell\s*\{[^}]*position: sticky;[^}]*right: 0;/);
    expect(panel).toContain('tabIndex={0}');
    expect(panel).toContain("t('logs.request_table_label')");
  });
});

// Traverse JSX rather than matching tag text: an empty flex sibling steals space.
test('request logs share the same content slot as the raw and error tabs', () => {
  const file = ts.createSourceFile(
    'LogsPage.tsx',
    source('src/features/logs/LogsPage.tsx'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const matches: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'RequestLogsPanel')
      matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(matches).toHaveLength(1);
  let parent = matches[0].parent;
  while (parent && !ts.isJsxElement(parent)) parent = parent.parent;
  expect(parent && ts.isJsxElement(parent) ? parent.openingElement.getText(file) : '').toBe(
    '<div className={styles.content}>'
  );
});

// === Fix regression contracts ===

describe('request log fix regressions', () => {
  const panelSrc = source('src/features/requestLogs/RequestLogsPanel.tsx');
  const apiSrc = source('src/services/api/requestLogs.ts');

  test('silent list poll uses applyRequestLogRefreshSuccess (not ad-hoc merge)', () => {
    expect(panelSrc).toContain('applyRequestLogRefreshSuccess');
  });

  test('detail close callback stays stable while metadata or search state changes', () => {
    expect(panelSrc).toContain('const closeDetail = useCallback(');
  });

  test('detail metadata polling uses detailMetadata endpoint', () => {
    expect(apiSrc).toContain('detailMetadata');
    expect(apiSrc).toContain('metadata_only');
    expect(panelSrc).toContain('detailMetadata');
  });

  test('detail polling respects autoRefresh/hidden and no-overlap guards', () => {
    expect(panelSrc).toContain('shouldPollDetailMetadata');
    expect(panelSrc).toContain('detailMetaControllerRef');
    expect(panelSrc).toContain('detailGenerationRef');
  });

  test('attempts table includes credential reference column', () => {
    expect(panelSrc).toContain('observation_attempt_credential');
    expect(panelSrc).toContain('att.auth_id');
  });

  test('retried state has i18n label in all locales', () => {
    for (const locale of ['en.json', 'zh-CN.json', 'zh-TW.json', 'ru.json']) {
      const data = JSON.parse(source(`src/i18n/locales/${locale}`));
      expect(data.logs.observation_state_retried).toBeTruthy();
      expect(data.logs.observation_attempt_credential).toBeTruthy();
      expect(data.logs.observation_phase_label).toBeTruthy();
    }
  });

  test('raw log button downloads via authenticated log API, not detail route switch', () => {
    expect(panelSrc).toContain('logsApi.downloadRequestLogById');
    expect(panelSrc).not.toContain('openDetail({ ...detail, id: detail.raw_log_id');
  });

  test('list polling respects search/history via shouldPollList', () => {
    expect(panelSrc).toContain('shouldPollList');
    expect(panelSrc).toContain('querySettled');
  });

  test('full detail fetched once after terminal + raw_log_id, not periodically', () => {
    expect(panelSrc).toContain('needsFullDetailFetch');
    expect(panelSrc).toContain('fullDetailFetchedRef');
  });
});
