import { resolveAuthMode } from "@/lib/auth/mode";

/** Runs once when a server instance starts. Fails fast on unsafe configuration. */
export function register(): void {
  resolveAuthMode(process.env);
}
