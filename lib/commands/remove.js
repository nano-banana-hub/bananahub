import { rm, access } from 'node:fs/promises';
import { rebuildRegistry } from '../registry.js';
import { bold, green, red } from '../color.js';
import { resolveInstalledTemplateDirs } from '../paths.js';

export async function removeCommand(args) {
  const id = args[0];
  if (!id) {
    console.error(red('Usage: bananahub remove <template-id>'));
    process.exit(1);
  }

  const dirs = await resolveInstalledTemplateDirs(id);
  if (dirs.length === 0) {
    console.error(red(`Template "${id}" is not installed.`));
    process.exit(1);
  }

  for (const dir of dirs) {
    try {
      await access(dir);
      await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore races and partial legacy cleanup
    }
  }
  await rebuildRegistry();
  console.log(green(`  Removed: ${bold(id)}`));
}
