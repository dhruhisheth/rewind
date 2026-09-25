import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH is set by the GitHub Pages build, which serves the app under /<repo>/
export default defineConfig({ plugins: [react()], base: process.env.BASE_PATH ?? "/", server: { port: 5173 } });
