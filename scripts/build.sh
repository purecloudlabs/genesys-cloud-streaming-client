DIR="$( cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pushd ${DIR}/..
./node_modules/.bin/webpack
MINIMIZE=true ./node_modules/.bin/webpack
popd
