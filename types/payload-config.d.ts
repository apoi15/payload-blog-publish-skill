// In a real project `@payload-config` is a tsconfig path to src/payload.config.ts.
declare module '@payload-config' {
  import type { SanitizedConfig } from 'payload'
  const config: Promise<SanitizedConfig>
  export default config
}
