/**
 * Plugin Loader Service — "Mad Hatter"
 *
 * Discovery, loading, and lifecycle management for file-based plugins.
 *
 * Plugin folder structure:
 *   plugins/{plugin-id}/
 *     ├── plugin.json         — manifest (name, version, author, hooks, tools, forms, endpoints)
 *     ├── index.ts / index.js — entry point module
 *     ├── settings.json       — optional default settings (JSON Schema)
 *     └── ...                 — additional files
 *
 * Entry point module exports:
 *   hooks   — Record<HookName, (data, ctx) => data>
 *   tools   — Array<ToolDefinition>
 *   forms   — Array<FormDefinition>
 *   endpoints — Array<EndpointDefinition>
 *   activate(ctx)   — called on plugin activation
 *   deactivate(ctx) — called on plugin deactivation
 */

import { FastifyInstance } from 'fastify';
import { readdir, readFile, access } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { findOne, findMany, insertOne, updateOne } from '../database/index.js';
import { eventBus, type HookName, type HookHandler } from './EventBusService.js';
import { ProceduralMemoryService } from './ProceduralMemoryService.js';
import { PermissionService, type Resource, type Permission } from './PermissionService.js';
import type mysql from 'mysql2/promise';

// ---- Types ----

export interface PluginManifest {
  name: string;
  display_name: string;
  version: string;
  author: string;
  description?: string;
  category?: 'tools' | 'integrations' | 'utilities' | 'ai' | 'data' | 'other';
  icon?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  config_schema?: Record<string, any>;
  dependencies?: string[];
  /** Resource permissions required by this plugin (checked at activation) */
  required_permissions?: { resource: string; permissions: string[] }[];
}

export interface ToolDefinition {
  name: string;
  display_name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  input_schema: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  output_schema?: Record<string, any>;
  requires_approval?: boolean;
  return_direct?: boolean;
  start_examples?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  execute: (input: any, ctx: PluginContext) => Promise<any>;
}

export interface FormDefinition {
  name: string;
  display_name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  json_schema: Record<string, any>;
  start_examples?: string[];
  stop_examples?: string[];
  ask_confirm?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  on_submit: (data: any, ctx: PluginContext) => Promise<any>;
}

export interface EndpointDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description?: string;
  requiresAuth?: boolean;
  requiresAdmin?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  handler: (request: any, reply: any) => Promise<any>;
}

export interface PluginContext {
  pluginId: number;
  pluginName: string;
  fastify: FastifyInstance;
  db: mysql.Pool;
  eventBus: typeof eventBus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  getSettings: () => Promise<Record<string, any>>;
  /** Check if a user has permission on a resource */
  checkPermission: (userId: number, userRole: string, resource: Resource, permission: Permission) => Promise<boolean>;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface LoadedPlugin {
  id: number;
  manifest: PluginManifest;
  dirPath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  module: any;
  registeredHandlerIds: string[];
  registeredToolIds: number[];
  registeredFormIds: number[];
  registeredEndpoints: string[];
  active: boolean;
}

// ---- Service ----

export class PluginLoaderService {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginsDir: string;
  private static instance: PluginLoaderService | null = null;

  constructor(private fastify: FastifyInstance, private db: mysql.Pool) {
    this.pluginsDir = join(process.cwd(), 'plugins');
  }

  static getInstance(fastify: FastifyInstance, db: mysql.Pool): PluginLoaderService {
    if (!PluginLoaderService.instance) {
      PluginLoaderService.instance = new PluginLoaderService(fastify, db);
    }
    return PluginLoaderService.instance;
  }

