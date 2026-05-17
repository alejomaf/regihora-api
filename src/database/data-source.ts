import { config as loadDotEnv } from 'dotenv';
import { DataSource } from 'typeorm';

import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { createDataSourceOptions } from './typeorm-options';

for (const path of getEnvironmentFilePaths()) {
  loadDotEnv({ path, override: false, quiet: true });
}

const environment = validateEnvironment(process.env);

export default new DataSource(createDataSourceOptions(environment));
