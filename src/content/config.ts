import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const propuesta = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/propuesta" }),
  schema: z.object({
    order: z.number(),
    slug: z.string(),
    title: z.string(),
    shortTitle: z.string().optional(),
    eyebrow: z.string().optional(),
    lead: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { propuesta };
