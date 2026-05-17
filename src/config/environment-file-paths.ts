export function getEnvironmentFilePaths(
  nodeEnvironment = process.env.NODE_ENV ?? 'development',
): string[] {
  return [
    `.env.${nodeEnvironment}.local`,
    `.env.${nodeEnvironment}`,
    '.env.local',
    '.env',
  ];
}

