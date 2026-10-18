import { constants } from 'node:fs';
import { access, lstat, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

function isWithin(root, directory) {
  const relative = path.relative(root, directory);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function directoryError(error) {
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return new Error('目录不存在或不是文件夹');
  if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS') return new Error('目录不可访问或不可写，请检查共享目录权限');
  if (error.code === 'EEXIST') return new Error('同名文件或文件夹已存在');
  return error;
}

export class DirectoryBrowser {
  constructor(roots) {
    if (!Array.isArray(roots) || !roots.length || roots.some((root) => typeof root !== 'string' || !path.isAbsolute(root))) {
      throw new Error('BILIFETCH_DOWNLOAD_ROOTS 必须是非空的绝对路径 JSON 数组');
    }
    this.roots = [...new Set(roots.map((root) => path.normalize(root)))];
  }

  async resolve(directory, { create = false, writable = false } = {}) {
    try {
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('保存目录必须使用绝对路径');
      const normalized = path.normalize(directory);
      const root = this.roots.filter((entry) => isWithin(entry, normalized)).sort((a, b) => b.length - a.length)[0];
      if (!root) throw new Error('该目录未共享，请选择已配置的下载目录；Docker 中使用其他位置需先添加挂载');
      const physicalRoot = await realpath(root);
      let ancestor = normalized;
      const missing = [];
      while (true) {
        try {
          const physicalAncestor = await realpath(ancestor);
          if (!isWithin(physicalRoot, path.join(physicalAncestor, ...missing))) {
            throw new Error('目录中的符号链接指向共享范围之外');
          }
          break;
        } catch (error) {
          if (!create || error.code !== 'ENOENT' || ancestor === root) throw error;
          // A dangling symlink must not be mistaken for a missing directory.
          try {
            await lstat(ancestor);
            throw new Error('目录中的符号链接无效');
          } catch (linkError) {
            if (linkError.code !== 'ENOENT') throw linkError;
          }
          missing.unshift(path.basename(ancestor));
          ancestor = path.dirname(ancestor);
        }
      }
      if (missing.length) {
        await access(ancestor, constants.W_OK | constants.X_OK);
        await mkdir(normalized, { recursive: true });
      }
      if (!isWithin(physicalRoot, await realpath(normalized))) throw new Error('目录中的符号链接指向共享范围之外');
      if (!(await stat(normalized)).isDirectory()) throw new Error('所选路径不是文件夹');
      if (writable) await access(normalized, constants.W_OK | constants.X_OK);
      return normalized;
    } catch (error) {
      throw directoryError(error);
    }
  }

  async list(directory) {
    if (!directory) return { directory: null, parent: null, directories: this.roots.map((root) => ({ name: root, path: root })) };
    const selected = await this.resolve(directory);
    try {
      const directories = [];
      for (const entry of await readdir(selected, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const child = path.join(selected, entry.name);
        try {
          await this.resolve(child);
          directories.push({ name: entry.name, path: child });
        } catch {
          // Inaccessible folders and links outside the shared roots are not selectable.
        }
      }
      directories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      return { directory: selected, parent: this.roots.includes(selected) ? null : path.dirname(selected), directories };
    } catch (error) {
      throw directoryError(error);
    }
  }

  async create(parent, name) {
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
      throw new Error('请输入有效的文件夹名称，不能包含路径分隔符');
    }
    const selected = await this.resolve(parent, { writable: true });
    try {
      const directory = path.join(selected, name);
      await mkdir(directory);
      return { directory: await this.resolve(directory, { writable: true }) };
    } catch (error) {
      throw directoryError(error);
    }
  }
}
