#!/usr/bin/env node

/**
 * NSoC Wiki - Gemini AI PR Reviewer
 * Analyzes pull request articles for:
 * 1. Executive Summary (what it teaches)
 * 2. Self-promotion and author credits check
 * 3. Backlinks and external link audit (spam/affiliate detection)
 * 4. Topic redundancy with existing wiki posts
 * 5. Overall maintainer verdict (Green/Yellow/Red)
 *
 * Usage:
 *   node scripts/ai-pr-review.js [file-paths...]
 */

const fs = require('fs');
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY || '';

// Extract all external HTTP/HTTPS links from markdown
function extractLinks(markdown) {
  const links = [];
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }

  const rawUrlRegex = /(https?:\/\/[^\s\)\>\]]+)/g;
  while ((match = rawUrlRegex.exec(markdown)) !== null) {
    const url = match[1];
    if (!links.some((l) => l.url === url)) {
      links.push({ text: 'Raw URL', url: url });
    }
  }

  return links;
}

// Get list of existing article titles/slugs to check for topic overlap
function getExistingTopics(rootDir, currentFiles) {
  const postsDir = path.join(rootDir, 'posts');
  if (!fs.existsSync(postsDir)) return [];

  const existing = [];
  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.mdx'));

  for (const file of files) {
    const fullPath = path.join(postsDir, file);
    if (currentFiles.includes(fullPath)) continue;

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const titleMatch = content.match(/title:\s*["']?([^"'\r\n]+)["']?/);
      existing.push({
        slug: file.replace('.mdx', ''),
        title: titleMatch ? titleMatch[1] : file.replace('.mdx', ''),
      });
    } catch {
      // quiet fallback
    }
  }
  return existing;
}

async function reviewArticleWithGemini(fileName, fileContent, existingTopics) {
  const links = extractLinks(fileContent);
  const linksSummary =
    links.length > 0
      ? links.map((l) => `- [${l.text}](${l.url})`).join('\n')
      : 'None (No external links detected).';

  const existingTopicsSummary =
    existingTopics.length > 0
      ? existingTopics.map((t) => `- "${t.title}" (slug: \`${t.slug}\`)`).join('\n')
      : 'No prior community posts.';

  const prompt = `You are the lead technical maintainer and editorial reviewer for "NSoC Wiki" (wiki.nsoc.in), the community open-source knowledge base of Nexus Spring of Code (NSoC).
A contributor has submitted a Pull Request with a new wiki documentation article.

Analyze this article carefully to save maintainers time and prevent spam, covert SEO backlinks, and excessive self-promotion.

==================================================
ARTICLE FILENAME:
${fileName}

EXTRACTED EXTERNAL LINKS:
${linksSummary}

CURRENT COMMUNITY POSTS ALREADY PUBLISHED:
${existingTopicsSummary}

ARTICLE FULL CONTENT:
${fileContent}
==================================================

Generate a concise, professional GitHub Markdown Review Report with EXACTLY the following structure:

### 📋 Executive Summary
(2-3 sentences max explaining what the article teaches and whether it provides genuine educational value to students and developers.)

### 🔍 Self-Promotion & Credit Audit
- **Author Credits**: (State if author credit is clean/humble vs excessive self-promotion, personal agency plugs, or pushing personal social media/services.)
- **Self-Promotion Risk**: (Rate as Low / Moderate / High with a 1-sentence rationale.)

### 🔗 Backlink & External Link Audit
- **Total External Links**: (Count)
- **Link Purpose Review**: (Are the links genuine documentation/tools [e.g. official docs, MDN, GitHub]? Or are they suspicious affiliate links, private business marketing, or spammy SEO backlinks?)

### 🔄 Community Redundancy & Duplication Check
- (Does this article cover new ground, or is it heavily repetitive/redundant compared to existing community posts? Mention if it adds unique value.)

### ⚖️ Maintainer Recommendation
- **Verdict**: [Choose exactly one: 🟢 **Looks Clean (Recommended for Merge)** | 🟡 **Needs Minor Revisions** | 🔴 **High Risk / Spam Warning**]
- **Key Action Item**: (1-2 bullet points telling the maintainer exactly what to check or what the author must edit before merging).

Keep your response completely objective, fair, and formatted in clean GitHub Markdown. Do not include introductory conversational filler.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const reviewText =
    data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : 'No review output generated.';

  return reviewText;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  let targetFiles = process.argv.slice(2);

  if (targetFiles.length === 0) {
    const postsDir = path.join(rootDir, 'posts');
    if (fs.existsSync(postsDir)) {
      targetFiles = fs
        .readdirSync(postsDir)
        .filter((f) => f.endsWith('.mdx'))
        .slice(0, 1) // Default to first file for local testing
        .map((f) => path.join('posts', f));
    }
  }

  if (targetFiles.length === 0) {
    console.log('No MDX files provided or found for AI review.');
    process.exit(0);
  }

  if (!apiKey) {
    console.warn('\n[Warning] GEMINI_API_KEY environment variable is not set.');
    console.warn('To enable AI PR reviews, set GEMINI_API_KEY or add it to repository secrets.');

    const placeholderReport = `<!-- nsoc-ai-pr-reviewer -->
## 🤖 NSoC Wiki - Automated Article Review

> [!NOTE]
> **Gemini AI Review Skipped**: The \`GEMINI_API_KEY\` secret is not yet configured in this repository. Maintainers can add this secret in Repository Settings > Secrets to enable automated content audits.
`;
    fs.writeFileSync(path.join(rootDir, 'pr-review-output.md'), placeholderReport, 'utf8');
    process.exit(0);
  }

  console.log(`\n🤖 NSoC Wiki - Gemini AI PR Reviewer`);
  console.log(`Analyzing ${targetFiles.length} file(s) with Gemini 1.5 Flash...\n`);

  const existingTopics = getExistingTopics(rootDir, targetFiles.map((f) => path.resolve(rootDir, f)));
  let fullReport = `<!-- nsoc-ai-pr-reviewer -->\n## 🤖 NSoC Wiki - AI Article Review Report\n\n*Automated review powered by **Google Gemini 1.5 Flash** for community transparency and quality assurance.*\n\n---\n\n`;

  for (const relFile of targetFiles) {
    const absPath = path.resolve(rootDir, relFile);
    const fileName = path.basename(absPath);

    if (!fs.existsSync(absPath)) {
      console.warn(`File not found: ${relFile}`);
      continue;
    }

    console.log(`⏳ Reviewing: ${fileName}...`);
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      const review = await reviewArticleWithGemini(fileName, content, existingTopics);

      fullReport += `### 📄 File: \`${fileName}\`\n\n${review}\n\n---\n\n`;
      console.log(`✔ Finished review for ${fileName}`);
    } catch (err) {
      console.error(`✖ Failed to review ${fileName}:`, err.message);
      fullReport += `### 📄 File: \`${fileName}\`\n\n> [!WARNING]\n> Failed to generate automated review: ${err.message}\n\n---\n\n`;
    }
  }

  fullReport += `\n*Maintainers: Use this automated assessment alongside standard code review before merging.*`;

  const outputPath = path.join(rootDir, 'pr-review-output.md');
  fs.writeFileSync(outputPath, fullReport, 'utf8');

  console.log(`\n✔ Full review report saved to pr-review-output.md`);
  console.log(fullReport);
}

main().catch((err) => {
  console.error('Fatal error in AI PR reviewer:', err);
  process.exit(1);
});
