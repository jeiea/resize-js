const fs = require('fs-extra');
const path = require('path');
const popen = require('child_process');
const readline = require('readline');
const stream = require('stream');

async function wait_child(child) {
  return new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === null) reject(signal);
      else resolve(code);
    });
  });
}

async function wait(fn) {
  return new Promise((resolve, reject) => {
    fn((...args) => resolve(args));
  });
}

async function get_temp_and_files(arg) {
  let entry = await fs.stat(arg);
  if (entry.isFile() && arg.endsWith('.zip')) {
    let out_dir = path.join(path.dirname(arg), path.basename(arg, '.zip'));
    let p7z = popen.spawn('exe/7za.exe', ['x', arg, '-y', '-o' + out_dir]);
    await wait_child(p7z);
    let files = (await wait(fs.readdir.bind(fs, out_dir)))[1]
    .map(x => path.join(out_dir, x));
    return [out_dir, files];
  }
  else if (entry.isDirectory()) {
    files = (await wait(fs.readdir.bind(fs, arg)))[1]
    .map(x => path.join(arg, x));
    return [null, files];
  }
  else {
    return [null, arg];
  }
}

async function spawn_conv(file, optimize) {
  let convert_opt = [file, '-normalize', '-resize', '1920x1080>']
  .concat(optimize ? ['png:-'] : ['-quality', '93', 'jpg:-']);
  let guetzli_opt = ['--quality', '95', '-', '-'];
  
  let convert = popen.spawn('exe/convert.exe', convert_opt);
  convert.stderr.pipe(process.stdout);
  let bufs = [];
  if (optimize) {
    let guetzli = popen.spawn('exe/guetzli.exe', guetzli_opt);
    guetzli.stderr.pipe(process.stdout);
    guetzli.stdout.on('data', d => { bufs.push(d); });
    convert.stdout.pipe(guetzli.stdin);
    if (await wait_child(guetzli) != 0) return false;
  }
  else {
    convert.stdout.on('data', d => { bufs.push(d); });
    if (await wait_child(convert) != 0) return false;
  }
  return Buffer.concat(bufs);
}

async function determine_extension(file) {
  let fd = await fs.open(file, 'r');
  let buf = new Buffer(8);
  await fs.read(fd, buf, 0, buf.length, 0);
  fs.close(fd);
  let sig = buf.latin1Slice();
  if (sig.startsWith('\xFF\xD8\xFF')) {
    return '.jpg';
  }
  if (sig.startsWith('PNG')) {
    return '.png';
  }
  if (sig.startsWith('GIF')) {
    return '.gif';
  }
  return null;
}

async function revise_pic(file) {
  let data = await spawn_conv(file, true);
  if (data === false) {
    console.log(`failure: ${file}`);
    return;
  }
  let stat = await fs.stat(file);
  
  let base = file.slice(0, file.lastIndexOf('.'));
  if (stat.size < data.length) {
    let ext = await determine_extension(file);
    if (file.endsWith(ext)) return;
    return fs.rename(file, base + ext);
  }
  
  let target = base + '.jpg';
  await fs.writeFile(target, data);
  
  if (file !== target) await fs.remove(file);
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
    let group = [], temp, files;
    try { [temp, files] = await get_temp_and_files(arg); }
    catch (e) {
      console.log(`[${new Date().toLocaleTimeString()}] ${e}`);
      continue;
    }
    console.log(`[${new Date().toLocaleTimeString()}] Processing ${arg}...`);
    for (let file of files) {
      if (proms.length >= 4) {
        await Promise.race(proms);
        proms = proms.filter(p => !p.done);
      }
      console.log(`[${new Date().toLocaleTimeString()}] Process ${file}`);
      let prom = revise_pic(file);
      prom.then(() => {
        console.log(`[${new Date().toLocaleTimeString()}] Processed ${file}`);
        prom.done = true;
      });
      proms.push(prom);
      group.push(prom);
    }
    if (temp) folder_proms.push(Promise.all(group).then(async() => {
      try {
        await fs.remove(arg);
        let p7z = popen.spawn('exe/7za.exe', ['a', arg, '-y', temp + '/*']);
        await wait_child(p7z); 
        await rmrf(temp)
      }
      catch (e) {}
    }));
  }
  await Promise.all(proms.concat(folder_proms));
}

if (require.main === module) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  process.on('uncaughtException', err => {
    rl.question(`uncaught: ${err}`);
    rl.close();
  });
  convert(process.argv.slice(2)).then(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Complete.`);
    rl.close();
  });
}
