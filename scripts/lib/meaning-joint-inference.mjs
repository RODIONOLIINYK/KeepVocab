// Portable verification for experimental joint-label artifacts, never app code.
const sigmoid=x=>x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const pattern=k=>Array.from({length:6},(_,c)=>(k>>c)&1);
const softmax=xs=>{const max=Math.max(...xs),e=xs.map(x=>Math.exp(x-max)),mass=e.reduce((a,b)=>a+b,0);return e.map(v=>v/mass);};
export function jointMeaningOutput(artifact,vector){
  if(artifact?.role!=='experimental-joint-meaning-classifier'||!Array.isArray(vector)||vector.length!==512||!vector.every(Number.isFinite))throw new Error('Invalid joint artifact/vector.');
  const m=artifact.model;let joint;
  if(m.family==='prior-powerset'){
    const model=m.raw;let v=vector.map((x,i)=>(x-model.mean[i])/model.scale[i]);
    for(const [li,[w,b]] of model.layers.entries()){
      const z=[...b];for(let i=0;i<v.length;i++)for(let c=0;c<z.length;c++)z[c]+=v[i]*w[i][c];
      v=li===model.layers.length-1?z:z.map(x=>model.activation==='relu'?Math.max(0,x):model.activation==='silu'?x*sigmoid(x):Math.tanh(x));
    }
    joint=softmax(v);
  }else{
    const f=m.features;let x=f.kind==='rbf'?f.centers.map(c=>Math.exp(-f.gamma*Math.max(0,2-2*dot(vector,c)))):vector;
    x=x.map((v,i)=>(v-f.mean[i])/f.scale[i]);
    if(m.family==='crf'){
      const unary=[...m.bias];for(let i=0;i<x.length;i++)for(let c=0;c<6;c++)unary[c]+=x[i]*m.weights[i][c];
      joint=softmax(Array.from({length:64},(_,k)=>{
        const bits=pattern(k);let value=dot(bits,unary),pair=0;
        for(let a=0;a<6;a++)for(let b=a+1;b<6;b++)value+=m.couplings[pair++]*bits[a]*bits[b];
        return value;
      }));
    }else if(m.family==='pcc'){
      const bases=m.chain.map(h=>dot(x,h.weights.slice(0,x.length))+h.bias);
      joint=softmax(Array.from({length:64},(_,k)=>{
        const bits=pattern(k);let logp=0;
        for(let step=0;step<6;step++){
          let z=bases[step];for(let p=0;p<step;p++)z+=bits[m.order[p]]*m.labelScale*m.chain[step].weights[x.length+p];
          logp+=bits[m.order[step]]*z-Math.max(0,z)-Math.log1p(Math.exp(-Math.abs(z)));
        }
        return logp;
      }));
    }else throw new Error('Unknown joint family.');
  }
  const probabilities=Array.from({length:6},(_,c)=>joint.reduce((s,p,k)=>s+p*((k>>c)&1),0));
  const labels=artifact.decoder==='map'?pattern(joint.indexOf(Math.max(...joint))):probabilities.map(x=>Number(x>=.5));
  return {joint,probabilities,labels};
}
