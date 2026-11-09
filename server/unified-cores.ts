/** Compatibility facades: original engines keep their data files and public APIs. */
import type {SoulEngine} from './soul.ts';
import type {SuperMind} from './supermind.ts';
import type {LivingCore} from './living.ts';
import type {CognitiveCore} from './cognition.ts';

export class IdentityCore{
 readonly soul:SoulEngine;
 readonly supermind:SuperMind;
 constructor(soul:SoulEngine,supermind:SuperMind){this.soul=soul;this.supermind=supermind;}
 prompt(useMemory=true){return this.soul.prompt(useMemory)+(useMemory?'\n'+this.supermind.prompt():'');}
 async refresh(){return this.supermind.scan();}
 status(){return {soul:this.soul.overview(),supermind:this.supermind.status()};}
}
export class LearningCore{
 readonly living:LivingCore;
 readonly cognition:CognitiveCore;
 constructor(living:LivingCore,cognition:CognitiveCore){this.living=living;this.cognition=cognition;}
 prompt(){return this.living.prompt()+'\n'+this.cognition.prompt();}
 async verify(){return this.cognition.scan();}
 status(){return {living:this.living.status(),cognition:this.cognition.status()};}
}
