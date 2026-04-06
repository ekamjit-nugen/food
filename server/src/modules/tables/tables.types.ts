/**
 * Domain types for the dining tables module.
 *
 * "Table" is an overloaded word in a system that also has database tables.
 * We use `DiningTable` in TypeScript and `dining_tables` in SQL for clarity.
 */
export interface DiningTable {
  id: string;
  outletId: string;
  code: string;
  label: string | null;
  section: string | null;
  seats: number;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
