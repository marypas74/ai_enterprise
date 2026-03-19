import type { CatalogItemInput } from './CatalogParser.js';

export interface DiffResult {
  readonly added: readonly CatalogItemInput[];
  readonly updated: readonly CatalogItemInput[];
  readonly removed: readonly string[];
}

export function calculateDiff(
  remote: readonly CatalogItemInput[],
  localSourceIds: ReadonlySet<string>,
  localVersions: ReadonlyMap<string, string>,
): DiffResult {
  const added: CatalogItemInput[] = [];
  const updated: CatalogItemInput[] = [];
  const remoteSourceIds = new Set<string>();

  for (const item of remote) {
    remoteSourceIds.add(item.source_id);

    if (!localSourceIds.has(item.source_id)) {
      added.push(item);
    } else {
      const localVersion = localVersions.get(item.source_id);
      if (localVersion !== item.version) {
        updated.push(item);
      }
    }
  }

  const removed: string[] = [];
  for (const sourceId of localSourceIds) {
    if (!remoteSourceIds.has(sourceId)) {
      removed.push(sourceId);
    }
  }

  return { added, updated, removed };
}
