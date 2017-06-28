const fs = require('fs-extra');
const path = require('path');
const popen = require('child_process');
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

async function resize_jpg(file) {
  let tmp = file + '.tmp';
  let convert_resize = [file, '-normalize', '-resize', '1920x1080>', '-quality', '93', 'jpg:-'];
  
  let convert = popen.spawn('exe/convert.exe', convert_resize);
  let bufs = [];
  convert.stdout.on('data', d => { bufs.push(d); });
  convert.stderr.pipe(process.stdout);
  if (await wait_child(convert) != 0) return;
  
  let stat = await fs.stat(file);
  let data = Buffer.concat(bufs);
  if (stat.size < data.length) return;
  
  let dot_idx = file.lastIndexOf('.');
  let sep_idx = file.lastIndexOf('/');
  let target = sep_idx < dot_idx
  ? file.substr(0, dot_idx) + '.jpg'
  : file + '.jpg';
  await fs.writeFile(target, data);
  
  if (file !== target)
  await fs.remove(file);
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
  let proms = [];
  for (let arg of args) {
    let group = [];
    let [temp, files] = await get_temp_and_files(arg);
    for (let file of files) {
      if (proms.length >= 4) {
        await Promise.race(proms);
        proms = proms.filter(p => !p.done);
      }
      let prom = resize_jpg(file);
      prom.then(() => {prom.done = true;});
      proms.push(prom);
      group.push(prom);
    }
    if (temp) Promise.all(group).then(async() => {
      await fs.remove(arg);
      let p7z = popen.spawn('exe/7za.exe', ['a', arg, '-y', temp + '/*']);
      await wait_child(p7z); 
      await rmrf(temp)
    });
  }
}

if (require.main === module) {
  convert(process.argv.slice(2));
}
