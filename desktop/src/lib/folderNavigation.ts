import type {ResourceManifest} from '../api/resources';
type Entry=ResourceManifest['files'][number];
export function folderLocation(path:string):string{
 const normalized=path.replace(/\\/g,'/').replace(/\/$/,'');
 if(normalized&&normalized.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f\x7f:]/.test(part)))throw Error('Invalid folder location');
 return normalized;
}
export function folderContents(files:Entry[],directory:string){
 const location=folderLocation(directory),prefix=location?`${location}/`:'',directories=new Set<string>();
 const children:Entry[]=[];
 for(const file of files){
  let path:string;try{path=folderLocation(file.relative_path||file.original_filename);}catch{continue;}
  if(!path.startsWith(prefix))continue;
  const rest=path.slice(prefix.length),slash=rest.indexOf('/');
  if(slash>=0)directories.add(rest.slice(0,slash));else if(rest){if(file.kind==='folder')directories.add(rest);else children.push(file);}
 }
 return{directories:[...directories].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),files:[...children].sort((a,b)=>a.original_filename.localeCompare(b.original_filename,undefined,{numeric:true}))};
}
