const fs=require('fs');
const Module=require('module');
const path=require('path');

const file=path.join(__dirname,'bootstrap-youtube-ai.cjs');
let source=fs.readFileSync(file,'utf8');
const marker='app.use(proxyToCore);';
const route="require('./daily-routes.cjs')(app);";
const proxyAt=source.indexOf(marker);
if(proxyAt<0)throw new Error('No se encontró el punto de inserción del proxy.');
const routeAt=source.indexOf(route);
// The original wrapper registers the route after the proxy. Move a second
// registration before the proxy; Express will then match the daily endpoints
// before the catch-all proxy and leave all existing functionality untouched.
if(routeAt<0 || routeAt>proxyAt) source=source.slice(0,proxyAt)+route+'\n'+source.slice(proxyAt);
const m=new Module(file,module.parent);
m.filename=file;
m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(source,file);
