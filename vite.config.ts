/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built site works from any URL (e.g. GitHub Pages sub-folder).
  base: './',
  // Keep licence comments (/*! ... */ and @license, e.g. TA-Lib's BSD notice) in the minified bundle.
  build: { rolldownOptions: { output: { comments: { legal: true } } } },
  // Agent worktrees live in .claude/; without this their copies of the tests run too.
  test: { exclude: ['**/node_modules/**', '.claude/**', 'dist/**'] },
});
