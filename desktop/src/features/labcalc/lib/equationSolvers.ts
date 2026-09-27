/** Pure, offline equation solvers. Coefficients are finite real numbers. */
export type EquationSolution={kind:'unique'|'infinite'|'inconsistent';values?:number[];residual?:number};
export type QuadraticSolution={kind:'two-real'|'repeated'|'complex'|'linear'|'infinite'|'inconsistent';roots?:string[];vertex?:{x:number;y:number};discriminant?:number};
const EPS=1e-11;
function finite(values:number[]){if(values.some(v=>!Number.isFinite(v)))throw new Error('Enter finite numeric coefficients.')}
export function solveLinear(matrix:number[][],rhs:number[]):EquationSolution{
 const n=rhs.length;if(n!==2&&n!==3)throw new Error('Choose two or three equations.');
 if(matrix.length!==n||matrix.some(row=>row.length!==n))throw new Error('The coefficient matrix must be square.');
 finite([...matrix.flat(),...rhs]);const a=matrix.map((row,i)=>[...row,rhs[i]]);
 const scale=Math.max(1,...a.flat().map(Math.abs)),tol=EPS*scale;
 let rank=0;const pivots:number[]=[];
 for(let col=0;col<n;col++){let best=rank;for(let row=rank+1;row<n;row++)if(Math.abs(a[row][col])>Math.abs(a[best][col]))best=row;
  if(Math.abs(a[best][col])<=tol)continue;
  [a[rank],a[best]]=[a[best],a[rank]];
  const pivot=a[rank][col];for(let j=col;j<=n;j++)a[rank][j]/=pivot;
  for(let row=0;row<n;row++){if(row===rank)continue;const factor=a[row][col];for(let j=col;j<=n;j++)a[row][j]-=factor*a[rank][j]}
  pivots.push(col);rank++;
 }
 for(let row=rank;row<n;row++)if(Math.abs(a[row][n])>tol)return {kind:'inconsistent'};
 if(rank<n)return {kind:'infinite'};
 const values=new Array<number>(n).fill(0);pivots.forEach((col,row)=>{values[col]=a[row][n]});
 const residual=Math.max(...matrix.map((row,i)=>Math.abs(row.reduce((sum,coefficient,j)=>sum+coefficient*values[j],0)-rhs[i])));
 return {kind:'unique',values,residual};
}
export function solveQuadratic(a:number,b:number,c:number):QuadraticSolution{
 finite([a,b,c]);const tol=EPS*Math.max(1,Math.abs(a),Math.abs(b),Math.abs(c));
 if(Math.abs(a)<=tol){if(Math.abs(b)<=tol)return {kind:Math.abs(c)<=tol?'infinite':'inconsistent'};return {kind:'linear',roots:[String(-c/b)]}}
 const discriminant=b*b-4*a*c;
 if(!Number.isFinite(discriminant))throw new Error('Coefficients are too large for a reliable result.');
 const vertex={x:-b/(2*a),y:-discriminant/(4*a)};
 if(Math.abs(discriminant)<=tol*Math.max(1,Math.abs(b*b),Math.abs(4*a*c))){const root=-b/(2*a);return {kind:'repeated',roots:[String(root)],discriminant,vertex}}
 if(discriminant<0){const re=-b/(2*a),im=Math.sqrt(-discriminant)/(2*Math.abs(a));return {kind:'complex',roots:[`${re} + ${im}i`,`${re} - ${im}i`],discriminant,vertex}}
 const root=Math.sqrt(discriminant),q=-.5*(b+Math.sign(b||1)*root);
 return {kind:'two-real',roots:[String(q/a),String(c/q)],discriminant,vertex};
}
