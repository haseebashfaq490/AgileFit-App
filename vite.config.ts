import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  
  // In AI Studio, GEMINI_API_KEY is injected directly into process.env by the infrastructure
  // We need to either grab from process.env OR from the .env fallback
  const apiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || "";

  // Set the base path dynamically for GitHub Pages.
  // GITHUB_REPOSITORY is automatically set by GitHub Actions (e.g., "username/repo-name")
  let basePath = './'; // Default fallback
  if (process.env.GITHUB_REPOSITORY) {
    const repoName = process.env.GITHUB_REPOSITORY.split('/')[1];
    basePath = `/${repoName}/`;
  }

  return {
    base: basePath,
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: "0.0.0.0",
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
