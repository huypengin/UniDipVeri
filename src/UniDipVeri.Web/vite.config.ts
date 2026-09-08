import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5172",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000, 
    
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 20000,
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom)/,
              priority: 40,
            },
            {
              name: 'vendor-tanstack',
              test: /node_modules[\\/]@tanstack/,
              priority: 30,
            },
            {
              name: 'vendor-ui',
              test: /node_modules[\\/](lucide-react|@radix-ui)/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
