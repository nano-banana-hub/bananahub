import { readFile, access, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { VALID_PROFILES, VALID_DIFFICULTIES, VALID_TEMPLATE_TYPES } from './constants.js';

const SAMPLE_FILE_PATTERN = /^sample-[a-z0-9.]+(?:-[a-z0-9.]+)*-\d{2}\.(jpg|jpeg|png|webp)$/i;
const DEFAULT_TEMPLATE_TYPE = 'prompt';
const LICENSE_FILE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];

/**
 * Validate a template directory. Returns { valid, errors, warnings, meta }.
 */
export async function validateTemplate(dirPath) {
  const errors = [];
  const warnings = [];
  let meta = null;

  const tmplPath = join(dirPath, 'template.md');
  let content;
  try {
    content = await readFile(tmplPath, 'utf8');
  } catch {
    return { valid: false, errors: ['template.md not found'], warnings, meta };
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    return { valid: false, errors: ['No YAML frontmatter found (missing --- delimiters)'], warnings, meta };
  }

  const templateType = fm.type || DEFAULT_TEMPLATE_TYPE;
  meta = { ...fm, type: templateType };

  const requiredFields = ['title', 'profile'];
  for (const field of requiredFields) {
    if (!fm[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (fm.type && !VALID_TEMPLATE_TYPES.includes(fm.type)) {
    errors.push(`Invalid type "${fm.type}". Must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}`);
  } else if (!fm.type) {
    warnings.push('No type defined — defaulting to `prompt`. Add `type: prompt` or `type: workflow` for clarity');
  }

  if (fm.id && !/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/.test(fm.id)) {
    warnings.push(`ID "${fm.id}" should be lowercase, hyphens only, 3-50 chars`);
  }

  if (fm.profile && !VALID_PROFILES.includes(fm.profile)) {
    errors.push(`Invalid profile "${fm.profile}". Must be one of: ${VALID_PROFILES.join(', ')}`);
  }

  if (fm.difficulty && !VALID_DIFFICULTIES.includes(fm.difficulty)) {
    warnings.push(`Invalid difficulty "${fm.difficulty}". Should be: ${VALID_DIFFICULTIES.join(', ')}`);
  }

  if (!fm.tags || !Array.isArray(fm.tags) || fm.tags.length === 0) {
    warnings.push('No tags defined — templates are harder to discover without tags');
  } else if (fm.tags.length < 3) {
    warnings.push(`Only ${fm.tags.length} tags — recommend at least 3 for better discoverability`);
  }

  if (fm.version && !/^\d+\.\d+\.\d+/.test(fm.version)) {
    warnings.push(`Version "${fm.version}" is not valid semver`);
  }

  if (!fm.license || typeof fm.license !== 'string' || !fm.license.trim()) {
    warnings.push('No license declared — add `license: CC-BY-4.0` or another SPDX/CC identifier');
  }

  if (!fm.models || !Array.isArray(fm.models) || fm.models.length === 0) {
    warnings.push('No models listed — users won\'t know which models are tested');
  }

  validateBody(content, templateType, warnings);
  await validateLicenseFiles(dirPath, warnings);
  await validateSamplesDir(dirPath, templateType, warnings);
  await validateSampleMetadata(dirPath, meta, warnings);
  await validateReadme(dirPath, meta, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    meta
  };
}

function validateBody(content, templateType, warnings) {
  if (templateType === 'workflow') {
    const requiredSections = ['## Goal', '## Inputs', '## Steps', '## Prompt Blocks'];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        warnings.push(`Workflow template should include a "${section}" section`);
      }
    }
    if (!/^\d+\.\s+/m.test(content)) {
      warnings.push('Workflow template should include a numbered step list under "## Steps"');
    }
    return;
  }

  if (!content.includes('## Prompt Template') && !content.includes('## prompt template')) {
    warnings.push('No "## Prompt Template" section found');
  }

  const varMatches = content.match(/\{\{(\w+)(?:\|[^}]*)?\}\}/g);
  if (!varMatches || varMatches.length === 0) {
    warnings.push('No template variables ({{var|default}}) found — template is static');
  }
}

async function validateSamplesDir(dirPath, templateType, warnings) {
  try {
    const samplesDir = join(dirPath, 'samples');
    await access(samplesDir);
    const sampleFiles = await readdir(samplesDir);
    const imageFiles = sampleFiles.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (imageFiles.length === 0 && templateType === 'prompt') {
      warnings.push('samples/ directory exists but contains no images');
    }
  } catch {
    if (templateType === 'prompt') {
      warnings.push('No samples/ directory — sample images help users preview results');
    }
  }
}

