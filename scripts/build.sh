DIR="$( cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check out the latest npm-utils
rm -rf ./npm-utils && git clone --depth=1 git@bitbucket.org:inindca/npm-utils.git ./npm-utils

# Set up node with the provided version and generate a .npmrc file for our private npm repo
source ./npm-utils/scripts/jenkins-pre-build.sh 8.11.2

pushd ${DIR}/..
./node_modules/.bin/webpack
popd
