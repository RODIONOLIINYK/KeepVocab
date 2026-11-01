// Experimental artifact verification only. Not imported by production code.
const sigmoid=x=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
function dense(values,layers,activation){
  for(const [index,[weights,bias]] of layers.entries()){
    const out=[...bias];
    for(let i=0;i<values.length;i++)for(let j=0;j<out.length;j++)out[j]+=values[i]*weights[i][j];
    values=index===layers.length-1?out:out.map(x=>activation==='relu'?Math.max(0,x):activation==='silu'?x*sigmoid(x):Math.tanh(x));
  }
  return values;
}
function raw(model,vector){
  if(model.family==='knn'){
    const nearest=model.centers.map((center,i)=>({i,s:dot(vector,center)})).sort((a,b)=>b.s-a.s||a.i-b.i).slice(0,model.neighbors);
    const peak=nearest[0].s;const weights=nearest.map(({i,s})=>Math.exp(model.temperature*(s-peak))*model.sampleWeights[i]);
    const mass=weights.reduce((a,b)=>a+b,0);
    return Array.from({length:6},(_,c)=>nearest.reduce((sum,{i},j)=>sum+weights[j]*model.targets[i][c],0)/mass);
  }
  if(model.family==='rbf'){
    const features=model.centers.map(center=>Math.exp(-model.gamma*Math.max(0,2-2*dot(vector,center))));
    const values=features.map((v,i)=>(v-model.head.mean[i])/model.head.scale[i]);
    return dense(values,model.head.layers,'tanh').map(sigmoid);
  }
  if(!['mlp','powerset'].includes(model.family))throw new Error('Unsupported experimental family.');
  const values=vector.map((v,i)=>(v-model.mean[i])/model.scale[i]);
  const logits=dense(values,model.layers,model.activation);
  if(model.family==='mlp')return logits.map(sigmoid);
  const maximum=Math.max(...logits);const joint=logits.map(x=>Math.exp(x-maximum));const mass=joint.reduce((a,b)=>a+b,0);
  return Array.from({length:6},(_,c)=>joint.reduce((sum,p,k)=>sum+((k>>c)&1)*p,0)/mass);
}
export function experimentalMeaningProbabilities(artifact,vector){
  if(artifact?.role!=='experimental-meaning-architecture'||artifact.inputDimension!==512
    ||!Array.isArray(vector)||vector.length!==512||!vector.every(Number.isFinite))throw new Error('Invalid experimental artifact/vector.');
  if(artifact.model.family==='ensemble'){
    const outputs=artifact.model.members.map(member=>experimentalMeaningProbabilities(member,vector));
    return Array.from({length:6},(_,i)=>outputs.reduce((sum,p)=>sum+p[i],0)/outputs.length);
  }
  const p=raw(artifact.model,vector);const cal=artifact.calibration;
  if(!cal||cal.method==='none')return p;
  return p.map((value,i)=>{
    const clipped=Math.max(1e-10,Math.min(1-1e-10,value));
    return sigmoid(Math.log(clipped/(1-clipped))/cal.temperature+cal.offsets[i]);
  });
}
