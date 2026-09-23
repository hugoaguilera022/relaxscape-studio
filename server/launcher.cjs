const fs=require('fs');
const Module=require('module');
const path=require('path');

// The YouTube wrapper historically registered its catch-all proxy before the
// daily routes. We inject the daily routes before that proxy at process start,
// without rewriting the large wrapper file itself.
const file=path.join(__dirname,'bootstrap-youtube-ai.cjs');
let source=fs.readFileSync(file,'utf8');
const marker='app.use(proxyToCore);';
if(!source.includes(marker)) throw new Error('No se encontró el punto de inserción del proxy.');
if(!source.includes("require('./daily-routes.cjs')(app);")){
  source=source.replace(marker,"require('./daily-routes.cjs')(app);\n"+marker);
}
const m=new Module(file,module.parent);
m.filename=file;
m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(source,file);
