import * as popen from "child_process";
import { promises as fs } from "fs";
import * as path from "path";
import * as readline from "readline";

async function wait_child(child: popen.ChildProcess) {
  return new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      if (code === null) {
        reject(signal);
      }
      else {
        resolve(code);
      }
    });
  });
}

async function seven_zip(...args: string[]) {
  const msg = [];
  const exe = path.join(__dirname, "exe/7za.exe");
  const p7z = popen.spawn(exe, args);
  p7z.stdout.on("data", d => { msg.push(d); });
  p7z.stderr.on("data", d => { msg.push(d); });
  const ret = await wait_child(p7z);
  if (ret > 1) {
    throw new Error(`7za error occured: ${ret}\n${Buffer.concat(msg)}`);
  }
  return ret;
}

async function get_temp_and_files(arg: string) {
  const entry = await fs.stat(arg);
  if (entry.isFile() && arg.endsWith(".zip")) {
    let outDir = path.join(path.dirname(arg), path.basename(arg, ".zip"));
    outDir = path.resolve(outDir);
    await seven_zip("x", arg, "-y", "-o" + outDir);
    const fileNames = await fs.readdir(outDir);
    const paths = fileNames.map(x => path.join(outDir, x));
    return [outDir, paths];
  }
  else if (entry.isDirectory()) {
    const fileNames = await fs.readdir(arg);
    const paths = fileNames.map(x => path.join(arg, x));
    return [null, paths];
  }
  else {
    return [null, arg];
  }
}

async function spawn_conv(file: string, optimize: boolean) {
  const convertOpt = [file, "-normalize", "-resize", "1920x1080>"]
    .concat(optimize ? ["png:-"] : ["-define", "webp:lossless=true", "webp:-"]);
  const guetzliOpt = ["--quality", "95", "-", "-"];

  let exe = path.join(__dirname, "exe/convert.exe");
  const convProc = popen.spawn(exe, convertOpt);
  convProc.stderr.pipe(process.stdout);
  const bufs = [];
  if (optimize) {
    exe = path.join(__dirname, "exe/guetzli.exe");
    const guetzli = popen.spawn(exe, guetzliOpt);
    guetzli.stderr.pipe(process.stdout);
    guetzli.stdout.on("data", d => { bufs.push(d); });
    convProc.stdout.pipe(guetzli.stdin);
    if (await wait_child(guetzli) !== 0) {
      await Promise.reject(`guetzli: ${file}`);
    }
  }
  else {
    convProc.stdout.on("data", d => { bufs.push(d); });
    if (await wait_child(convProc) !== 0) {
      await Promise.reject(`convert: ${file}`);
    }
  }
  return Buffer.concat(bufs);
}

async function determine_extension(file: string) {
  const fd = await fs.open(file, "r");
  const buf = Buffer.alloc(12);
  await fs.read(fd, buf, 0, buf.length, 0);
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

async function revise_pic(file: string) {
  if (file.endsWith(".webp")) { return; }

  const data = await spawn_conv(file, false);
  const stat = await fs.stat(file);

  const base = file.slice(0, file.lastIndexOf("."));
  if (stat.size < data.length) {
    const ext = await determine_extension(file);
    if (ext === null || file.endsWith(ext)) { return; }
    return fs.rename(file, base + ext);
  }

  const target = base + ".webp";
  await fs.writeFile(target, data);

  if (file !== target) {
    await fs.unlink(file);
  }
}

// tslint:disable-next-line: no-shadowed-variable
async function rmrf(path: string) {
  const proms = [];
  for (const file of await fs.readdir(path)) {
    const cur = path + "/" + file;
    const isDir = (await fs.lstat(cur)).isDirectory();
    proms.push(isDir ? rmrf(cur) : fs.unlink(cur));
  }
  await Promise.all(proms);
  await fs.rmdir(path);
}

async function convert(args: string[]) {
  let proms = [];
  const folderProms = [];
  for (const arg of args) {
    const target = path.resolve(arg);
    const group = [];
    let temp;
    let files;
    try {
      [temp, files] = await get_temp_and_files(target);
    }
    catch (e) {
      console.log(`[${new Date().toLocaleTimeString()}] ${e}`);
      continue;
    }
    console.log(`[${new Date().toLocaleTimeString()}] Processing ${arg}...`);
    for (const file of files) {
      if (proms.length >= 4) {
        await Promise.race(proms);
      }
      console.log(`[${new Date().toLocaleTimeString()}] Process ${file}`);
      let prom = revise_pic(file);
      prom = prom.then(() => {
        console.log(`[${new Date().toLocaleTimeString()}] Processed ${file}`);
        proms = proms.filter(p => p !== prom);
      }, reason => {
        console.log(reason);
        proms = proms.filter(p => p !== prom);
      });
      proms.push(prom);
      group.push(prom);
    }
    if (temp) {
      folderProms.push(Promise.all(group).then(async () => {
        try {
          await fs.unlink(target);
          const prevCmd = process.cwd();
          process.chdir(temp);
          await seven_zip("a", target, "-y", "-mx=0", "*");
          process.chdir(prevCmd);
          await rmrf(temp);
        }
        catch (e) { console.log(e); }
      }));
    }
  }
  await Promise.all(proms.concat(folderProms));
}

function main() {
  const pushd = process.cwd();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  process.on("uncaughtException", err => {
    rl.question(`uncaught: ${err}`, () => rl.close());
    process.chdir(pushd);
  });
  convert(process.argv.slice(2)).then(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Complete.`);
    rl.close();
  });
}

if (require.main === module) {
  main();
}