  /** Discover and load all plugins from the plugins/ directory */
  async discoverAndLoad(): Promise<void> {
    try {
      await access(this.pluginsDir);
    } catch {
      this.fastify.log.info(`[PluginLoader] No plugins directory at ${this.pluginsDir}, skipping`);
      return;
    }

    const entries = await readdir(this.pluginsDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    this.fastify.log.info(`[PluginLoader] Found ${dirs.length} plugin directories`);

    for (const dir of dirs) {
      try {
        await this.loadPlugin(dir.name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (err: any) {
        this.fastify.log.error(`[PluginLoader] Failed to load plugin "${dir.name}": ${err.message}`);
      }
    }
  }

  /** Load a single plugin by directory name */
  async loadPlugin(dirName: string): Promise<LoadedPlugin | null> {
    const dirPath = join(this.pluginsDir, dirName);

    // Read manifest
    const manifestPath = join(dirPath, 'plugin.json');
    let manifest: PluginManifest;
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(raw);
    } catch {
      this.fastify.log.warn(`[PluginLoader] No valid plugin.json in ${dirName}, skipping`);
      return null;
    }

    // Check if already loaded
    if (this.plugins.has(manifest.name)) {
      this.fastify.log.warn(`[PluginLoader] Plugin "${manifest.name}" already loaded, skipping duplicate`);
      return null;
    }

    // Ensure DB registration
    const pluginId = await this.ensureDbRegistration(manifest, dirPath);

    // Check if plugin is enabled in DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const dbPlugin = await findOne<any>(this.db, 'SELECT is_enabled FROM plugins WHERE id = ?', [pluginId]);
    if (dbPlugin && !dbPlugin.is_enabled) {
      this.fastify.log.info(`[PluginLoader] Plugin "${manifest.name}" is disabled, skipping activation`);
      const loaded: LoadedPlugin = {
        id: pluginId, manifest, dirPath, module: null,
        registeredHandlerIds: [], registeredToolIds: [], registeredFormIds: [],
        registeredEndpoints: [], active: false,
      };
      this.plugins.set(manifest.name, loaded);
      return loaded;
    }

    // Dynamic import of the entry point
    const entryFile = await this.findEntryPoint(dirPath);
    if (!entryFile) {
      this.fastify.log.warn(`[PluginLoader] No entry point found for "${manifest.name}"`);
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    let module: any;
    try {
      const entryUrl = pathToFileURL(entryFile).href;
      module = await import(entryUrl);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
      this.fastify.log.error(`[PluginLoader] Failed to import "${manifest.name}": ${err.message}`);
      return null;
    }

    const loaded: LoadedPlugin = {
      id: pluginId, manifest, dirPath, module,
      registeredHandlerIds: [], registeredToolIds: [], registeredFormIds: [],
      registeredEndpoints: [], active: false,
    };

    this.plugins.set(manifest.name, loaded);

    // Activate
    await this.activatePlugin(loaded);

    return loaded;
  }

  /** Activate a loaded plugin — register hooks, tools, forms, endpoints */
  private async activatePlugin(plugin: LoadedPlugin): Promise<void> {
    const ctx = this.buildContext(plugin);
    const mod = plugin.module;

    // Call activate() lifecycle hook
    if (typeof mod.activate === 'function') {
      try {
        await mod.activate(ctx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (err: any) {
        this.fastify.log.error(`[PluginLoader] activate() failed for "${plugin.manifest.name}": ${err.message}`);
      }
    }

    // Log required permissions from manifest (informational)
    if (plugin.manifest.required_permissions && plugin.manifest.required_permissions.length > 0) {
      const perms = plugin.manifest.required_permissions
        .map(rp => `${rp.resource}:[${rp.permissions.join(',')}]`)
        .join(', ');
      this.fastify.log.info(`[PluginLoader] Plugin "${plugin.manifest.name}" requires permissions: ${perms}`);
    }

    // Register hooks
    if (mod.hooks && typeof mod.hooks === 'object') {
      for (const [hookName, handler] of Object.entries(mod.hooks)) {
        if (typeof handler !== 'function') continue;
        const handlerId = `plugin:${plugin.manifest.name}:${hookName}`;
        const hookHandler: HookHandler = {
          id: handlerId,
          name: `${plugin.manifest.display_name} — ${hookName}`,
          hookName: hookName as HookName,
          priority: 10,
          pluginId: plugin.id,
          enabled: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
          handler: handler as any,
        };
        eventBus.register(hookHandler);
        plugin.registeredHandlerIds.push(handlerId);
      }
      if (plugin.registeredHandlerIds.length > 0) {
        this.fastify.log.info(`[PluginLoader] Registered ${plugin.registeredHandlerIds.length} hooks for "${plugin.manifest.name}"`);
      }
    }

    // Procedural memory service for embedding tools/forms
    const proceduralMemory = new ProceduralMemoryService(this.fastify, this.db);

    // Register tools
    if (Array.isArray(mod.tools)) {
      for (const toolDef of mod.tools as ToolDefinition[]) {
        try {
          const toolId = await this.registerTool(plugin, toolDef);
          plugin.registeredToolIds.push(toolId);
          // Embed tool into procedural memory for semantic retrieval
          proceduralMemory.registerProcedural({
            name: toolDef.name,
            description: toolDef.description,
            type: 'tool',
            pluginId: plugin.id,
            triggerType: 'description',
            examples: toolDef.start_examples,
          }).catch(err => this.fastify.log.warn(`[PluginLoader] Procedural embed failed for tool "${toolDef.name}": ${err.message}`));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (err: any) {
          this.fastify.log.warn(`[PluginLoader] Failed to register tool "${toolDef.name}": ${err.message}`);
        }
      }
      if (plugin.registeredToolIds.length > 0) {
        this.fastify.log.info(`[PluginLoader] Registered ${plugin.registeredToolIds.length} tools for "${plugin.manifest.name}"`);
      }
    }

    // Register forms
    if (Array.isArray(mod.forms)) {
      for (const formDef of mod.forms as FormDefinition[]) {
        try {
          const formId = await this.registerForm(plugin, formDef);
          plugin.registeredFormIds.push(formId);
          // Embed form into procedural memory for semantic retrieval
          proceduralMemory.registerProcedural({
            name: formDef.name,
            description: formDef.description,
            type: 'form',
            pluginId: plugin.id,
            triggerType: 'description',
            examples: formDef.start_examples,
          }).catch(err => this.fastify.log.warn(`[PluginLoader] Procedural embed failed for form "${formDef.name}": ${err.message}`));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (err: any) {
          this.fastify.log.warn(`[PluginLoader] Failed to register form "${formDef.name}": ${err.message}`);
        }
      }
      if (plugin.registeredFormIds.length > 0) {
        this.fastify.log.info(`[PluginLoader] Registered ${plugin.registeredFormIds.length} forms for "${plugin.manifest.name}"`);
      }
    }

    // Register custom endpoints
    if (Array.isArray(mod.endpoints)) {
      for (const ep of mod.endpoints as EndpointDefinition[]) {
        try {
          this.registerEndpoint(plugin, ep);
          plugin.registeredEndpoints.push(`${ep.method} ${ep.path}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        } catch (err: any) {
          this.fastify.log.warn(`[PluginLoader] Failed to register endpoint "${ep.method} ${ep.path}": ${err.message}`);
        }
      }
      if (plugin.registeredEndpoints.length > 0) {
        this.fastify.log.info(`[PluginLoader] Registered ${plugin.registeredEndpoints.length} endpoints for "${plugin.manifest.name}"`);
      }
    }

    plugin.active = true;
    this.fastify.log.info(`[PluginLoader] ✓ Plugin "${plugin.manifest.name}" v${plugin.manifest.version} activated`);
  }

  /** Deactivate a plugin — unregister all hooks, tools, forms */
  async deactivatePlugin(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin || !plugin.active) return false;

    // Unregister hooks
    eventBus.unregisterPlugin(plugin.id);
    plugin.registeredHandlerIds = [];

    // Remove procedural memory entries for this plugin
    try {
      const proceduralMemory = new ProceduralMemoryService(this.fastify, this.db);
      await proceduralMemory.unregisterPlugin(plugin.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (err: any) {
      this.fastify.log.warn(`[PluginLoader] Procedural memory cleanup failed for "${pluginName}": ${err.message}`);
    }

    // Call deactivate() lifecycle hook
    if (plugin.module && typeof plugin.module.deactivate === 'function') {
      try {
        await plugin.module.deactivate(this.buildContext(plugin));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (err: any) {
        this.fastify.log.warn(`[PluginLoader] deactivate() failed for "${pluginName}": ${err.message}`);
      }
    }

    plugin.active = false;
    this.fastify.log.info(`[PluginLoader] Plugin "${pluginName}" deactivated`);
    return true;
  }

  /** Reload a plugin (deactivate + reimport + activate) */
  async reloadPlugin(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return false;

    await this.deactivatePlugin(pluginName);
    this.plugins.delete(pluginName);

    const dirName = plugin.dirPath.split('/').pop()!;
    const reloaded = await this.loadPlugin(dirName);
    return reloaded !== null;
  }

  /** Get all loaded plugins */
  getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get a specific loaded plugin */
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  // ---- Private helpers ----

  private async findEntryPoint(dirPath: string): Promise<string | null> {
    const candidates = ['index.js', 'index.mjs', 'index.ts'];
    for (const file of candidates) {
      const filePath = join(dirPath, file);
      try {
        await access(filePath);
        return filePath;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async ensureDbRegistration(manifest: PluginManifest, dirPath: string): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const existing = await findOne<any>(this.db, 'SELECT id, version FROM plugins WHERE name = ?', [manifest.name]);

    if (existing) {
      // Update version if changed
      if (existing.version !== manifest.version) {
        await updateOne(this.db,
          'UPDATE plugins SET version = ?, display_name = ?, description = ?, author = ?, category = ?, icon = ?, config_schema = ?, install_path = ? WHERE id = ?',
          [manifest.version, manifest.display_name, manifest.description || null,
           manifest.author, manifest.category || 'other', manifest.icon || null,
           manifest.config_schema ? JSON.stringify(manifest.config_schema) : null,
           dirPath, existing.id],
        );
      }
      return existing.id;
    }

    // Create new DB entry
    return insertOne(this.db,
      `INSERT INTO plugins (name, display_name, description, version, author, category, icon, config_schema, is_system, is_enabled, install_path, entry_point)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, TRUE, ?, 'index.js')`,
      [manifest.name, manifest.display_name, manifest.description || null,
       manifest.version, manifest.author, manifest.category || 'other',
       manifest.icon || null, manifest.config_schema ? JSON.stringify(manifest.config_schema) : null,
       dirPath],
    );
  }

  private async registerTool(plugin: LoadedPlugin, toolDef: ToolDefinition): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const existing = await findOne<any>(this.db, 'SELECT id FROM tools WHERE name = ?', [toolDef.name]);
    if (existing) {
      await updateOne(this.db,
        'UPDATE tools SET display_name = ?, description = ?, input_schema = ?, output_schema = ?, requires_approval = ?, plugin_id = ? WHERE id = ?',
        [toolDef.display_name, toolDef.description,
         JSON.stringify(toolDef.input_schema), toolDef.output_schema ? JSON.stringify(toolDef.output_schema) : null,
         toolDef.requires_approval || false, plugin.id, existing.id],
      );
      return existing.id;
    }

    return insertOne(this.db,
      `INSERT INTO tools (plugin_id, name, display_name, description, tool_type, input_schema, output_schema, requires_approval, is_enabled)
       VALUES (?, ?, ?, ?, 'function', ?, ?, ?, TRUE)`,
      [plugin.id, toolDef.name, toolDef.display_name, toolDef.description,
       JSON.stringify(toolDef.input_schema), toolDef.output_schema ? JSON.stringify(toolDef.output_schema) : null,
       toolDef.requires_approval || false],
    );
  }

  private async registerForm(plugin: LoadedPlugin, formDef: FormDefinition): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const existing = await findOne<any>(this.db, 'SELECT id FROM conversational_forms WHERE name = ?', [formDef.name]);
    if (existing) {
      await updateOne(this.db,
        'UPDATE conversational_forms SET display_name = ?, description = ?, json_schema = ?, start_examples = ?, stop_examples = ?, ask_confirm = ?, plugin_id = ? WHERE id = ?',
        [formDef.display_name, formDef.description, JSON.stringify(formDef.json_schema),
         formDef.start_examples ? JSON.stringify(formDef.start_examples) : null,
         formDef.stop_examples ? JSON.stringify(formDef.stop_examples) : null,
         formDef.ask_confirm ?? true, plugin.id, existing.id],
      );
      return existing.id;
    }

    return insertOne(this.db,
      `INSERT INTO conversational_forms (name, display_name, description, json_schema, start_examples, stop_examples, ask_confirm, plugin_id, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [formDef.name, formDef.display_name, formDef.description,
       JSON.stringify(formDef.json_schema),
       formDef.start_examples ? JSON.stringify(formDef.start_examples) : null,
       formDef.stop_examples ? JSON.stringify(formDef.stop_examples) : null,
       formDef.ask_confirm ?? true, plugin.id],
    );
  }

  private registerEndpoint(plugin: LoadedPlugin, ep: EndpointDefinition): void {
    const prefix = `/api/plugins/${plugin.manifest.name}`;
    const fullPath = `${prefix}${ep.path}`;
    const method = ep.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const hooks: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    if (ep.requiresAuth) hooks.push((this.fastify as any).authenticate);
    if (ep.requiresAdmin) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      hooks.push(async (request: any, reply: any) => {
        const user = request.user as { role: string };
        if (user.role !== 'admin') return reply.status(403).send({ error: 'Admin required' });
      });
    }

    this.fastify[method](fullPath, {
      ...(hooks.length > 0 ? { onRequest: hooks } : {}),
      schema: {
        description: ep.description || `Plugin endpoint: ${ep.method} ${ep.path}`,
        tags: ['plugins'],
      },
    }, ep.handler);
  }

  private buildContext(plugin: LoadedPlugin): PluginContext {
    const permService = new PermissionService(this.db);
    return {
      pluginId: plugin.id,
      pluginName: plugin.manifest.name,
      fastify: this.fastify,
      db: this.db,
      eventBus,
      checkPermission: (userId: number, userRole: string, resource: Resource, permission: Permission) =>
        permService.check(userId, userRole, resource, permission),
      getSettings: async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const rows = await findMany<any>(this.db,
          'SELECT setting_key, setting_value FROM plugin_settings WHERE plugin_id = ? AND user_id IS NULL',
          [plugin.id],
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        const settings: Record<string, any> = {};
        for (const r of rows) {
          try {
            settings[r.setting_key] = JSON.parse(r.setting_value);
          } catch {
            settings[r.setting_key] = r.setting_value;
          }
        }
        return settings;
      },
      log: {
        info: (msg: string) => this.fastify.log.info(`[Plugin:${plugin.manifest.name}] ${msg}`),
        warn: (msg: string) => this.fastify.log.warn(`[Plugin:${plugin.manifest.name}] ${msg}`),
        error: (msg: string) => this.fastify.log.error(`[Plugin:${plugin.manifest.name}] ${msg}`),
      },
    };
  }
}
