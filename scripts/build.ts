import { execSync as Child } from 'child_process';
import FS from 'fs';

const { majorVersionDir, versionDir, version } = require('../webpack.config');
const { dirWalk } = require('./utils');

const Pkg = JSON.parse(FS.readFileSync('package.json').toString());

function fileReplace (fileName: string, placeholder: string, value: string) {
  const originalFile = FS.readFileSync(fileName).toString();
  FS.writeFileSync(fileName, originalFile.replace(placeholder, value));
}

// Copy local package files
Child('npm run clean');
Child('npm run compile');
Child('npm run compile:module');

// Embed package version into CJS and ES modules
fileReplace('dist/cjs/client.js', '__STREAMING_CLIENT_VERSION__', Pkg.version);
fileReplace('dist/es/client.js', '__STREAMING_CLIENT_VERSION__', Pkg.version);

Child('npm run compile:rollup');

// this `npm` folder is really pointless. don't want to introduce any
//  breaking changes, though. So it will stay for now.
Child('mkdir dist/npm');
Child('cp -r dist/cjs/* dist/npm/');
// this `index.module.js` file isn't super useful either
Child('cp dist/es/index.js dist/npm/module.js');
// Child('cp dist/es/index.module.js dist/npm/module.js');
Child(`cp ${__dirname}/../*.md dist/npm`);
Child('npm run compile:webpack');

/* create our major version folder */
if (!FS.existsSync(majorVersionDir)) {
  FS.mkdirSync(majorVersionDir);
}

/* copy vX.Y.Z files over to majoy 'dist/vX/' */
[...dirWalk(versionDir)].forEach(fromFile => {
  if (!FS.existsSync(fromFile)) {
    return console.warn(`File did not exist. not able to copy it over: "${fromFile}"`);
  }

  const toFile = fromFile.replace(versionDir, majorVersionDir);

  console.log('Copying bundle file to non-bundle name', { fromFile, __toFile: toFile });
  Child(`cp ${fromFile} ${toFile}`);

  /*
    for backwards compat for apps that load from:
    node_modules/genesys-cloud-webrtc-sdk/dist/genesys-cloud-webrtc-sdk.js
  */
  const toRootDistFile = fromFile.replace(versionDir, 'dist/');
  console.log(`Copying ${version} file to dist/`, { fromFile, __toFile: toRootDistFile });
  Child(`cp ${fromFile} ${toRootDistFile}`);
});
