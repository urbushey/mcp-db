import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { IDbAdapter } from "./adapter.ts";
import { SqliteAdapter } from "./sqlite.ts";

interface RegistryEntry {
  name: string;
  path: string;
  createdAt: string;
}

interface RegistryManifest {
  databases: RegistryEntry[];
}

export class DatabaseRegistry {
  private adapters: Map<string, SqliteAdapter> = new Map();
  private manifest: RegistryManifest = { databases: [] };
  private manifestPath: string;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.manifestPath = join(dataDir, "_registry.json");

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    if (existsSync(this.manifestPath)) {
      const raw = readFileSync(this.manifestPath, "utf-8");
      this.manifest = JSON.parse(raw) as RegistryManifest;
    }
  }

  list(): string[] {
    return this.manifest.databases.map((d) => d.name);
  }

  exists(name: string): boolean {
    return this.manifest.databases.some((d) => d.name === name);
  }

  get(name: string): IDbAdapter {
    if (!this.exists(name)) {
      throw new Error(`Database "${name}" does not exist`);
    }

    if (!this.adapters.has(name)) {
      const entry = this.manifest.databases.find((d) => d.name === name)!;
      this.adapters.set(name, new SqliteAdapter(entry.path));
    }

    return this.adapters.get(name)!;
  }

  async create(name: string): Promise<IDbAdapter> {
    if (this.exists(name)) {
      throw new Error(`Database "${name}" already exists`);
    }

    const filePath = join(this.dataDir, `${name}.sqlite`);
    const adapter = new SqliteAdapter(filePath);
    this.adapters.set(name, adapter);

    const entry: RegistryEntry = {
      name,
      path: filePath,
      createdAt: new Date().toISOString(),
    };
    this.manifest.databases.push(entry);
    this.saveManifest();

    return adapter;
  }

  private saveManifest(): void {
    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), "utf-8");
  }
}
