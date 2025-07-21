import { execSync as Child } from 'child_process';
import FS from 'fs';
import path from 'path';

const { majorVersionDir, versionDir, version } = require('../webpack.config');
const { dirWalk } = require('./utils');

const Pkg = JSON.parse(FS.readFileSync('package.json').toString());

function fileReplace (fileName: string, placeholder: string, value: string) {
  const originalFile = FS.readFileSync(fileName).toString();
  FS.writeFileSync(fileName, originalFile.replace(placeholder, value));
}

function copyFile(src: string, dest: string) {
  FS.mkdirSync(path.dirname(dest), { recursive: true });
  FS.copyFileSync(src, dest);
}

function copyDir(src: string, dest: string) {
  FS.mkdirSync(dest, { recursive: true });
  const entries = FS.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

// Copy local package files
Child('npm run clean');
Child('npm run compile');
Child('npm run compile:module');

// Embed package version into CJS and ES modules
fileReplace('dist/cjs/client.js', '__STREAMING_CLIENT_VERSION__', Pkg.version);
fileReplace('dist/es/client.js', '__STREAMING_CLIENT_VERSION__', Pkg.version);

Child('npm run compile:rollup');

// Create npm directory and copy files
FS.mkdirSync('dist/npm', { recursive: true });
copyDir('dist/cjs', 'dist/npm');
copyFile('dist/es/index.js', 'dist/npm/module.js');

// Copy markdown files
const mdFiles = FS.readdirSync(__dirname + '/../').filter(file => file.endsWith('.md'));
for (const file of mdFiles) {
  copyFile(path.join(__dirname, '..', file), path.join('dist/npm', file));
}

Child('npm run compile:webpack');

/* create our major version folder */
if (!FS.existsSync(majorVersionDir)) {
  FS.mkdirSync(majorVersionDir, { recursive: true });
}

/* copy vX.Y.Z files over to major 'dist/vX/' */
[...dirWalk(versionDir)].forEach(fromFile => {
  if (!FS.existsSync(fromFile)) {
    return console.warn(`File did not exist. not able to copy it over: "${fromFile}"`);
  }

  const toFile = fromFile.replace(versionDir, majorVersionDir);
  const toRootDistFile = fromFile.replace(versionDir, 'dist/');

  console.log('Copying bundle file to non-bundle name', { fromFile, __toFile: toFile });
  copyFile(fromFile, toFile);

  /*
    for backwards compat for apps that load from:
    node_modules/genesys-cloud-webrtc-sdk/dist/genesys-cloud-webrtc-sdk.js
  */
  console.log(`Copying ${version} file to dist/`, { fromFile, __toFile: toRootDistFile });
  copyFile(fromFile, toRootDistFile);
});
