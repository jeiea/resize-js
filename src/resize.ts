import { promises as fs } from "fs";
import * as path from "path";
import * as readline from "readline";
import { Deferred } from "./Deferred";
import { Tools } from "./tools";

async function determineExtension(file: string): Promise<string> {
  const fd = await fs.open(file, "r");
  const buf = Buffer.alloc(12);
  await fd.read(buf, 0, buf.length, 0);
  await fd.close();
  const sig = buf.toString();
  if (sig.startsWith("\xFF\xD8\xFF")) {
    return ".jpg";
  }
  if (sig.startsWith("PNG")) {
    return ".png";
  }
  if (sig.startsWith("GIF")) {
    return ".gif";
  }
  if (sig.startsWith("RIFF") && sig.substr(8, 4) === "WEBP") {
    return ".webp";
  }
  return null;
}

async function rmrf(path: string): Promise<void> {
  const stat = await fs.lstat(path);
  if (stat.isFile()) {
    return fs.unlink(path);
  }
  else {
    const files = await fs.readdir(path);
    const childs = files.map(f => `${path}/${f}`);
    await Promise.all(childs.map(rmrf));
    await fs.rmdir(path);
  }
}

class ConvTask {
  constructor(readonly path: string, readonly promise: Promise<void>) { }
}

interface ITreeConverter {
  conversions(): AsyncIterableIterator<ConvTask>;
}

class TreeConversion implements ITreeConverter {
  private static converter: Tools = new Tools();

  private static isImageExtension(path: string): boolean {
    return path.endsWith(".jpg") ||
      path.endsWith(".png") ||
      path.endsWith(".gif") ||
      path.endsWith(".webp");
  }

  private static async* allImages(path: string): AsyncIterableIterator<string> {
    const stat = await fs.lstat(path);
    if (stat.isFile()) {
      if (TreeConversion.isImageExtension(path)) {
        yield path;
      }
    }
    else {
      for (const file of await fs.readdir(path)) {
        const cur = path + "/" + file;
        yield* this.allImages(cur);
      }
    }
  }

  private static async revisePic(file: string): Promise<void> {
    if (file.endsWith(".webp")) {
      return;
    }

    const data = await this.converter.magick(file);
    const stat = await fs.stat(file);

    const base = file.slice(0, file.lastIndexOf("."));
    if (stat.size < data.length) {
      const ext = await determineExtension(file);
      if (ext === null || file.endsWith(ext)) {
        return;
      }
      return fs.rename(file, base + ext);
    }

    const target = base + ".webp";
    await fs.writeFile(target, data);

    if (file !== target) {
      await fs.unlink(file);
    }
  }

  constructor(readonly sourcePath: string) {
  }

  public async* conversions(): AsyncIterableIterator<ConvTask> {
    for await (const p of TreeConversion.allImages(this.sourcePath)) {
      const task = TreeConversion.revisePic(p);
      yield new ConvTask(p, task);
    }
  }
}

class ZipFileConversion implements ITreeConverter {
  public readonly complete: Deferred<void> = new Deferred();
  private readonly extracted: TreeConversion;

  constructor(readonly sourcePath: string) {
    const dir = this.getZipExtractPath();
    this.extracted = new TreeConversion(dir);
  }

  public async* conversions(): AsyncIterableIterator<ConvTask> {
    await this.extractTo(this.extracted.sourcePath);
    const convs = [];
    for await (const task of this.extracted.conversions()) {
      yield task;
      convs.push(task.promise);
    }
    Promise.all(convs).then(this.cleanup);
  }

  private cleanup = async (): Promise<void> => {
    await this.archiveFrom(this.extracted.sourcePath);
    await rmrf(this.extracted.sourcePath);
    this.complete.resolve();
  }

  private getZipExtractPath(): string {
    const dir = path.dirname(this.sourcePath);
    const base = path.basename(this.sourcePath, ".zip");
    return path.resolve(path.join(dir, base));
  }

  private async extractTo(outDir: string): Promise<void> {
    await new Tools().sevenZip("x", this.sourcePath, "-y", "-o" + outDir);
  }

  private async archiveFrom(dir: string): Promise<void> {
    const prevCwd = process.cwd();
    process.chdir(dir);
    await fs.unlink(this.sourcePath);
    await new Tools().sevenZip("a", this.sourcePath, "-y", "-mx=0", "*");
    process.chdir(prevCwd);
  }
}

function dateLog(msg: string): void {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

export async function convert(args: string[]): Promise<void> {
  let proms: Array<Promise<void>> = [];
  const folderProms = [];
  for (const arg of args) {
    let conv: ITreeConverter;
    if (arg.endsWith(".zip")) {
      const c = new ZipFileConversion(arg);
      folderProms.push(c.complete);
      conv = c;
    }
    else {
      conv = new TreeConversion(arg);
    }
    dateLog(`Processing ${arg}...`);
    for await (const task of conv.conversions()) {
      dateLog(`Process ${task.path}...`);
      task.promise.then(() => {
        dateLog(`Processed ${task.path}...`);
      }, reason => {
        dateLog(`${reason}`);
      }).finally(() => {
        proms = proms.filter(p => p !== task.promise);
      });
      proms.push(task.promise);
      if (proms.length >= 4) {
        await Promise.race(proms);
      }
    }
  }
  await Promise.all(proms.concat(folderProms));
}

async function main(): Promise<void> {
  const pushd = process.cwd();
  process.on("uncaughtException", err => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`uncaught: ${err}`, () => rl.close());
    process.chdir(pushd);
  });
  await convert(process.argv.slice(2));
  console.log(`[${new Date().toLocaleTimeString()}] Complete.`);
}

if (require.main === module) {
  main();
}
