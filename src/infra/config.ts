/**
 * Configuração técnica do processo (não é regra de negócio — essas ficam
 * na tabela de parâmetros). Lida das variáveis de ambiente, com padrões seguros.
 */
import { z } from "zod";

const schema = z.object({
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
