import * as popen from "child_process";
import * as path from "path";

async function waitChild(child: popen.ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (code === null) {
        reject(signal);
      }
      else {
        resolve(code);
      }
    });
  });
}

interface IProcessResult {
  code: number;
  err: Buffer;
  out: Buffer;
}

async function waitResult(child: popen.ChildProcess): Promise<IProcessResult> {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on("data", d => { out.push(d); });
  child.stderr.on("data", d => { err.push(d); });
  try {
    const code = await waitChild(child);
    child.stdout.removeAllListeners();
    return {
      code,
      err: Buffer.concat(err),
      out: Buffer.concat(out),
    };
  }
  catch (e) {
    throw new Error(`${e}: process aborted.\n${err}\n${out}`);
  }
}

function getModifiedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(process.env);
  const lookups = ["exe", "../exe"];
  const paths = lookups.map(x => path.resolve(x)).join(";");
  env.PATH = `${paths};${process.env.PATH}`;
  return env;
}

export class Tools {
  private static readonly defaultEnv: NodeJS.ProcessEnv = getModifiedEnv();

  constructor(readonly lookupPath?: string) { }

  public async sevenZip(...args: string[]): Promise<number> {
    const exe = this.resolvePath("7za.exe");
    const p7z = this.spawn(exe, args);
    const res = await waitResult(p7z);
    if (res.code > 1) {
      throw new Error(`7za error occured: ${res.code}\n${res.out}${res.err}`);
    }
    return res.code;
  }

  public async magick(file: string): Promise<Buffer> {
    const magickOpt = [
      file, "-normalize", "-resize", "1920x1080>",
      "-define", "webp:lossless=true", "webp:-",
    ];

    const exe = this.resolvePath("magick.exe");
    const convProc = this.spawn(exe, magickOpt);
    convProc.stderr.pipe(process.stdout);
    const res = await waitResult(convProc);
    if (res.code !== 0) {
      throw new Error(`magick: ${file}, ${res.out}`);
    }
    return res.out;
  }

  private spawn(command: string, args?: string[]): popen.ChildProcess {
    return popen.spawn(command, args, { env: Tools.defaultEnv });
  }

  private resolvePath(exe: string): string {
    if (this.lookupPath) {
      return path.resolve(this.lookupPath, exe);
    }
    else {
      return exe;
    }
  }
}
