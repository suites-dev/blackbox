import CatalogValidate from './commands/catalog/validate.js';
import CatalogList from './commands/catalog/list.js';

export const COMMANDS = {
  'catalog:validate': CatalogValidate,
  'catalog:ls': CatalogList,
  'catalog:list': CatalogList,
};