async function validateLicenseFiles(dirPath, warnings) {
  const candidateDirs = [dirPath, dirname(dirPath)];
  const found = await Promise.all(candidateDirs.flatMap((baseDir) => LICENSE_FILE_NAMES.map(async (name) => {
    try {
      await access(join(baseDir, name));
      return true;
    } catch {
      return false;
    }
  })));

  if (!found.some(Boolean)) {
    warnings.push('No LICENSE file found — published/community templates should ship a repo license file');
  }
}

async function validateSampleMetadata(dirPath, fm, warnings) {
  if (!fm.samples || !Array.isArray(fm.samples) || fm.samples.length === 0) {
    if (fm.type === 'prompt') {
      warnings.push('No sample metadata in frontmatter — add `samples` entries with file/model/prompt/aspect');
    }
    return;
  }

  for (const sample of fm.samples) {
    if (!sample || typeof sample !== 'object') {
      warnings.push('Invalid sample metadata entry — each `samples` item should be an object');
      continue;
    }

    if (!sample.file) {
      warnings.push('A sample entry is missing `file`');
      continue;
    }

    const fileName = sample.file.split('/').pop();
    if (!SAMPLE_FILE_PATTERN.test(fileName)) {
      warnings.push(`Sample file "${sample.file}" should follow sample-{model-short}-{nn}.ext naming`);
    }

    if (!sample.model) {
      warnings.push(`Sample "${sample.file}" is missing \`model\``);
    } else if (!fileNameIncludesModel(fileName, sample.model)) {
      warnings.push(`Sample file "${sample.file}" should include the generating model shorthand for "${sample.model}"`);
    }

    if (!sample.prompt) {
      warnings.push(`Sample "${sample.file}" is missing \`prompt\``);
    }

    if (!sample.aspect) {
      warnings.push(`Sample "${sample.file}" is missing \`aspect\``);
    }

    try {
      await access(join(dirPath, sample.file));
    } catch {
      warnings.push(`Sample file not found on disk: ${sample.file}`);
    }
  }
}

async function validateReadme(dirPath, fm, warnings) {
  let readme;
  const candidatePaths = [join(dirPath, 'README.md'), join(dirname(dirPath), 'README.md')];
  for (const candidatePath of candidatePaths) {
    try {
      readme = await readFile(candidatePath, 'utf8');
      break;
    } catch {
      // try the next candidate
    }
  }

  if (!readme) {
    warnings.push('No README.md — published templates should document install, verified models, supported models, and sample mappings');
    return;
  }

  if (!hasSection(readme, ['Verified Models', '验证模型', '已验证模型'])) {
    warnings.push('README.md should include a "Verified Models" section');
  }

  if (!hasSection(readme, ['Supported Models', '支持模型', '兼容模型'])) {
    warnings.push('README.md should include a "Supported Models" section');
  }

  if (!hasSection(readme, ['License', '许可证', '授权'])) {
    warnings.push('README.md should include a "License" section');
  }

  if (!hasSection(readme, ['Sample Outputs', 'Sample Output', 'Samples', '样图', '示例输出'])) {
    warnings.push('README.md should include a sample mapping section that ties image files to models and prompts');
  }

  if (Array.isArray(fm.samples)) {
    for (const sample of fm.samples) {
      if (!sample || typeof sample !== 'object' || !sample.file) {
        continue;
      }

      const fileName = sample.file.split('/').pop();
      if (!readme.includes(fileName)) {
        warnings.push(`README.md should reference sample file "${fileName}" in its sample mapping`);
      }

      if (sample.model && !readme.includes(sample.model)) {
        warnings.push(`README.md should mention sample model "${sample.model}"`);
      }
    }
  }
}

function hasSection(content, names) {
  return names.some((name) => {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(name)}\\s*$`, 'im');
    return pattern.test(content);
  });
}

function fileNameIncludesModel(fileName, modelName) {
  const normalizedFileName = String(fileName || '').toLowerCase();
  const normalizedModel = String(modelName || '').toLowerCase();
  const versionTierMatch = normalizedModel.match(/gemini-(\d+(?:\.\d+)?)-(pro|flash)/);

  if (normalizedFileName.includes(normalizedModel)) {
    return true;
  }

  if (versionTierMatch) {
    const shorthand = `${versionTierMatch[1]}-${versionTierMatch[2]}`;
    return normalizedFileName.includes(shorthand);
  }

  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
