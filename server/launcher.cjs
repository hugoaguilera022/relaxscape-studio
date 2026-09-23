const fs=require('fs');
const Module=require('module');
const path=require('path');

const file=path.join(__dirname,'bootstrap-youtube-ai.cjs');
let source=fs.readFileSync(file,'utf8');
const marker='app.use(proxyToCore);';
const at=source.indexOf(marker);
if(at<0)throw new Error('No se encontró el punto de inserción del proxy.');
const before=source.slice(0,at),after=source.slice(at);
const routes=[
  "require('./daily-routes.cjs')(app);",
  "require('./youtube-publish.cjs')(app);"
];
for(const route of routes){
  if(!before.includes(route)) source=source.slice(0,at)+route+'\n'+source.slice(at);
}
const m=new Module(file,module.parent);
m.filename=file;
m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(source,file);
