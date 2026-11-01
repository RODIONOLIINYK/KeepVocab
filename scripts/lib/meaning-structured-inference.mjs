// Portable offline verification; not imported by the app.
import {tunedJointOutput} from './meaning-joint-tuning-inference.mjs';
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const bits=k=>Array.from({length:6},(_,i)=>(k>>i)&1);
const linear=(x,w,b)=>b.map((v,c)=>v+x.reduce((sum,z,i)=>sum+z*w[i][c],0));
export function structuredMeaningOutput(artifact,vector){
  if(artifact?.role!=='experimental-structured-head'||!Array.isArray(vector)||vector.length!==512||!vector.every(Number.isFinite))throw new Error('Invalid structured-head input.');
  if(artifact.kind==='prior-compact')return tunedJointOutput(artifact.priorArtifact,vector);
  const m=artifact.model,f=m.features,cfg=m.config;
  let x=vector.map((v,i)=>(v-f.mean[i])/f.scale[i]);
  if(f.projection)x=linear(x,f.projection,f.projectScale.map(()=>0)).map((v,i)=>v/f.projectScale[i]);
  let unary,pairs;
  if(m.family==='svm'){
    const kernels=m.supportVectors.map(v=>Math.exp(-m.gamma*v.reduce((sum,z,i)=>sum+(z-x[i])**2,0)));
    unary=linear(kernels,m.coefficients,m.bias).map((v,i)=>v*Math.exp(m.platt.logSlopes[i])+m.platt.offsets[i]);pairs=Array(15).fill(0);
  }else{
    const p=m.params,h=cfg.width?linear(x,p.hiddenWeight,p.hiddenBias).map(v=>cfg.activation==='relu'?Math.max(0,v):Math.tanh(v)):x;
    const scores=linear(h,p.outputWeight,p.outputBias);unary=scores.slice(0,6);pairs=cfg.context?scores.slice(6):p.couplings;
    if(cfg.residual){const skip=linear(x,p.skipWeight,Array(6).fill(0));unary=unary.map((v,i)=>v+skip[i]);}
  }
  const cal=artifact.calibration,folded=artifact.calibrationFolded;
  const scores=Array.from({length:64},(_,k)=>{const y=bits(k);let score=dot(unary,y),pair=0;
    for(let a=0;a<6;a++)for(let b=a+1;b<6;b++)score+=pairs[pair++]*y[a]*y[b];
    if(!folded){score=score/cal.temperature+dot(cal.unaryOffsets,y);pair=0;for(let a=0;a<6;a++)for(let b=a+1;b<6;b++)score+=cal.pairOffsets[pair++]*y[a]*y[b];}
    return score;
  });
  const maximum=Math.max(...scores),q=scores.map(v=>Math.exp(v-maximum)),mass=q.reduce((a,b)=>a+b,0),joint=q.map(v=>v/mass);
  return {joint,probabilities:Array.from({length:6},(_,c)=>joint.reduce((sum,p,k)=>sum+p*((k>>c)&1),0)),labels:bits(joint.indexOf(Math.max(...joint)))};
}
