/** A clear failure when the e2e harness didn't provide its env. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run this suite via e2e/run-e2e.sh`);
  }
  return value;
}
