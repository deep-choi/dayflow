import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.svg', 'masked-icon.svg', 'robots.txt', 'sitemap.xml'],
        manifest: {
          name: 'Dayflow - AI Daily Flow Assistant',
          short_name: 'Dayflow',
          description: 'AI와 함께 일정, 할 일, 메모, 대화를 정리하는 개인 생산성 대시보드입니다.',
          theme_color: '#4169E1',
          background_color: '#ffffff',
          display: 'standalone',
          lang: 'ko',
          icons: [
            {
              src: 'favicon.svg',
              sizes: '64x64',
              type: 'image/svg+xml'
            },
            {
              src: 'apple-touch-icon.svg',
              sizes: '180x180',
              type: 'image/svg+xml'
            },
            {
              src: 'masked-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        },
        devOptions: {
          enabled: false
        }
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('@google/genai')) return 'vendor-ai';
            if (id.includes('@dnd-kit')) return 'vendor-dnd';
            if (id.includes('date-fns')) return 'vendor-date';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
            return 'vendor';
          }
        }
      }
    }
  };
});
