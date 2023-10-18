#!/usr/bin/env node
const { dirWalk } = require('./scripts/utils');

const fs = require('fs');
const { versionDir, majorVersionDir } = require('./webpack.config');

const buildDate = new Date();

const manifest = {
  name: process.env.APP_NAME,
  version: process.env.VERSION,
  build: process.env.BUILD_ID,
  buildDate: buildDate.toISOString(),
  indexFiles: []
};

/* add versioned bundles for CDN */
[...dirWalk(versionDir), ...dirWalk(majorVersionDir)]
  .forEach(filename => manifest.indexFiles.push({ file: filename.replace('dist/', '') }));

fs.writeFileSync('./dist/manifest.json', JSON.stringify(manifest, null, 2), { encoding: 'utf8' });