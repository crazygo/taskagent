import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { addLog } from '../logger.js';

const SETTINGS_DIR = '.askman';
const SETTINGS_FILE = 'settings.json';

export interface WorkspaceSettings {
  sessions: string[];
}

const DEFAULT_SETTINGS: WorkspaceSettings = { sessions: [] };

const getSettingsDirectory = (workspacePath: string) => join(workspacePath, SETTINGS_DIR);
export const getSettingsFilePath = (workspacePath: string) =>
  join(getSettingsDirectory(workspacePath), SETTINGS_FILE);

const sanitizeSettings = (raw: unknown): WorkspaceSettings => {
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).sessions)) {
    const normalized = (raw as any).sessions.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0);
    return { sessions: normalized.map((value: string) => value.trim()) };
  }
  return { ...DEFAULT_SETTINGS };
};

export const loadWorkspaceSettings = async (workspacePath: string): Promise<WorkspaceSettings> => {
  const dir = getSettingsDirectory(workspacePath);
  const file = getSettingsFilePath(workspacePath);
  
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error: any) {
    // If we can't create the directory (e.g., permission denied in test sandbox),
    // return defaults without writing
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      addLog(`[Workspace] Cannot create settings directory (${error.code}), using defaults`);
      return { ...DEFAULT_SETTINGS };
    }
    throw error;
  }

  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const settings = sanitizeSettings(parsed);
    return settings;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      // Try to write, but don't fail if we can't
      try {
        await fs.writeFile(file, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
      } catch (writeError: any) {
        if (writeError?.code === 'EPERM' || writeError?.code === 'EACCES') {
          addLog(`[Workspace] Cannot write settings file (${writeError.code}), using defaults`);
        } else {
          throw writeError;
        }
      }
      return { ...DEFAULT_SETTINGS };
    }
    addLog(`[Workspace] Failed to read settings: ${error instanceof Error ? error.message : String(error)}`);
    // Attempt to reset file to defaults if JSON parsing failed
    try {
      await fs.writeFile(file, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    } catch (writeError: any) {
      if (writeError?.code === 'EPERM' || writeError?.code === 'EACCES') {
        addLog(`[Workspace] Cannot write settings file (${writeError.code}), using defaults`);
      } else {
        throw writeError;
      }
    }
    return { ...DEFAULT_SETTINGS };
  }
};

export const writeWorkspaceSettings = async (
  workspacePath: string,
  settings: WorkspaceSettings
): Promise<void> => {
  const file = getSettingsFilePath(workspacePath);
  const data = JSON.stringify(
    {
      sessions: Array.isArray(settings.sessions)
        ? settings.sessions.filter(session => typeof session === 'string' && session.trim().length > 0)
        : [],
    },
    null,
    2
  );
  
  try {
    await fs.mkdir(getSettingsDirectory(workspacePath), { recursive: true });
    await fs.writeFile(file, data, 'utf8');
  } catch (error: any) {
    // Silently fail in sandboxed environments (e.g., tests)
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      addLog(`[Workspace] Cannot write settings (${error.code}), skipping`);
      return;
    }
    throw error;
  }
};
