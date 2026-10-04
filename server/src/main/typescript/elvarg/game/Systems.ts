import { NPC } from './entity/impl/npc/NPC';
import * as path from 'path';
import * as fs from 'fs';
import 'reflect-metadata';

// require-all is a CommonJS export; import via require to avoid default interop issues.
const requireAll: any = require('require-all');

export class Systems {
  public static init() {
    const npcDir = path.join(__dirname, 'entity', 'impl', 'npc');
    const npcOverrideClasses = requireAll({
      dirname: npcDir,
      filter: /^(?!.*base).*\.js$/,
      recursive: true,
      map: (name, path) => {
        if (!fs.existsSync(path) || fs.statSync(path).isDirectory()) {
          return null;
        }
        return require(path).default;
      }
    });

    const npcClasses = Object.values(npcOverrideClasses)
      .filter((clazz: any) => clazz != null)
      .filter((clazz: any) => typeof clazz === 'function' && clazz.prototype != null)
      .filter((clazz: any) => Reflect.hasOwnMetadata('Ids', clazz.prototype));
    const implementationClasses = npcClasses.filter((clazz: any) => clazz.prototype instanceof NPC);
    NPC.initImplementations(implementationClasses);
  }
}
