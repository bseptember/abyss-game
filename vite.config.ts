import { defineConfig } from 'vite';

const REPO_NAME = 'abyss-game';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  base: isGitHubActions ? `/${REPO_NAME}/` : '/',
  build: {
    target: 'esnext',
  },
});
