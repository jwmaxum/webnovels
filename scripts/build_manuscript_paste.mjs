import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('public/vendor',{recursive:true});
await build({entryPoints:['src/manuscript-paste.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,outfile:'public/vendor/manuscript-paste.js',legalComments:'eof'});
await writeFile('public/vendor/manuscript-paste.LICENSE.txt','parse5 8.0.0\n'+await readFile('node_modules/parse5/LICENSE','utf8')+'\nentities\n'+await readFile('node_modules/entities/LICENSE','utf8'));
