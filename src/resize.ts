import { promises as fs } from 'fs';
import * as path from 'path';
import * as popen from 'child_process';
import * as readline from 'readline';

async function wait_child(child) {
  return new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === null) reject(signal);
      else resolve(code);
    });
  });
}

// Throws error message
async function seven_zip(...args) {
  let msg = []
  let exe = path.join(__dirname, 'exe/7za.exe');
  let p7z = popen.spawn(exe, args);
  p7z.stdout.on('data', d => { msg.push(d); });
  p7z.stderr.on('data', d => { msg.push(d); });
  let ret = await wait_child(p7z);
  if (ret > 1) throw `7za error occured: ${ret}\n${Buffer.concat(msg)}`;
  return ret;
}

async function get_temp_and_files(arg) {
  let entry = await fs.stat(arg);
  if (entry.isFile() && arg.endsWith('.zip')) {
    let out_dir = path.join(path.dirname(arg), path.basename(arg, '.zip'));
    out_dir = path.resolve(out_dir)
    await seven_zip('x', arg, '-y', '-o' + out_dir);
    let fileNames = await fs.readdir(out_dir);
    let paths = fileNames.map(x => path.join(out_dir, x));
    return [out_dir, paths];
  }
  else if (entry.isDirectory()) {
    let fileNames = await fs.readdir(arg);
    let paths = fileNames.map(x => path.join(arg, x));
    return [null, paths];
  }
  else {
    return [null, arg];
  }
}

async function spawn_conv(file, optimize) {
  let convert_opt = [file, '-normalize', '-resize', '1920x1080>']
    .concat(optimize ? ['png:-'] : ['-define', 'webp:lossless=true', 'webp:-']);
  let guetzli_opt = ['--quality', '95', '-', '-'];

  let exe = path.join(__dirname, 'exe/convert.exe');
  let convert = popen.spawn(exe, convert_opt);
  convert.stderr.pipe(process.stdout);
  let bufs = [];
  if (optimize) {
    exe = path.join(__dirname, 'exe/guetzli.exe');
    let guetzli = popen.spawn(exe, guetzli_opt);
    guetzli.stderr.pipe(process.stdout);
    guetzli.stdout.on('data', d => { bufs.push(d); });
    convert.stdout.pipe(guetzli.stdin);
    if (await wait_child(guetzli) != 0)
      await Promise.reject(`guetzli: ${file}`);
  }
  else {
    convert.stdout.on('data', d => { bufs.push(d); });
    if (await wait_child(convert) != 0)
      await Promise.reject(`convert: ${file}`);
  }
  return Buffer.concat(bufs);
}

async function determine_extension(file) {
  let fd = await fs.open(file, 'r');
  let buf = Buffer.alloc(12);
  await fs.read(fd, buf, 0, buf.length, 0);
  await fd.close();
  let sig = buf.toString();
  if (sig.startsWith('\xFF\xD8\xFF')) {
    return '.jpg';
  }
  if (sig.startsWith('PNG')) {
    return '.png';
  }
  if (sig.startsWith('GIF')) {
    return '.gif';
  }
  if (sig.startsWith('RIFF') && sig.substr(8, 4) === 'WEBP') {
    return '.webp';
  }
  return null;
}

async function revise_pic(file) {
  if (file.endsWith('.webp')) return;

  let data = await spawn_conv(file, false);
  let stat = await fs.stat(file);

  let base = file.slice(0, file.lastIndexOf('.'));
  if (stat.size < data.length) {
    let ext = await determine_extension(file);
    if (ext === null || file.endsWith(ext)) return;
    return fs.rename(file, base + ext);
  }

  let target = base + '.webp';
  await fs.writeFile(target, data);

  if (file !== target) {
    await fs.unlink(file);
  }
}

async function rmrf(path) {
  let proms = [];
  for (let file of await fs.readdir(path)) {
    let cur = path + '/' + file;
    let is_dir = (await fs.lstat(cur)).isDirectory();
    proms.push(is_dir ? rmrf(cur) : fs.unlink(cur));
  }
  await Promise.all(proms);
  await fs.rmdir(path);
};

async function convert(args) {
  let proms = [], folder_proms = [];
  for (let arg of args) {
    let target = path.resolve(arg);
    let group = [], temp, files;
    try {
      [temp, files] = await get_temp_and_files(target);
    }
    catch (e) {
      console.log(`[${new Date().toLocaleTimeString()}] ${e}`);
      continue;
    }
    console.log(`[${new Date().toLocaleTimeString()}] Processing ${arg}...`);
    for (let file of files) {
      if (proms.length >= 4) {
        await Promise.race(proms);
        // proms = proms.filter(p => !p.done);
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
    if (temp) folder_proms.push(Promise.all(group).then(async () => {
      try {
        await fs.unlink(target);
        let prev_cwd = process.cwd();
        process.chdir(temp);
        await seven_zip('a', target, '-y', '-mx=0', '*');
        process.chdir(prev_cwd);
        await rmrf(temp)
      }
      catch (e) { console.log(e); }
    }));
  }
  await Promise.all(proms.concat(folder_proms));
}

if (require.main === module) {
  let pushd = process.cwd();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  process.on('uncaughtException', err => {
    rl.question(`uncaught: ${err}`, () => rl.close());
    process.chdir(pushd);
  });
  convert(process.argv.slice(2)).then(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Complete.`);
    rl.close();
  });
}
