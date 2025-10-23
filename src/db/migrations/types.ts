export interface Migration {
  version: number;
  name: string;
  up: () => Promise<void>;
  down?: () => Promise<void>;
}

export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: number;
  success: boolean;
  error?: string;
}
