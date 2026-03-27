import { mkdir, copyFile, rm } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { INBOX_DIRNAME } from '../shared/constants.js';

/**
 * Stages files from the sender's project into a `.dialup-inbox/` directory
 * in the target project. Returns the absolute path to the inbox directory,
 * or null if no files were staged.
 */
export async function stageFiles(
  senderProject: string,
  targetProject: string,
  files: string[],
): Promise<string | null> {
  if (files.length === 0) return null;

  const inboxDir = join(targetProject, INBOX_DIRNAME);
  await mkdir(inboxDir, { recursive: true });

  for (const file of files) {
    // Resolve relative paths against sender's project
    const sourcePath = resolve(senderProject, file);

    // Security: ensure resolved path is within sender's project
    // Trailing separator prevents prefix collisions (e.g. /some/dir vs /some/dirty)
    if (!sourcePath.startsWith(resolve(senderProject) + '/')) {
      throw new Error(`File path escapes sender project: ${file}`);
    }

    const destPath = join(inboxDir, basename(sourcePath));
    await copyFile(sourcePath, destPath);
  }

  return inboxDir;
}

/**
 * Cleans up the `.dialup-inbox/` directory from the target project.
 * Best-effort — silently ignores errors (directory may already be gone).
 */
export async function cleanupInbox(targetProject: string): Promise<void> {
  const inboxDir = join(targetProject, INBOX_DIRNAME);
  try {
    await rm(inboxDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}
