import { execSync as Child } from 'child_process';
import FS from 'fs';

const { browserFilename } = require('../webpack.config');

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
Child('npm run compile:webpack:ie');

// to backward compat – replace the old file on cdn
Child(`cp dist/${browserFilename} dist/streaming-client-browser.js`);