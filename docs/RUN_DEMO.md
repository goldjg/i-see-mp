# ISeeMP Demo

## Extract
tar -xzf iseemp-demo-bundle.tgz
cd i-see-mp

## Run live demo
node packages/cli/dist/index.js collect --config iseemp.dv-mcp.config.json
node packages/cli/dist/index.js analyze
node packages/cli/dist/index.js test --profile dv-lethal-trifecta
node packages/cli/dist/index.js serve --port 7474

## Run prebuilt demo
node packages/cli/dist/index.js serve --db iseemp-demo.db --port 7474
