const Fs = require('fs');
const Path = require('path');

function dirWalk (dir) {
  const files = [];
  function walk (dir) {
    Fs.readdirSync(dir).forEach(file => {
      const absolute = Path.join(dir, file);
      if (Fs.statSync(absolute).isDirectory()) return walk(absolute);
      else files.push(absolute);
    });
    return files;
  }

  return walk(dir);
}

module.exports.dirWalk = dirWalk;