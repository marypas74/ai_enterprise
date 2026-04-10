import type mysql from 'mysql2/promise';
import type { Migration } from '../connection.js';
import { execute } from '../helpers.js';

async function up(pool: mysql.Pool): Promise<void> {
  // Remove duplicate installations keeping the most recent one per (catalog_item_id, installed_by)
  await execute(
    pool,
    `DELETE mi FROM marketplace_installations mi
     INNER JOIN (
       SELECT catalog_item_id, installed_by, MAX(id) AS keep_id
       FROM marketplace_installations
       GROUP BY catalog_item_id, installed_by
       HAVING COUNT(*) > 1
     ) dups
     ON mi.catalog_item_id = dups.catalog_item_id
        AND mi.installed_by = dups.installed_by
        AND mi.id <> dups.keep_id`,
  );

  // Add unique constraint to prevent future duplicates
  await execute(
    pool,
    `ALTER TABLE marketplace_installations
     ADD UNIQUE KEY uk_catalog_user (catalog_item_id, installed_by)`,
  );
}

export const uniqueInstallation: Migration = {
  name: '002-unique-installation',
  up,
};
