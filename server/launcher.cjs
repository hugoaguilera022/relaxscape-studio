const path=require("path");

const file=path.join(__dirname,"bootstrap-youtube-ai.cjs");

// Bootstrap único y estable. Las rutas se registran dentro del propio bootstrap,
// evitando inyección dinámica que podía dejar el proxy delante de Musicoterapia.
require(file);
