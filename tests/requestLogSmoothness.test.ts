import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRequestLogRefreshCoordinator } from '../src/features/requestLogs/requestLogRefreshState';

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
