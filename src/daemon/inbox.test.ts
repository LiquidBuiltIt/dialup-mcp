import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stageFiles, cleanupInbox } from './inbox.js';
import { INBOX_DIRNAME } from '../shared/constants.js';

let senderDir: string;
let targetDir: string;

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'dialup-inbox-test-'));
  senderDir = join(base, 'sender');
  targetDir = join(base, 'target');
  await mkdir(senderDir, { recursive: true });
  await mkdir(targetDir, { recursive: true });
  return base;
}

describe('stageFiles', () => {
  let base: string;

  beforeEach(async () => {
    base = await setup();
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('copies files to target inbox directory', async () => {
    await writeFile(join(senderDir, 'file1.txt'), 'hello');
    await writeFile(join(senderDir, 'file2.txt'), 'world');

    const inboxDir = await stageFiles(senderDir, targetDir, ['file1.txt', 'file2.txt']);

    assert.equal(inboxDir, join(targetDir, INBOX_DIRNAME));
    assert.equal(await readFile(join(inboxDir!, 'file1.txt'), 'utf-8'), 'hello');
    assert.equal(await readFile(join(inboxDir!, 'file2.txt'), 'utf-8'), 'world');
  });

  it('resolves relative paths against sender project', async () => {
    await mkdir(join(senderDir, 'src'), { recursive: true });
    await writeFile(join(senderDir, 'src', 'index.ts'), 'export default 42;');

    const inboxDir = await stageFiles(senderDir, targetDir, ['src/index.ts']);

    assert.equal(await readFile(join(inboxDir!, 'index.ts'), 'utf-8'), 'export default 42;');
  });

  it('returns null for empty files array', async () => {
    const result = await stageFiles(senderDir, targetDir, []);
    assert.equal(result, null);
  });

  it('rejects relative path traversal (../)', async () => {
    // Create a file outside sender's project
    await writeFile(join(base, 'secret.txt'), 'sensitive data');

    await assert.rejects(
      () => stageFiles(senderDir, targetDir, ['../secret.txt']),
      { message: /escapes sender project/ },
    );
  });

  it('rejects absolute path outside sender project', async () => {
    await assert.rejects(
      () => stageFiles(senderDir, targetDir, ['/etc/passwd']),
      { message: /escapes sender project/ },
    );
  });

  it('rejects path traversal with prefix collision', async () => {
    // senderDir is e.g. /tmp/.../sender
    // Create a sibling directory that shares the prefix
    const siblingDir = senderDir + '-evil';
    await mkdir(siblingDir, { recursive: true });
    await writeFile(join(siblingDir, 'payload.txt'), 'malicious');

    // Relative traversal to sibling: ../sender-evil/payload.txt
    await assert.rejects(
      () => stageFiles(senderDir, targetDir, ['../sender-evil/payload.txt']),
      { message: /escapes sender project/ },
    );
  });

  it('throws on nonexistent source file', async () => {
    await assert.rejects(
      () => stageFiles(senderDir, targetDir, ['does-not-exist.txt']),
    );
  });
});

describe('cleanupInbox', () => {
  let base: string;

  beforeEach(async () => {
    base = await setup();
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('removes the inbox directory and all contents', async () => {
    // Create inbox with files
    const inboxDir = join(targetDir, INBOX_DIRNAME);
    await mkdir(inboxDir, { recursive: true });
    await writeFile(join(inboxDir, 'file1.txt'), 'data');
    await writeFile(join(inboxDir, 'file2.txt'), 'data');

    await cleanupInbox(targetDir);

    await assert.rejects(() => access(inboxDir), { code: 'ENOENT' });
  });

  it('does not throw when inbox does not exist', async () => {
    // Should not throw — best effort cleanup
    await cleanupInbox(targetDir);
  });
});
