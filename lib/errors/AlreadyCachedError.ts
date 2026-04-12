import type { ModelStatic } from 'sequelize';

export class AlreadyCachedError extends Error {
  constructor(model: ModelStatic<any>) {
    super(`Model ${model.name} has already been cached`);
  }
}
