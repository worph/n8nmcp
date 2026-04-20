import { z } from "zod";

export const ConfigSchema = z.object({
  n8n: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
  }),
  server: z
    .object({
      port: z.number().default(9640),
      discoveryPort: z.number().default(9099),
      upstreamPort: z.number().default(3000),
      upstreamAuthToken: z.string(),
    })
    .default({
      port: 9640,
      discoveryPort: 9099,
      upstreamPort: 3000,
      upstreamAuthToken: "",
    }),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface StatusResponse {
  configured: boolean;
  upstreamHealthy: boolean;
  n8nBaseUrl: string;
  lastError?: string;
}
