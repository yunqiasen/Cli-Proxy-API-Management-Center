/**
 * Model Catalog Display Policy editor dialog.
 *
 * Mounted inside the SystemPage models card. Uses the existing Modal, Button,
 * Select, and theme primitives. All interactive text is i18n'd, and keyboard
 * focus / accessible labels follow the same conventions as the rest of the
 * panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select, type SelectOption } from '@/components/ui/Select';
import { draftToPolicy, useModelCatalogEditor } from '../hooks/useModelCatalogEditor';
import { catalogViewForPolicy, policiesEqual, reorderPin, splitWildcardRules } from '../policy';

import { CATALOG_FORMATS, type CatalogEntry, type CatalogFormat } from '../types';
import styles from './ModelCatalogEditor.module.scss';

type FilterMode = 'visible' | 'hidden' | 'all';

const FORMAT_OPTIONS: SelectOption[] = CATALOG_FORMATS.map((f) => ({
  value: f,
  label: f.charAt(0).toUpperCase() + f.slice(1),
}));

const ORDER_OPTIONS: SelectOption[] = [
  { value: 'preserve', label: 'Preserve' },
  { value: 'asc', label: 'A → Z' },
  { value: 'desc', label: 'Z → A' },
];

export function ModelCatalogEditor() {
  const { t } = useTranslation();

  // Select stable primitive values and actions individually to avoid
  // infinite re-render from the whole-store object identity changing.
  const isOpen = useModelCatalogEditor((s) => s.isOpen);
  const loading = useModelCatalogEditor((s) => s.loading);
  const error = useModelCatalogEditor((s) => s.error);
  const inventoryError = useModelCatalogEditor((s) => s.inventoryError);
  const inventory = useModelCatalogEditor((s) => s.inventory);
  const preview = useModelCatalogEditor((s) => s.preview);
  const previewLoading = useModelCatalogEditor((s) => s.previewLoading);
  const previewError = useModelCatalogEditor((s) => s.previewError);
  const saving = useModelCatalogEditor((s) => s.saving);
  const saveError = useModelCatalogEditor((s) => s.saveError);
  const saveStatus = useModelCatalogEditor((s) => s.saveStatus);
  const configured = useModelCatalogEditor((s) => s.configured);
  const format = useModelCatalogEditor((s) => s.format);
  const draft = useModelCatalogEditor((s) => s.draft);
  const editRevision = useModelCatalogEditor((s) => s.editRevision);

  const closeDialog = useModelCatalogEditor((s) => s.closeDialog);
  const load = useModelCatalogEditor((s) => s.load);
  const setFormat = useModelCatalogEditor((s) => s.setFormat);
  const updateDraft = useModelCatalogEditor((s) => s.updateDraft);
  const runPreview = useModelCatalogEditor((s) => s.runPreview);
  const save = useModelCatalogEditor((s) => s.save);

  const [filterMode, setFilterMode] = useState<FilterMode>('visible');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [wildcardInfo, setWildcardInfo] = useState<{
    rules: string[];
    count: number;
  } | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenRulesRef = useRef<HTMLTextAreaElement | null>(null);

  // Load once per opening/format using stable store actions.
  useEffect(() => {
    if (!isOpen) return;
    void load();
  }, [isOpen, format, load]);

  // Cleanup debounce on unmount or close
  useEffect(() => {
    if (!isOpen && previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
  }, []);

  // Clear selections on format/session switch
  useEffect(() => {
    setSelectedIds(new Set());
    setWildcardInfo(null);
  }, [format, isOpen]);

  useEffect(() => {
    setWildcardInfo(null);
  }, [draft.hiddenLines]);

  const handleClose = useCallback(() => {
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    closeDialog();
    setSelectedIds(new Set());
    setSearch('');
    setFilterMode('visible');
    setWildcardInfo(null);
  }, [closeDialog]);

  // Draft changes immediately invalidate old responses; debounce only the next request.
  const schedulePreview = useCallback(() => {
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      void runPreview();
    }, 500);
  }, [runPreview]);

  const draftPolicy = useMemo(() => draftToPolicy(draft), [draft]);
  const currentView = catalogViewForPolicy(draftPolicy, inventory, preview);
  const previewEntries = useMemo(() => currentView?.entries ?? [], [currentView]);
  const savedPolicyActive = inventory && policiesEqual(inventory.policy, draftPolicy);

  const filteredEntries = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    return previewEntries.filter((entry) => {
      const matchesFilter =
        filterMode === 'all' ||
        (filterMode === 'visible' && !entry.hidden) ||
        (filterMode === 'hidden' && entry.hidden);
      const matchesSearch =
        !searchLower ||
        entry.id.toLowerCase().includes(searchLower) ||
        (entry.label ?? '').toLowerCase().includes(searchLower);
      return matchesFilter && matchesSearch;
    });
  }, [previewEntries, filterMode, search]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const hideSelected = useCallback(() => {
    const currentHidden = draft.hiddenLines
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const newHidden = [...new Set([...currentHidden, ...selectedIds])];
    updateDraft({ hiddenLines: newHidden.join('\n') });
    setSelectedIds(new Set());
    schedulePreview();
  }, [draft.hiddenLines, selectedIds, updateDraft, schedulePreview]);

  // Show the impact before editing wildcard rules; exact rules can be removed directly.
  const restoreEntry = useCallback(
    (entry: CatalogEntry) => {
      const { exact, wildcard } = splitWildcardRules(entry.hidden_rules);

      if (wildcard.length > 0) {
        const affectedCount = previewEntries.filter(
          (e) => e.hidden && e.hidden_rules.some((r) => wildcard.includes(r))
        ).length;

        setWildcardInfo({
          rules: wildcard,
          count: affectedCount,
        });
        hiddenRulesRef.current?.focus();
        hiddenRulesRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }

      if (exact.length > 0) {
        const currentHidden = draft.hiddenLines
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const ruleSet = new Set(exact);
        const remaining = currentHidden.filter((rule) => !ruleSet.has(rule));
        updateDraft({ hiddenLines: remaining.join('\n') });
        setWildcardInfo(null);
        schedulePreview();
      }
    },
    [draft.hiddenLines, previewEntries, updateDraft, schedulePreview]
  );

  const pinLines = useMemo(
    () =>
      draft.pinnedLines
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    [draft.pinnedLines]
  );

  const movePin = useCallback(
    (index: number, direction: -1 | 1) => {
      const next = reorderPin(pinLines, index, direction);
      updateDraft({ pinnedLines: next.join('\n') });
      schedulePreview();
    },
    [pinLines, updateDraft, schedulePreview]
  );

  const hideEntry = useCallback(
    (entry: CatalogEntry) => {
      const currentHidden = draft.hiddenLines
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!currentHidden.includes(entry.id)) {
        updateDraft({
          hiddenLines: [...currentHidden, entry.id].join('\n'),
        });
        schedulePreview();
      }
    },
    [draft.hiddenLines, updateDraft, schedulePreview]
  );

  const handleSave = useCallback(async () => {
    await save();
  }, [save]);

  // A stale or failed preview must not look like the current draft result.
  const hasError = Boolean(error || previewError || (inventoryError && !currentView));
  const counts = !hasError ? currentView?.counts : null;
  const visibleIds = !hasError ? (currentView?.visible_ids ?? []) : [];
  const modelSortEnabled = !hasError
    ? (preview?.model_sort_enabled ?? inventory?.model_sort_enabled ?? false)
    : false;

  const orderOptions = ORDER_OPTIONS.map((opt) => ({
    ...opt,
    label: t(`model_catalog.order_${opt.value}`, { defaultValue: opt.label }),
  }));

  const formatOptions = FORMAT_OPTIONS.map((opt) => ({
    ...opt,
    label: t(`model_catalog.format_${opt.value}`, { defaultValue: opt.label }),
  }));

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={t('model_catalog.title')}
      width={720}
      closeDisabled={saving}
      footer={
        <>
          {(saveStatus === 'pending' || error || inventoryError || previewError) && (
            <Button variant="secondary" onClick={() => void load()} disabled={saving || loading}>
              {t('common.refresh')}
            </Button>
          )}
          {saveStatus === 'applied' && (
            <span className={styles.saveStatusApplied} role="status">
              {t('model_catalog.save_status_applied')}
            </span>
          )}
          {saveStatus === 'pending' && (
            <span className={styles.saveStatusPending} role="status">
              {t('model_catalog.save_status_pending')}
            </span>
          )}
          {saveStatus === 'error' && saveError && (
            <span className={styles.saveError} role="alert">
              {saveError}
            </span>
          )}
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={loading || editRevision === 0}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className={styles.editor}>
        <div className={styles.toolbar}>
          <div className={styles.formatSelect}>
            <label htmlFor="mc-format" className={styles.fieldLabel}>
              {t('model_catalog.format_label')}
            </label>
            <Select
              id="mc-format"
              value={format}
              options={formatOptions}
              onChange={(value) => {
                setFormat(value as CatalogFormat);
              }}
              disabled={loading || saving}
              ariaLabel={t('model_catalog.format_label')}
            />
          </div>
          <div className={styles.orderSelect}>
            <label htmlFor="mc-order" className={styles.fieldLabel}>
              {t('model_catalog.order_label')}
            </label>
            <Select
              id="mc-order"
              value={draft.order}
              options={orderOptions}
              onChange={(value) => {
                updateDraft({ order: value as typeof draft.order });
                schedulePreview();
              }}
              disabled={loading || saving}
              ariaLabel={t('model_catalog.order_label')}
            />
          </div>
        </div>

        {loading && <div className="hint">{t('common.loading')}</div>}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {inventoryError && (
          <div className="status-badge warning" role="status">
            {t('model_catalog.inventory_error', { defaultValue: inventoryError })}
          </div>
        )}

        {modelSortEnabled && (
          <div className={`status-badge warning ${styles.overlapNotice}`} role="status">
            {t('model_catalog.overlap_notice')}
          </div>
        )}

        <div className={styles.entrySection}>
          <div className={styles.entryToolbar}>
            <div
              className={styles.filterButtons}
              role="group"
              aria-label={t('model_catalog.filter_label')}
            >
              {(['visible', 'hidden', 'all'] as FilterMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.filterBtn} ${filterMode === mode ? styles.filterBtnActive : ''}`}
                  onClick={() => setFilterMode(mode)}
                  aria-pressed={filterMode === mode}
                >
                  {t(`model_catalog.filter_${mode}`)}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="input"
              placeholder={t('model_catalog.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('model_catalog.search_placeholder')}
              disabled={loading}
            />
          </div>

          {selectedIds.size > 0 && (
            <div className={styles.bulkActions}>
              <Button size="sm" variant="secondary" onClick={hideSelected} disabled={saving}>
                {t('model_catalog.hide_selected', { count: selectedIds.size })}
              </Button>
            </div>
          )}

          <div className={styles.entryList} role="list">
            {filteredEntries.length === 0 ? (
              <div className="hint">
                {hasError
                  ? t('model_catalog.no_inventory_error')
                  : !currentView
                    ? t('common.loading')
                    : t('model_catalog.no_entries')}
              </div>
            ) : (
              filteredEntries.map((entry) => (
                <div key={entry.id} className={styles.entryRow} role="listitem">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => toggleSelection(entry.id)}
                    aria-label={entry.id}
                    disabled={saving}
                  />
                  <div className={styles.entryId}>{entry.id}</div>
                  {entry.label && entry.label !== entry.id && (
                    <div className={styles.entryLabel}>{entry.label}</div>
                  )}
                  {entry.hidden && (
                    <span className={styles.hiddenBadge} title={entry.hidden_rules.join(', ')}>
                      {t('model_catalog.hidden')}
                    </span>
                  )}
                  {entry.pinned_rules.length > 0 && (
                    <span className={styles.pinnedBadge} title={entry.pinned_rules.join(', ')}>
                      {t('model_catalog.pinned')}
                    </span>
                  )}
                  <div className={styles.entryActions}>
                    {entry.hidden ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => restoreEntry(entry)}
                        disabled={saving}
                        title={t('model_catalog.restore')}
                      >
                        {t('model_catalog.restore')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => hideEntry(entry)}
                        disabled={saving}
                        title={t('model_catalog.hide')}
                        aria-label={`${t('model_catalog.hide')}: ${entry.id}`}
                      >
                        {t('model_catalog.hide')}
                      </Button>
                    )}
                  </div>
                  {entry.hidden && entry.hidden_rules.length > 0 && (
                    <div className={styles.hiddenReasons}>
                      {t('model_catalog.hidden_by')}: {entry.hidden_rules.join(', ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.ruleSection}>
          <div className={styles.ruleField}>
            <label htmlFor="mc-hidden-rules" className={styles.fieldLabel}>
              {t('model_catalog.hidden_rules_label')}
            </label>
            <small className={styles.fieldHint}>{t('model_catalog.pattern_hint')}</small>
            <textarea
              id="mc-hidden-rules"
              ref={hiddenRulesRef}
              className={styles.textarea}
              value={draft.hiddenLines}
              onChange={(e) => {
                updateDraft({ hiddenLines: e.target.value });
                schedulePreview();
              }}
              rows={4}
              disabled={saving}
              aria-label={t('model_catalog.hidden_rules_label')}
              placeholder={'gpt-4\nclaude-*'}
            />
            {wildcardInfo && (
              <div className={styles.wildcardNotice} role="status">
                {t('model_catalog.wildcard_restore_hint', {
                  count: wildcardInfo.count,
                  rules: wildcardInfo.rules.join(', '),
                })}
              </div>
            )}
          </div>

          <div className={styles.ruleField}>
            <label htmlFor="mc-pinned-rules" className={styles.fieldLabel}>
              {t('model_catalog.pinned_rules_label')}
            </label>
            <small className={styles.fieldHint}>{t('model_catalog.pinned_hint')}</small>
            <textarea
              id="mc-pinned-rules"
              className={styles.textarea}
              value={draft.pinnedLines}
              onChange={(e) => {
                updateDraft({ pinnedLines: e.target.value });
                schedulePreview();
              }}
              rows={3}
              disabled={saving}
              aria-label={t('model_catalog.pinned_rules_label')}
              placeholder={'claude-3\nclaude-*'}
            />
            {pinLines.length > 0 && (
              <div className={styles.pinControls}>
                {pinLines.map((pattern, index) => (
                  <div key={`${pattern}-${index}`} className={styles.pinRow}>
                    <button
                      type="button"
                      className={styles.pinRowBtn}
                      onClick={() => movePin(index, -1)}
                      disabled={index === 0 || saving}
                      aria-label={`${t('model_catalog.move_up')}: ${pattern}`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.pinRowBtn}
                      onClick={() => movePin(index, 1)}
                      disabled={index === pinLines.length - 1 || saving}
                      aria-label={`${t('model_catalog.move_down')}: ${pattern}`}
                    >
                      ↓
                    </button>
                    <span className={styles.pinPattern}>{pattern}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.previewSection}>
          <div className={styles.previewHeader}>
            {t('model_catalog.preview_title')}
            {(previewLoading || (!currentView && !hasError)) && (
              <span className="hint"> {t('common.loading')}</span>
            )}
          </div>
          {previewError && (
            <div className="error-box" role="alert">
              {previewError}
            </div>
          )}
          {counts && (
            <div className={styles.previewCounts}>
              <span>
                {t('model_catalog.count_total')}: {counts.total}
              </span>
              <span>
                {t('model_catalog.count_visible')}: {counts.visible}
              </span>
              <span>
                {t('model_catalog.count_hidden')}: {counts.hidden}
              </span>
            </div>
          )}
          {visibleIds.length > 0 && (
            <div className={styles.visibleList}>
              <strong>{t('model_catalog.visible_order')}:</strong>
              <ol className={styles.visibleOrderList}>
                {visibleIds.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ol>
            </div>
          )}
          {configured && editRevision === 0 && !saveStatus && (
            <div className="hint">
              {t(
                savedPolicyActive
                  ? 'model_catalog.saved_policy_active'
                  : 'model_catalog.save_status_pending'
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ManageDisplayButton({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const openDialog = useModelCatalogEditor((s) => s.openDialog);
  return (
    <Button variant="secondary" size="sm" onClick={() => openDialog()} disabled={disabled}>
      {t('model_catalog.manage_display')}
    </Button>
  );
}
