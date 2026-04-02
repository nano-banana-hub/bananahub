import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATES_DIR, LEGACY_TEMPLATES_DIR } from './constants.js';

async function dirExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensurePrimaryTemplatesDir() {
  await mkdir(TEMPLATES_DIR, { recursive: true });
  return TEMPLATES_DIR;
}

export async function getTemplateRoots() {
  const roots = [];
  const primaryExists = await dirExists(TEMPLATES_DIR);
  const legacyExists = await dirExists(LEGACY_TEMPLATES_DIR);

  if (primaryExists) {
    roots.push(TEMPLATES_DIR);
  }

  if (legacyExists) {
    roots.push(LEGACY_TEMPLATES_DIR);
  }

  if (roots.length === 0) {
    await ensurePrimaryTemplatesDir();
    roots.push(TEMPLATES_DIR);
  }

  return roots;
}

export async function resolveInstalledTemplateDir(id) {
  for (const root of await getTemplateRoots()) {
    const candidate = join(root, id);
    if (await dirExists(candidate)) {
      return candidate;
    }
  }

  return join(TEMPLATES_DIR, id);
}

export async function resolveInstalledTemplateDirs(id) {
  const dirs = [];

  for (const root of await getTemplateRoots()) {
    const candidate = join(root, id);
    if (await dirExists(candidate)) {
      dirs.push(candidate);
    }
  }

  return dirs;
}
