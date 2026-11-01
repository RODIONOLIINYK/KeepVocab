// Offline verification of calibrated compact joint heads. No app integration.
import {jointMeaningOutput} from './meaning-joint-inference.mjs';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const bits=k=>Array.from({length:6},(_,i)=>(k>>i)&1);
const softmax=scores=>{const max=Math.max(...scores),q=scores.map(v=>Math.exp(v-max)),mass=q.reduce((a,b)=>a+b,0);return q.map(v=>v/mass);};
export function tunedJointOutput(artifact,vector){
  if(artifact?.role!=='experimental-joint-tuning'||!Array.isArray(vector)||vector.length!==512||!vector.every(Number.isFinite))throw new Error('Invalid tuned-joint input.');
  let joint;
  if(artifact.kind==='probability-ensemble'){
    if(!artifact.members?.length)throw new Error('Empty ensemble.');
    const outputs=artifact.members.map(m=>tunedJointOutput(m,vector));
    joint=Array.from({length:64},(_,i)=>outputs.reduce((s,o)=>s+o.joint[i],0)/outputs.length);
  }else if(artifact.calibrationFolded||artifact.calibration.method==='none'){
    joint=jointMeaningOutput({...artifact,role:'experimental-joint-meaning-classifier',decoder:'map'},vector).joint;
  }else{
    const model=artifact.model;if(model.family!=='pcc')throw new Error('Non-folded calibration requires a chain.');
    const f=model.features;let x=f.kind==='rbf'?f.centers.map(c=>Math.exp(-f.gamma*Math.max(0,2-2*dot(vector,c)))):vector;
    x=x.map((v,i)=>(v-f.mean[i])/f.scale[i]);const cal=artifact.calibration;
    const bases=model.chain.map(h=>dot(x,h.weights.slice(0,x.length))+h.bias);
    joint=softmax(Array.from({length:64},(_,k)=>{
      const y=bits(k);let logp=0;
      for(let step=0;step<6;step++){
        let z=bases[step];for(let prev=0;prev<step;prev++)z+=y[model.order[prev]]*model.labelScale*model.chain[step].weights[x.length+prev];
        logp+=y[model.order[step]]*z-Math.max(0,z)-Math.log1p(Math.exp(-Math.abs(z)));
      }
      let score=logp/cal.temperature+dot(y,cal.unaryOffsets),pair=0;
      for(let a=0;a<6;a++)for(let b=a+1;b<6;b++)score+=cal.pairOffsets[pair++]*y[a]*y[b];
      return score;
    }));
  }
  const probabilities=Array.from({length:6},(_,c)=>joint.reduce((s,p,k)=>s+p*((k>>c)&1),0));
  return {joint,probabilities,labels:bits(joint.indexOf(Math.max(...joint)))};
}
