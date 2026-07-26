export type RefreshProviderUsage = () => Promise<unknown>;

/**
 * Refresh usage after a provider mutation before updating the visible workbench.
 * A usage refresh failure must not make a completed configuration mutation look failed.
 */
export async function completeProviderMutation(
  refreshUsage: RefreshProviderUsage,
  onComplete: () => void
): Promise<void> {
  try {
    await refreshUsage();
  } catch {
    // The usage hook retains its last successful snapshot and retries on its interval.
  }
  onComplete();
}
