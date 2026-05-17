import { AppLogLevel, logLevels } from '../config/environment.validation';

export function getEnabledLogLevels(logLevel: AppLogLevel): AppLogLevel[] {
  const selectedIndex = logLevels.indexOf(logLevel);

  return logLevels.slice(0, selectedIndex + 1);
}

