#!/usr/bin/env node

/**
 * NSoC Wiki Post Validator
 * Validates MDX files in the posts/ directory for:
 * - Proper kebab-case filename
 * - Valid YAML frontmatter syntax
 * - Required fields (title, description, date, category)
 * - Field types and constraints (dates, lengths, arrays)
 * - Valid content body length and absence of conflict markers
 *
 * Usage:
 *   node scripts/validate-posts.js [optional-file-paths...]
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for clean terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// Lightweight pure-JS frontmatter parser (zero npm dependencies required)
function parseFrontmatter(fileContent) {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, content: fileContent, rawYaml: null };
  }

  const rawYaml = match[1];
  const content = match[2];
  const frontmatter = {};

  const lines = rawYaml.split(/\r?\n/);
  let currentArrayKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for array item under current array key (e.g., "  - item")
    if (currentArrayKey && /^\s*-\s+(.*)$/.test(line)) {
      const itemMatch = line.match(/^\s*-\s+(.*)$/);
      let val = itemMatch[1].trim();
      // Remove surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      frontmatter[currentArrayKey].push(val);
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();

      // Check if it starts an array list (e.g. "tags:")
      if (value === '') {
        currentArrayKey = key;
        frontmatter[key] = [];
        continue;
      }

      currentArrayKey = null;

      // Inline array format (e.g. [a, b, c])
      if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        frontmatter[key] = inner
          ? inner.split(',').map((item) => {
              let s = item.trim();
              if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
                s = s.slice(1, -1);
              }
              return s;
            })
          : [];
        continue;
      }

      // Boolean
      if (value === 'true') {
        frontmatter[key] = true;
        continue;
      }
      if (value === 'false') {
        frontmatter[key] = false;
        continue;
      }

      // Remove quotes from strings
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      frontmatter[key] = value;
    }
  }

  return { frontmatter, content, rawYaml };
}

function validatePostFile(filePath) {
  const errors = [];
  const warnings = [];
  const fileName = path.basename(filePath);
  const slug = fileName.replace(/\.mdx$/, '');

  // 1. Filename validation
  if (!fileName.endsWith('.mdx')) {
    errors.push(`File extension must be ".mdx", received "${fileName}"`);
  }

  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (!slugRegex.test(slug)) {
    errors.push(
      `Slug "${slug}" is invalid. Filename must use lowercase kebab-case (letters, numbers, single hyphens). Example: "my-first-post.mdx"`
    );
  }

  // 2. Read file content
  let rawContent = '';
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    errors.push(`Could not read file: ${err.message}`);
    return { filePath, errors, warnings };
  }

  // 3. Frontmatter structure check
  const { frontmatter, content } = parseFrontmatter(rawContent);
  if (!frontmatter) {
    errors.push(
      'Missing or malformed YAML frontmatter. Post must begin with "---" on line 1 and end with "---".'
    );
    return { filePath, errors, warnings };
  }

  // 4. Required Field: title
  if (!frontmatter.title || typeof frontmatter.title !== 'string') {
    errors.push('Missing required frontmatter field: "title"');
  } else if (frontmatter.title.trim().length < 5) {
    errors.push('Field "title" must be at least 5 characters long');
  } else if (frontmatter.title.trim().length > 120) {
    warnings.push('Field "title" is longer than 120 characters, which may get truncated in SEO snippets.');
  }

  // 5. Required Field: description
  if (!frontmatter.description || typeof frontmatter.description !== 'string') {
    errors.push('Missing required frontmatter field: "description"');
  } else if (frontmatter.description.trim().length < 20) {
    errors.push('Field "description" must be at least 20 characters long for proper search indexing.');
  } else if (frontmatter.description.trim().length > 350) {
    warnings.push('Field "description" exceeds 350 characters. Recommended length is 50-160 characters.');
  }

  // 6. Required Field: date
  if (!frontmatter.date) {
    errors.push('Missing required frontmatter field: "date"');
  } else {
    const dateStr = String(frontmatter.date).trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
      errors.push(`Field "date" must be formatted as YYYY-MM-DD (e.g. "2026-10-18"), received "${dateStr}"`);
    } else {
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) {
        errors.push(`Field "date" ("${dateStr}") is not a valid calendar date.`);
      }
    }
  }

  // 7. Required Field: category
  if (!frontmatter.category || typeof frontmatter.category !== 'string') {
    errors.push('Missing required frontmatter field: "category"');
  } else if (frontmatter.category.trim().length < 2) {
    errors.push('Field "category" cannot be empty.');
  }

  // 8. Optional Field: tags
  if (frontmatter.tags !== undefined) {
    if (!Array.isArray(frontmatter.tags)) {
      errors.push('Field "tags" must be a list (array) of strings.');
    } else if (frontmatter.tags.length === 0) {
      warnings.push('Field "tags" is empty. Adding 2-4 tags is recommended for discovery.');
    }
  }

  // 9. Optional Field: coverImage
  if (frontmatter.coverImage !== undefined) {
    const img = String(frontmatter.coverImage).trim();
    if (!img.startsWith('http://') && !img.startsWith('https://') && !img.startsWith('/') && !img.startsWith('./')) {
      warnings.push(`Field "coverImage" ("${img}") should be an absolute URL or start with "/".`);
    }
  }

  // 10. Content validation
  if (!content || content.trim().length < 100) {
    errors.push('Post body content is too short. A wiki article should contain at least 100 characters of informative content.');
  }

  // 11. Git conflict markers check
  if (/^<{7}\s/m.test(content) || /^={7}$/m.test(content) || /^>{7}\s/m.test(content)) {
    errors.push('Post content contains unresolved Git merge conflict markers (<<<<<<<, =======, >>>>>>>).');
  }

  return { filePath, errors, warnings };
}

// Main execution
function main() {
  console.log(`\n${colors.bold}${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}    NSoC Wiki — Post MDX Validator      ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}========================================${colors.reset}\n`);

  const rootDir = path.resolve(__dirname, '..');
  const postsDir = path.join(rootDir, 'posts');

  let filesToValidate = [];

  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    filesToValidate = cliArgs
      .map((f) => path.resolve(process.cwd(), f))
      .filter((f) => f.endsWith('.mdx') && fs.existsSync(f));
  } else {
    if (fs.existsSync(postsDir)) {
      filesToValidate = fs
        .readdirSync(postsDir)
        .filter((file) => file.endsWith('.mdx'))
        .map((file) => path.join(postsDir, file));
    }
  }

  if (filesToValidate.length === 0) {
    console.log(`${colors.yellow}No MDX files found to validate.${colors.reset}\n`);
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  filesToValidate.forEach((filePath) => {
    const relPath = path.relative(rootDir, filePath);
    const result = validatePostFile(filePath);

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log(`  ${colors.green}✔${colors.reset} ${colors.bold}${relPath}${colors.reset}`);
    } else if (result.errors.length === 0) {
      console.log(`  ${colors.yellow}▲${colors.reset} ${colors.bold}${relPath}${colors.reset} (${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''})`);
      result.warnings.forEach((warn) => {
        console.log(`    ${colors.yellow}• Warning: ${warn}${colors.reset}`);
      });
      totalWarnings += result.warnings.length;
    } else {
      console.log(`  ${colors.red}✖${colors.reset} ${colors.bold}${relPath}${colors.reset} (${result.errors.length} error${result.errors.length > 1 ? 's' : ''})`);
      result.errors.forEach((err) => {
        console.log(`    ${colors.red}• Error: ${err}${colors.reset}`);
      });
      result.warnings.forEach((warn) => {
        console.log(`    ${colors.yellow}• Warning: ${warn}${colors.reset}`);
      });
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
    }
  });

  console.log(`\n----------------------------------------`);
  console.log(`Files Checked : ${filesToValidate.length}`);
  console.log(`Total Errors  : ${totalErrors > 0 ? colors.red + totalErrors + colors.reset : colors.green + '0' + colors.reset}`);
  console.log(`Total Warnings: ${totalWarnings > 0 ? colors.yellow + totalWarnings + colors.reset : '0'}`);
  console.log(`----------------------------------------\n`);

  if (totalErrors > 0) {
    console.log(`${colors.red}${colors.bold}✖ Validation failed! Please fix the errors listed above before merging.${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}${colors.bold}✔ All wiki posts passed validation successfully!${colors.reset}\n`);
    process.exit(0);
  }
}

main();
