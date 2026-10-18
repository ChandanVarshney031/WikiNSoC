#!/usr/bin/env node

/**
 * NSoC Wiki Contributors Synchronizer
 * Aggregates all post authors and PR metadata into contributors.json
 *
 * Can be run:
 * 1. Automatically via GitHub Actions when a PR is merged
 * 2. Manually by maintainers to backfill or re-sync contributors
 *
 * Usage:
 *   node scripts/sync-contributors.js
 */

const fs = require('fs');
const path = require('path');

function parseSimpleFrontmatter(fileContent) {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};

  yaml.split(/\r?\n/).forEach((line) => {
    const kv = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) {
      let val = kv[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[kv[1].trim()] = val;
    }
  });

  return result;
}

function syncContributors() {
  const rootDir = path.resolve(__dirname, '..');
  const postsDir = path.join(rootDir, 'posts');
  const postsMetaPath = path.join(rootDir, 'posts-metadata.json');
  const contributorsPath = path.join(rootDir, 'contributors.json');

  let postsMetadata = {};
  if (fs.existsSync(postsMetaPath)) {
    try {
      postsMetadata = JSON.parse(fs.readFileSync(postsMetaPath, 'utf8'));
    } catch (e) {
      console.warn('Could not parse posts-metadata.json:', e.message);
    }
  }

  let existingContributorsData = { contributors: [] };
  if (fs.existsSync(contributorsPath)) {
    try {
      existingContributorsData = JSON.parse(fs.readFileSync(contributorsPath, 'utf8'));
    } catch (e) {
      // quiet fallback
    }
  }

  const existingMap = new Map();
  if (Array.isArray(existingContributorsData.contributors)) {
    existingContributorsData.contributors.forEach((c) => {
      if (c && c.username) {
        existingMap.set(c.username.toLowerCase(), c);
      }
    });
  }

  // Collect all posts from directory and metadata
  const postSlugs = new Set();
  if (fs.existsSync(postsDir)) {
    fs.readdirSync(postsDir)
      .filter((f) => f.endsWith('.mdx'))
      .forEach((f) => postSlugs.add(f.replace(/\.mdx$/, '')));
  }

  // Also include any slugs in postsMetadata
  Object.keys(postsMetadata).forEach((s) => postSlugs.add(s));

  const contributorMap = new Map();

  postSlugs.forEach((slug) => {
    const meta = postsMetadata[slug] || {};
    let author = meta.author;
    let username = meta.githubUsername;
    let postDate = meta.updatedAt;

    // Fallback to reading the .mdx file if author/date not in metadata
    const mdxPath = path.join(postsDir, `${slug}.mdx`);
    if (fs.existsSync(mdxPath)) {
      try {
        const content = fs.readFileSync(mdxPath, 'utf8');
        const fm = parseSimpleFrontmatter(content);
        if (!author && fm.author) author = fm.author;
        if (!username && fm.githubUsername) username = fm.githubUsername;
        if (!postDate && fm.date) postDate = fm.date;
      } catch (err) {
        // ignore
      }
    }

    if (!username) {
      username = author ? author.toLowerCase().replace(/\s+/g, '') : 'contributor';
    }

    if (!author) {
      author = username;
    }

    const canonicalKey = username.toLowerCase();

    if (!contributorMap.has(canonicalKey)) {
      const prev = existingMap.get(canonicalKey) || {};
      contributorMap.set(canonicalKey, {
        username: username,
        name: author,
        avatarUrl: `https://github.com/${username}.png`,
        profileUrl: `https://github.com/${username}`,
        posts: [],
        firstContribution: prev.firstContribution || postDate || new Date().toISOString(),
        lastContribution: postDate || new Date().toISOString(),
      });
    }

    const entry = contributorMap.get(canonicalKey);
    if (!entry.posts.includes(slug)) {
      entry.posts.push(slug);
    }

    // Update latest date if newer
    if (postDate) {
      const postTimestamp = new Date(postDate).getTime();
      if (!isNaN(postTimestamp)) {
        if (!entry.lastContribution || postTimestamp > new Date(entry.lastContribution).getTime()) {
          entry.lastContribution = new Date(postTimestamp).toISOString();
        }
        if (!entry.firstContribution || postTimestamp < new Date(entry.firstContribution).getTime()) {
          entry.firstContribution = new Date(postTimestamp).toISOString();
        }
      }
    }
  });

  const contributorsList = Array.from(contributorMap.values()).map((c) => ({
    ...c,
    postCount: c.posts.length,
  }));

  // Sort by postCount descending, then username ascending
  contributorsList.sort((a, b) => b.postCount - a.postCount || a.username.localeCompare(b.username));

  const outputData = {
    updatedAt: new Date().toISOString(),
    totalContributors: contributorsList.length,
    contributors: contributorsList,
  };

  fs.writeFileSync(contributorsPath, JSON.stringify(outputData, null, 2) + '\n', 'utf8');

  console.log(`\n✔ Synced ${contributorsList.length} contributor(s) to contributors.json:`);
  contributorsList.forEach((c) => {
    console.log(`  • @${c.username} (${c.name}) - ${c.postCount} post(s): [${c.posts.join(', ')}]`);
  });
  console.log('');
}

syncContributors();
