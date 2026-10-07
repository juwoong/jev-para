import { promises as fs } from 'fs';
import type { FilePort } from '../ports';

export class NodeFilePort implements FilePort {
  async readTextFile(absPath: string): Promise<string> {
    return fs.readFile(absPath, 'utf8');
  }

  async realPath(absPath: string): Promise<string> {
    return fs.realpath(absPath);
  }
}
