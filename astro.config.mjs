import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://eco-paseo-san-francisco.vercel.app",
  integrations: [mdx()],
  server: {
    port: 4321,
  },
});
