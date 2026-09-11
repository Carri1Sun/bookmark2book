import { createModelClient } from '../shared/model';
import { config } from './config';
export const askModel = createModelClient({
  apiKey: config.key,
  model: config.model,
  baseUrl: config.baseUrl,
});
